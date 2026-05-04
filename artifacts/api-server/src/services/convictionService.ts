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
import { logger } from "../lib/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_CONC_LIMIT = 0.20;
const DEFAULT_LEV_CEILING = 1.50;

// ── Private helpers ───────────────────────────────────────────────────────────

function formatConviction(row: Conviction, attachments: ConvictionAttachment[]) {
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

async function fetchUrlContent(url: string): Promise<{ content: string | null; status: "SUCCESS" | "FAILED" }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TradeNavigatorBot/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { content: null, status: "FAILED" };
    const html = await res.text();
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

function notifyPendingReview(convictionId: string, proposal: ClaudeProposal): void {
  const firstTicker = proposal.affected_tickers?.[0]?.ticker;
  const firstTheme = proposal.macro_themes?.[0];
  const body = firstTicker ?? firstTheme ?? "Signal ready";
  console.info(`[convictions] PENDING_REVIEW ${convictionId}: ${body}`);
}

async function processWithClaude(convictionId: string): Promise<void> {
  try {
    const [convictionRows, attachments] = await Promise.all([
      db.select().from(convictionsTable).where(eq(convictionsTable.id, convictionId)),
      getAttachments(convictionId),
    ]);

    const conviction = convictionRows[0];
    if (!conviction) return;

    const ownerUserId = conviction.userId ?? "";
    const [accounts, positions, policyRows] = await Promise.all([
      db.select().from(accountsTable).where(eq(accountsTable.userId, ownerUserId)),
      db.select().from(positionsTable).where(eq(positionsTable.userId, ownerUserId)),
      db.select().from(portfolioPolicyTable).where(eq(portfolioPolicyTable.userId, ownerUserId)).limit(1),
    ]);

    const policy = policyRows[0] ?? null;

    let concentrationLimit = DEFAULT_CONC_LIMIT;
    let leverageCeiling = DEFAULT_LEV_CEILING;
    if (accounts.length > 0) {
      const acct = accounts[0];
      if (acct.concentrationLimit != null) concentrationLimit = parseFloat(acct.concentrationLimit);
      if (acct.leverageCeiling != null) leverageCeiling = parseFloat(acct.leverageCeiling);
    }

    let totalMV = 0;
    let totalCash = 0;
    for (const acct of accounts) totalCash += parseFloat(acct.currentBalance);
    for (const pos of positions) totalMV += parseFloat(pos.quantity) * parseFloat(pos.currentPrice);
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

    type ContentPart =
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

    const contentParts: ContentPart[] = [];

    if (conviction.fetchedContent) {
      contentParts.push({ type: "text", text: `Article content:\n${conviction.fetchedContent}` });
    }

    for (const attachment of attachments) {
      const fullPath = path.join(process.cwd(), attachment.storagePath);
      if (fs.existsSync(fullPath)) {
        const base64 = fs.readFileSync(fullPath).toString("base64");
        contentParts.push({
          type: "image",
          source: { type: "base64", media_type: attachment.mimeType, data: base64 },
        });
      }
    }

    if (conviction.rawNote) {
      contentParts.push({ type: "text", text: `Trader's note: ${conviction.rawNote}` });
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
      logger.error("[convictions] Claude returned no text content");
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

    const stripped = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    let proposal: ClaudeProposal;
    try {
      proposal = JSON.parse(stripped) as ClaudeProposal;
    } catch (parseErr) {
      logger.error({ err: parseErr, rawText }, "[convictions] Claude JSON parse failed");
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

    notifyPendingReview(convictionId, proposal);
  } catch (err) {
    logger.error(err, "[convictions] Claude processing error");
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

// ── Public service functions ──────────────────────────────────────────────────

export interface CreateConvictionInput {
  sourceType: string;
  sourceUrl?: string | null;
  sourceName?: string | null;
  rawNote?: string | null;
  tickers: string[];
  themes: string[];
  userId: string;
}

export interface AttachmentInput {
  filename: string;
  mimetype: string;
}

export async function createConviction(
  input: CreateConvictionInput,
  files: AttachmentInput[],
) {
  const [conviction] = await db
    .insert(convictionsTable)
    .values({
      sourceType: input.sourceType,
      sourceUrl: input.sourceUrl || null,
      sourceName: input.sourceName || null,
      rawNote: input.rawNote || null,
      tickers: input.tickers.length > 0 ? input.tickers : null,
      themes: input.themes.length > 0 ? input.themes : null,
      fetchStatus: input.sourceUrl ? "PENDING" : "SKIPPED",
      proposalStatus: "PROCESSING",
      userId: input.userId,
    })
    .returning();

  if (!conviction) return null;

  let attachments: ConvictionAttachment[] = [];
  if (files.length > 0) {
    const attachmentValues = files.map((file, idx) => ({
      convictionId: conviction.id,
      storagePath: path.join("uploads", "convictions", file.filename),
      mimeType: file.mimetype,
      displayOrder: idx,
    }));
    attachments = await db.insert(convictionAttachmentsTable).values(attachmentValues).returning();
  }

  return formatConviction(conviction, attachments);
}

/**
 * Fire-and-forget async pipeline: optionally fetch URL content, then run Claude processing.
 * The route calls this after sending the 201 response (inside setImmediate).
 */
export async function runConvictionPipeline(convictionId: string, sourceUrl?: string | null): Promise<void> {
  if (sourceUrl) {
    const { content, status } = await fetchUrlContent(sourceUrl);
    await db
      .update(convictionsTable)
      .set({ fetchedContent: content, fetchStatus: status, updatedAt: new Date() })
      .where(eq(convictionsTable.id, convictionId));
  }
  await processWithClaude(convictionId);
}

export interface ListConvictionsFilters {
  proposalStatus?: string;
  ticker?: string;
}

export async function listConvictions(userId: string, filters: ListConvictionsFilters) {
  let rows: Conviction[];

  if (filters.proposalStatus) {
    rows = await db
      .select()
      .from(convictionsTable)
      .where(and(eq(convictionsTable.proposalStatus, filters.proposalStatus), eq(convictionsTable.userId, userId)))
      .orderBy(desc(convictionsTable.createdAt));
  } else {
    rows = await db
      .select()
      .from(convictionsTable)
      .where(eq(convictionsTable.userId, userId))
      .orderBy(desc(convictionsTable.createdAt));
  }

  if (filters.ticker) {
    const upper = filters.ticker.toUpperCase();
    rows = rows.filter((r) => r.tickers?.includes(upper));
  }

  const allAttachments = rows.length > 0
    ? await db.select().from(convictionAttachmentsTable).orderBy(convictionAttachmentsTable.displayOrder)
    : [];

  const attachmentsByConviction = new Map<string, ConvictionAttachment[]>();
  for (const a of allAttachments) {
    const list = attachmentsByConviction.get(a.convictionId) ?? [];
    list.push(a);
    attachmentsByConviction.set(a.convictionId, list);
  }

  return rows.map((r) => formatConviction(r, attachmentsByConviction.get(r.id) ?? []));
}

export async function getConvictionStatus(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(convictionsTable)
    .where(and(eq(convictionsTable.id, id), eq(convictionsTable.userId, userId)));
  if (!row) return null;
  return { id: row.id, proposalStatus: row.proposalStatus, claudeProposal: row.claudeProposal ?? null };
}

export async function getConviction(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(convictionsTable)
    .where(and(eq(convictionsTable.id, id), eq(convictionsTable.userId, userId)));
  if (!row) return null;
  const attachments = await getAttachments(id);
  return formatConviction(row, attachments);
}

export async function approveConviction(id: string, userId: string) {
  const [conviction] = await db
    .select()
    .from(convictionsTable)
    .where(and(eq(convictionsTable.id, id), eq(convictionsTable.userId, userId)));

  if (!conviction) return { notFound: true } as const;
  if (conviction.proposalStatus !== "PENDING_REVIEW") return { badStatus: true } as const;

  const proposal = conviction.claudeProposal as ClaudeProposal | null;
  let actionId: number | null = null;

  if (proposal && proposal.proposed_action_type === "TRADE" && !proposal.parse_error) {
    const actionable = proposal.affected_tickers?.find(
      (t) => t.suggested_action === "ADD" || t.suggested_action === "TRIM" || t.suggested_action === "EXIT",
    );
    if (actionable) {
      const side = actionable.suggested_action === "ADD" ? "buy" : "sell";
      const accounts = await db.select().from(accountsTable).where(eq(accountsTable.userId, userId)).limit(1);
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
            userId,
          })
          .returning();
        if (suggestion) actionId = suggestion.id;
      }
    }
  }

  const [updated] = await db
    .update(convictionsTable)
    .set({ proposalStatus: "APPROVED", actionId: actionId ?? conviction.actionId, updatedAt: new Date() })
    .where(eq(convictionsTable.id, id))
    .returning();

  const attachments = await getAttachments(id);
  return { conviction: formatConviction(updated!, attachments), actionId };
}

export async function rejectConviction(id: string, userId: string, rejectionReason?: string | null) {
  const [existing] = await db
    .select()
    .from(convictionsTable)
    .where(and(eq(convictionsTable.id, id), eq(convictionsTable.userId, userId)));
  if (!existing) return null;

  const [updated] = await db
    .update(convictionsTable)
    .set({ proposalStatus: "REJECTED", rejectionReason: rejectionReason ?? null, updatedAt: new Date() })
    .where(eq(convictionsTable.id, id))
    .returning();

  const attachments = await getAttachments(id);
  return formatConviction(updated!, attachments);
}

export async function deleteAttachment(convictionId: string, attachmentId: string, userId: string) {
  const [conviction] = await db
    .select()
    .from(convictionsTable)
    .where(and(eq(convictionsTable.id, convictionId), eq(convictionsTable.userId, userId)));

  if (!conviction) return { notFound: "conviction" } as const;

  if (conviction.proposalStatus !== "PROCESSING" && conviction.proposalStatus !== "PENDING_REVIEW") {
    return { badStatus: true } as const;
  }

  const [attachment] = await db
    .select()
    .from(convictionAttachmentsTable)
    .where(and(
      eq(convictionAttachmentsTable.id, attachmentId),
      eq(convictionAttachmentsTable.convictionId, convictionId),
    ));

  if (!attachment) return { notFound: "attachment" } as const;

  const fullPath = path.join(process.cwd(), attachment.storagePath);
  if (fs.existsSync(fullPath)) {
    try { fs.unlinkSync(fullPath); } catch { /* ignore */ }
  }

  await db.delete(convictionAttachmentsTable).where(eq(convictionAttachmentsTable.id, attachmentId));
  return { success: true } as const;
}
