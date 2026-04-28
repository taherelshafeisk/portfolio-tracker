import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "@workspace/db";
import {
  convictionsTable,
  convictionAttachmentsTable,
  accountsTable,
  positionsTable,
  portfolioPolicyTable,
  orderSuggestionsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { Conviction, ConvictionAttachment } from "@workspace/db";

const router: IRouter = Router();

// ─── Storage setup ─────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(process.cwd(), "uploads", "convictions");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per file
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are accepted"));
    }
  },
});

// ─── Types ─────────────────────────────────────────────────────────────────
interface ClaudeAffectedTicker {
  ticker: string;
  current_position: string;
  suggested_action: "ADD" | "TRIM" | "HOLD" | "EXIT" | "WATCH" | "NO_POSITION";
  rationale: string;
  ips_compatible: boolean;
  ips_conflict: string | null;
}

interface ClaudeProposal {
  summary: string;
  relevance: "HIGH" | "MEDIUM" | "LOW";
  affected_tickers: ClaudeAffectedTicker[];
  macro_themes: string[];
  ips_change_suggested: boolean;
  ips_change_rationale: string | null;
  confidence: "HIGH" | "MEDIUM" | "SPECULATIVE";
  proposed_action_type: "TRADE" | "IPS_UPDATE" | "WATCH" | "NO_ACTION";
  raw?: string;
  parse_error?: boolean;
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function formatConviction(
  row: Conviction,
  attachments: ConvictionAttachment[],
) {
  return {
    id: row.id,
    userId: row.userId,
    sourceType: row.sourceType,
    sourceUrl: row.sourceUrl,
    sourceName: row.sourceName,
    rawNote: row.rawNote,
    fetchedContent: row.fetchedContent,
    fetchStatus: row.fetchStatus,
    tickers: row.tickers ?? [],
    themes: row.themes ?? [],
    claudeProposal: row.claudeProposal ?? null,
    proposalStatus: row.proposalStatus,
    rejectionReason: row.rejectionReason,
    actionId: row.actionId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    attachments: attachments.map((a) => ({
      id: a.id,
      convictionId: a.convictionId,
      storagePath: a.storagePath,
      mimeType: a.mimeType,
      displayOrder: a.displayOrder,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

async function getAttachments(convictionId: string): Promise<ConvictionAttachment[]> {
  return db
    .select()
    .from(convictionAttachmentsTable)
    .where(eq(convictionAttachmentsTable.convictionId, convictionId))
    .orderBy(convictionAttachmentsTable.displayOrder);
}

// ─── URL fetch helper ───────────────────────────────────────────────────────
async function fetchUrlContent(url: string): Promise<{ content: string | null; status: "SUCCESS" | "FAILED" }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TradeNavigatorBot/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { content: null, status: "FAILED" };
    const html = await res.text();
    // Strip HTML tags, collapse whitespace, truncate to 8000 chars
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8000);
    return { content: text || null, status: text ? "SUCCESS" : "FAILED" };
  } catch {
    return { content: null, status: "FAILED" };
  }
}

// ─── Claude processing (async, runs after response sent) ───────────────────
const DEFAULT_CONC_LIMIT = 0.20;
const DEFAULT_LEV_CEILING = 1.50;

async function processWithClaude(convictionId: string): Promise<void> {
  try {
    const [convictionRows, attachments] = await Promise.all([
      db.select().from(convictionsTable).where(eq(convictionsTable.id, convictionId)),
      getAttachments(convictionId),
    ]);

    const conviction = convictionRows[0];
    if (!conviction) return;

    // Build portfolio context scoped to the conviction's owner
    const ownerUserId = conviction.userId ?? "";
    const [accounts, positions, policyRows] = await Promise.all([
      db.select().from(accountsTable).where(eq(accountsTable.userId, ownerUserId)),
      db.select().from(positionsTable).where(eq(positionsTable.userId, ownerUserId)),
      db.select().from(portfolioPolicyTable).where(eq(portfolioPolicyTable.userId, ownerUserId)).limit(1),
    ]);

    const policy = policyRows[0] ?? null;

    // Compute global IPS numbers
    let concentrationLimit = DEFAULT_CONC_LIMIT;
    let leverageCeiling = DEFAULT_LEV_CEILING;
    if (accounts.length > 0) {
      const acct = accounts[0];
      if (acct.concentrationLimit != null) concentrationLimit = parseFloat(acct.concentrationLimit);
      if (acct.leverageCeiling != null) leverageCeiling = parseFloat(acct.leverageCeiling);
    }

    // Calculate current leverage
    let totalMV = 0;
    let totalCash = 0;
    for (const acct of accounts) {
      totalCash += parseFloat(acct.currentBalance);
    }
    for (const pos of positions) {
      totalMV += parseFloat(pos.quantity) * parseFloat(pos.currentPrice);
    }
    const equity = totalMV + totalCash;
    const currentLeverage = equity > 0 ? totalMV / equity : 1;

    const currentPositions = positions.map((p) => ({
      symbol: p.symbol,
      name: p.name,
      quantity: parseFloat(p.quantity),
      avgCost: parseFloat(p.avgCost),
      currentPrice: parseFloat(p.currentPrice),
      marketValue: parseFloat(p.quantity) * parseFloat(p.currentPrice),
      bucket: p.positionBucket,
      ipsAction: p.ipsAction,
    }));

    // Build content parts
    type ContentPart =
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

    const contentParts: ContentPart[] = [];

    if (conviction.fetchedContent) {
      contentParts.push({
        type: "text",
        text: `Article content:\n${conviction.fetchedContent}`,
      });
    }

    for (const attachment of attachments) {
      const fullPath = path.join(process.cwd(), attachment.storagePath);
      if (fs.existsSync(fullPath)) {
        const imageData = fs.readFileSync(fullPath);
        const base64 = imageData.toString("base64");
        contentParts.push({
          type: "image",
          source: {
            type: "base64",
            media_type: attachment.mimeType,
            data: base64,
          },
        });
      }
    }

    if (conviction.rawNote) {
      contentParts.push({
        type: "text",
        text: `Trader's note: ${conviction.rawNote}`,
      });
    }

    const goldFloor = policy?.goldFloorPct != null ? `${(parseFloat(policy.goldFloorPct) * 100).toFixed(0)}%` : "5%";
    const goldTarget = policy?.goldTargetPct != null ? `${(parseFloat(policy.goldTargetPct) * 100).toFixed(0)}%` : "8-10%";

    contentParts.push({
      type: "text",
      text: `
Source: ${conviction.sourceType} — ${conviction.sourceName || "unspecified"}

Current positions across all sleeves:
${JSON.stringify(currentPositions, null, 2)}

IPS rules:
- Leverage ceiling: ${leverageCeiling}x (current: ${currentLeverage.toFixed(2)}x)
- Concentration limit: ${concentrationLimit}
- Gold floor: ${goldFloor} of NW, target ${goldTarget} by Dec 2026
- Cut list rule: flagged positions sold within 5 trading days
- Crypto buy zones: BTC $60-70K, ETH $1,320-1,800, SOL $80-95
- No new leveraged positions while S&P/Gold ratio declining
- Spec positions frozen in late-cycle posture

Analyze all inputs above (article, screenshots, note — whatever is present).
Return a structured JSON proposal only. No preamble. No markdown fences.
Raw JSON only.

Schema:
{
  "summary": string,
  "relevance": "HIGH" | "MEDIUM" | "LOW",
  "affected_tickers": [
    {
      "ticker": string,
      "current_position": string,
      "suggested_action": "ADD" | "TRIM" | "HOLD" | "EXIT" | "WATCH" | "NO_POSITION",
      "rationale": string,
      "ips_compatible": boolean,
      "ips_conflict": string | null
    }
  ],
  "macro_themes": string[],
  "ips_change_suggested": boolean,
  "ips_change_rationale": string | null,
  "confidence": "HIGH" | "MEDIUM" | "SPECULATIVE",
  "proposed_action_type": "TRADE" | "IPS_UPDATE" | "WATCH" | "NO_ACTION"
}
      `,
    });

    if (contentParts.length === 0) {
      // Nothing to analyze
      await db
        .update(convictionsTable)
        .set({
          claudeProposal: { summary: "No content provided for analysis.", relevance: "LOW", affected_tickers: [], macro_themes: [], ips_change_suggested: false, ips_change_rationale: null, confidence: "SPECULATIVE", proposed_action_type: "NO_ACTION" } as unknown as Record<string, unknown>,
          proposalStatus: "PENDING_REVIEW",
          updatedAt: new Date(),
        })
        .where(eq(convictionsTable.id, convictionId));
      return;
    }

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: contentParts as Parameters<typeof anthropic.messages.create>[0]["messages"][0]["content"],
        },
      ],
    });

    const rawText = response.content[0]?.type === "text" ? response.content[0].text : null;
    if (!rawText) {
      console.error("[convictions] Claude returned no text content");
      await db
        .update(convictionsTable)
        .set({
          claudeProposal: { raw: "", parse_error: true } as unknown as Record<string, unknown>,
          proposalStatus: "PENDING_REVIEW",
          updatedAt: new Date(),
        })
        .where(eq(convictionsTable.id, convictionId));
      return;
    }

    // Strip markdown fences
    const stripped = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    let proposal: ClaudeProposal;
    try {
      proposal = JSON.parse(stripped) as ClaudeProposal;
    } catch (parseErr) {
      console.error("[convictions] Claude JSON parse failed:", parseErr, "\nRaw:", rawText);
      await db
        .update(convictionsTable)
        .set({
          claudeProposal: { raw: rawText, parse_error: true } as unknown as Record<string, unknown>,
          proposalStatus: "PENDING_REVIEW",
          updatedAt: new Date(),
        })
        .where(eq(convictionsTable.id, convictionId));
      return;
    }

    // Success path
    const extractedTickers = proposal.affected_tickers?.map((t) => t.ticker).filter(Boolean) ?? [];
    const extractedThemes = proposal.macro_themes?.filter(Boolean) ?? [];

    await db
      .update(convictionsTable)
      .set({
        claudeProposal: proposal as unknown as Record<string, unknown>,
        proposalStatus: "PENDING_REVIEW",
        tickers: extractedTickers.length > 0 ? extractedTickers : (conviction.tickers ?? []),
        themes: extractedThemes.length > 0 ? extractedThemes : (conviction.themes ?? []),
        updatedAt: new Date(),
      })
      .where(eq(convictionsTable.id, convictionId));

    // Fire local push notification
    notifyPendingReview(convictionId, proposal);
  } catch (err) {
    console.error("[convictions] Claude processing error:", err);
    try {
      await db
        .update(convictionsTable)
        .set({
          claudeProposal: { raw: String(err), parse_error: true } as unknown as Record<string, unknown>,
          proposalStatus: "PENDING_REVIEW",
          updatedAt: new Date(),
        })
        .where(eq(convictionsTable.id, convictionId));
    } catch { /* ignore secondary error */ }
  }
}

// Notify client of PENDING_REVIEW transition via server-side event or log
// Actual Expo push is handled by the mobile app polling; this is a server-side log/hook.
function notifyPendingReview(convictionId: string, proposal: ClaudeProposal): void {
  const firstTicker = proposal.affected_tickers?.[0]?.ticker;
  const firstTheme = proposal.macro_themes?.[0];
  const body = firstTicker ?? firstTheme ?? "Signal ready";
  console.info(`[convictions] PENDING_REVIEW ${convictionId}: ${body}`);
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// POST /convictions — create via multipart/form-data
router.post(
  "/",
  upload.array("screenshots"),
  async (req: Request, res: Response) => {
    try {
      const {
        source_type,
        source_url,
        source_name,
        raw_note,
        tickers: tickersRaw,
        themes: themesRaw,
      } = req.body as Record<string, string>;

      if (!source_type) {
        res.status(400).json({ error: "source_type is required" });
        return;
      }

      const files = (req.files ?? []) as Express.Multer.File[];

      // Parse optional JSON arrays
      let tickers: string[] = [];
      let themes: string[] = [];
      try { tickers = tickersRaw ? (JSON.parse(tickersRaw) as string[]) : []; } catch { tickers = []; }
      try { themes = themesRaw ? (JSON.parse(themesRaw) as string[]) : []; } catch { themes = []; }

      // Insert conviction with PROCESSING status
      const [conviction] = await db
        .insert(convictionsTable)
        .values({
          sourceType: source_type,
          sourceUrl: source_url || null,
          sourceName: source_name || null,
          rawNote: raw_note || null,
          tickers: tickers.length > 0 ? tickers : null,
          themes: themes.length > 0 ? themes : null,
          fetchStatus: source_url ? "PENDING" : "SKIPPED",
          proposalStatus: "PROCESSING",
          userId: req.userId,
        })
        .returning();

      if (!conviction) {
        res.status(500).json({ error: "Failed to create conviction" });
        return;
      }

      // Save attachment records
      let attachments: ConvictionAttachment[] = [];
      if (files.length > 0) {
        const attachmentValues = files.map((file, idx) => ({
          convictionId: conviction.id,
          storagePath: path.join("uploads", "convictions", file.filename),
          mimeType: file.mimetype,
          displayOrder: idx,
        }));

        attachments = await db
          .insert(convictionAttachmentsTable)
          .values(attachmentValues)
          .returning();
      }

      // Respond immediately
      res.status(201).json(formatConviction(conviction, attachments));

      // Async: fetch URL content then call Claude (fire-and-forget)
      setImmediate(async () => {
        try {
          if (source_url) {
            const { content, status } = await fetchUrlContent(source_url);
            await db
              .update(convictionsTable)
              .set({
                fetchedContent: content,
                fetchStatus: status,
                updatedAt: new Date(),
              })
              .where(eq(convictionsTable.id, conviction.id));
          }
          await processWithClaude(conviction.id);
        } catch (asyncErr) {
          console.error("[convictions] async processing error:", asyncErr);
        }
      });
    } catch (err) {
      console.error("[convictions] POST error:", err);
      res.status(500).json({ error: "Failed to create conviction" });
    }
  },
);

// GET /convictions — list with optional filters
router.get("/", async (req: Request, res: Response) => {
  try {
    const { proposal_status, ticker } = req.query as Record<string, string>;

    let rows: Conviction[];

    if (proposal_status) {
      rows = await db
        .select()
        .from(convictionsTable)
        .where(and(eq(convictionsTable.proposalStatus, proposal_status), eq(convictionsTable.userId, req.userId)))
        .orderBy(desc(convictionsTable.createdAt));
    } else {
      rows = await db
        .select()
        .from(convictionsTable)
        .where(eq(convictionsTable.userId, req.userId))
        .orderBy(desc(convictionsTable.createdAt));
    }

    // Ticker filter (in-memory — tickers is a text array)
    if (ticker) {
      rows = rows.filter((r) => r.tickers?.includes(ticker.toUpperCase()));
    }

    // Fetch all attachments in one query
    const allAttachments = rows.length > 0
      ? await db
        .select()
        .from(convictionAttachmentsTable)
        .orderBy(convictionAttachmentsTable.displayOrder)
      : [];

    const attachmentsByConviction = new Map<string, ConvictionAttachment[]>();
    for (const a of allAttachments) {
      const list = attachmentsByConviction.get(a.convictionId) ?? [];
      list.push(a);
      attachmentsByConviction.set(a.convictionId, list);
    }

    res.json(rows.map((r) => formatConviction(r, attachmentsByConviction.get(r.id) ?? [])));
  } catch (err) {
    console.error("[convictions] GET / error:", err);
    res.status(500).json({ error: "Failed to fetch convictions" });
  }
});

// GET /convictions/:id/status — poll endpoint
router.get("/:id/status", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [row] = await db
      .select()
      .from(convictionsTable)
      .where(eq(convictionsTable.id, id as string));

    if (!row) {
      res.status(404).json({ error: "Conviction not found" });
      return;
    }

    res.json({
      id: row.id,
      proposalStatus: row.proposalStatus,
      claudeProposal: row.claudeProposal ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch status" });
  }
});

// GET /convictions/:id — full detail
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [row] = await db
      .select()
      .from(convictionsTable)
      .where(eq(convictionsTable.id, id as string));

    if (!row) {
      res.status(404).json({ error: "Conviction not found" });
      return;
    }

    const attachments = await getAttachments(id as string);
    res.json(formatConviction(row, attachments));
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch conviction" });
  }
});

// PATCH /convictions/:id/approve
router.patch("/:id/approve", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [conviction] = await db
      .select()
      .from(convictionsTable)
      .where(and(eq(convictionsTable.id, id as string), eq(convictionsTable.userId, req.userId)));

    if (!conviction) {
      res.status(404).json({ error: "Conviction not found" });
      return;
    }

    if (conviction.proposalStatus !== "PENDING_REVIEW") {
      res.status(400).json({ error: "Only PENDING_REVIEW convictions can be approved" });
      return;
    }

    const proposal = conviction.claudeProposal as ClaudeProposal | null;
    let actionId: number | null = null;

    // If TRADE type, create an orderSuggestion for the first ADD/TRIM/EXIT ticker
    if (proposal && proposal.proposed_action_type === "TRADE" && !proposal.parse_error) {
      const actionable = proposal.affected_tickers?.find(
        (t) => t.suggested_action === "ADD" || t.suggested_action === "TRIM" || t.suggested_action === "EXIT",
      );
      if (actionable) {
        const side = actionable.suggested_action === "ADD" ? "buy" : "sell";
        const accounts = await db.select().from(accountsTable).where(eq(accountsTable.userId, req.userId)).limit(1);
        if (accounts.length > 0) {
          const [suggestion] = await db
            .insert(orderSuggestionsTable)
            .values({
              accountId: accounts[0].id,
              symbol: actionable.ticker,
              side,
              orderType: "limit",
              urgency: proposal.confidence === "HIGH" ? "high" : proposal.confidence === "MEDIUM" ? "medium" : "low",
              rationale: actionable.rationale,
              trigger: `Conviction: ${conviction.sourceName || conviction.sourceType} — ${proposal.summary?.slice(0, 100) ?? ""}`,
              userId: req.userId,
            })
            .returning();
          if (suggestion) actionId = suggestion.id;
        }
      }
    }

    const now = new Date();
    const [updated] = await db
      .update(convictionsTable)
      .set({
        proposalStatus: "APPROVED",
        actionId: actionId ?? conviction.actionId,
        updatedAt: now,
      })
      .where(eq(convictionsTable.id, id as string))
      .returning();

    const attachments = await getAttachments(id as string);
    res.json({
      conviction: formatConviction(updated!, attachments),
      actionId,
    });
  } catch (err) {
    console.error("[convictions] PATCH /:id/approve error:", err);
    res.status(500).json({ error: "Failed to approve conviction" });
  }
});

// PATCH /convictions/:id/reject
router.patch("/:id/reject", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { rejection_reason } = req.body as { rejection_reason?: string };

    const [conviction] = await db
      .select()
      .from(convictionsTable)
      .where(eq(convictionsTable.id, id as string));

    if (!conviction) {
      res.status(404).json({ error: "Conviction not found" });
      return;
    }

    const [updated] = await db
      .update(convictionsTable)
      .set({
        proposalStatus: "REJECTED",
        rejectionReason: rejection_reason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(convictionsTable.id, id as string))
      .returning();

    const attachments = await getAttachments(id as string);
    res.json(formatConviction(updated!, attachments));
  } catch (err) {
    res.status(500).json({ error: "Failed to reject conviction" });
  }
});

// DELETE /convictions/:id/attachments/:attachmentId
router.delete("/:id/attachments/:attachmentId", async (req: Request, res: Response) => {
  try {
    const { id, attachmentId } = req.params;

    const [conviction] = await db
      .select()
      .from(convictionsTable)
      .where(eq(convictionsTable.id, id as string));

    if (!conviction) {
      res.status(404).json({ error: "Conviction not found" });
      return;
    }

    if (conviction.proposalStatus !== "PROCESSING" && conviction.proposalStatus !== "PENDING_REVIEW") {
      res.status(400).json({ error: "Attachments can only be removed from PROCESSING or PENDING_REVIEW convictions" });
      return;
    }

    const [attachment] = await db
      .select()
      .from(convictionAttachmentsTable)
      .where(
        and(
          eq(convictionAttachmentsTable.id, attachmentId as string),
          eq(convictionAttachmentsTable.convictionId, id as string),
        ),
      );

    if (!attachment) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }

    // Delete the file from disk
    const fullPath = path.join(process.cwd(), attachment.storagePath);
    if (fs.existsSync(fullPath)) {
      try { fs.unlinkSync(fullPath); } catch { /* ignore */ }
    }

    await db
      .delete(convictionAttachmentsTable)
      .where(eq(convictionAttachmentsTable.id, attachmentId as string));

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete attachment" });
  }
});

export default router;
