import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  policyProposalsTable,
  policyProposalItemsTable,
  positionsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router: IRouter = Router();

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProposedFields {
  positionBucket?: string | null;
  ipsAction?: string | null;
  stopPrice?: number | null;
  addZoneLow?: number | null;
  addZoneHigh?: number | null;
  policyNote?: string | null;
}

// ── System prompt ─────────────────────────────────────────────────────────────

const IPS_SYSTEM_PROMPT = `You are an assistant mapping an Investment Policy Statement into structured portfolio policy fields. Output proposals only — do NOT write to any database.

For every extracted value, cite the exact source snippet (<= 240 chars) and note confidence 0-1.

Output JSON only, no markdown:
{
  "ipsVersion": "string",
  "proposals": [
    {
      "entityType": "position",
      "entityKey": "SYMBOL",
      "proposedFields": {
        "positionBucket": null,
        "ipsAction": null,
        "stopPrice": null,
        "addZoneLow": null,
        "addZoneHigh": null,
        "policyNote": null
      },
      "confidence": 0.9,
      "rationale": "short explanation",
      "evidenceSnippet": "exact text from doc <= 240 chars"
    }
  ],
  "unmatched": ["symbols mentioned but not in portfolio"],
  "globalQuestions": ["ambiguities needing clarification"]
}

Valid positionBucket values: core, swing, speculative, crypto, cash
Valid ipsAction values: hold, add, trim, cut, watch

Never infer a stopPrice if not explicitly stated — leave null and note it in globalQuestions.`;

// ── Response helpers ──────────────────────────────────────────────────────────

function itemToResponse(item: typeof policyProposalItemsTable.$inferSelect) {
  return {
    id: item.id,
    proposalId: item.proposalId,
    entityType: item.entityType,
    entityKey: item.entityKey,
    proposedFields: item.proposedFields as ProposedFields,
    confidence: item.confidence != null ? parseFloat(item.confidence) : null,
    rationale: item.rationale,
    evidenceSnippet: item.evidenceSnippet,
    status: item.status,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function proposalToResponse(
  proposal: typeof policyProposalsTable.$inferSelect,
  items: (typeof policyProposalItemsTable.$inferSelect)[],
  extra?: { globalQuestions?: string[]; unmatched?: string[] },
) {
  return {
    id: proposal.id,
    ipsVersion: proposal.ipsVersion,
    sourceFilename: proposal.sourceFilename,
    status: proposal.status,
    createdAt: proposal.createdAt.toISOString(),
    items: items.map(itemToResponse),
    globalQuestions: extra?.globalQuestions ?? [],
    unmatched: extra?.unmatched ?? [],
  };
}

// ── POST /ips/parse ───────────────────────────────────────────────────────────

router.post("/parse", async (req, res) => {
  try {
    const { text, ipsVersion, filename } = req.body as {
      text?: string;
      ipsVersion?: string;
      filename?: string;
    };

    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "text is required" });
    }

    // Call Claude
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: IPS_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Parse this Investment Policy Statement and extract position-level policy:\n\n${text}`,
        },
      ],
    });

    console.log('[ips/parse] Claude content blocks:', JSON.stringify(message.content, null, 2));

    const rawText =
      message.content[0]?.type === "text" ? message.content[0].text : "";

    console.log('[ips/parse] Raw Claude response length:', rawText?.length);
    console.log('[ips/parse] Raw Claude response (first 500 chars):', rawText?.substring(0, 500));

    type ParsedResponse = {
      ipsVersion?: string;
      proposals?: Array<{
        entityType?: string;
        entityKey?: string;
        proposedFields?: ProposedFields;
        confidence?: number;
        rationale?: string;
        evidenceSnippet?: string;
      }>;
      globalQuestions?: string[];
      unmatched?: string[];
    };

    // Strip markdown fences, then slice to the outermost { … } object.
    const cleaned = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const s = cleaned.indexOf("{");
    const e = cleaned.lastIndexOf("}");
    const jsonCandidate = s !== -1 && e > s ? cleaned.slice(s, e + 1) : cleaned;

    let parsed: ParsedResponse;
    try {
      parsed = JSON.parse(jsonCandidate) as ParsedResponse;
    } catch (parseErr) {
      console.error(
        "[ips/parse] JSON.parse failed.\nRaw Claude response:\n" + rawText,
        "\nParse error:", parseErr,
      );
      return res.status(502).json({
        error: "Could not parse AI response. Check server logs for details.",
      });
    }

    const proposals = (parsed.proposals ?? []).filter(
      p => p.entityKey && p.proposedFields,
    );

    // Insert proposal header
    const [proposal] = await db
      .insert(policyProposalsTable)
      .values({
        ipsVersion: ipsVersion || parsed.ipsVersion || null,
        sourceFilename: filename || null,
        status: "pending",
      })
      .returning();

    // Insert items (skip if none extracted)
    let items: (typeof policyProposalItemsTable.$inferSelect)[] = [];
    if (proposals.length > 0) {
      items = await db
        .insert(policyProposalItemsTable)
        .values(
          proposals.map(p => ({
            proposalId: proposal.id,
            entityType: p.entityType ?? "position",
            entityKey: (p.entityKey ?? "").toUpperCase(),
            proposedFields: p.proposedFields as Record<string, unknown>,
            confidence:
              p.confidence != null ? String(p.confidence) : null,
            rationale: p.rationale ?? null,
            evidenceSnippet: p.evidenceSnippet
              ? p.evidenceSnippet.slice(0, 240)
              : null,
            status: "pending",
          })),
        )
        .returning();
    }

    return res.status(201).json(
      proposalToResponse(proposal, items, {
        globalQuestions: parsed.globalQuestions ?? [],
        unmatched: parsed.unmatched ?? [],
      }),
    );
  } catch (err) {
    console.error("[ips/parse] error:", err);
    return res.status(500).json({ error: "Failed to parse IPS document" });
  }
});

// ── GET /ips/proposals ────────────────────────────────────────────────────────

router.get("/proposals", async (_req, res) => {
  try {
    const proposals = await db
      .select()
      .from(policyProposalsTable)
      .orderBy(desc(policyProposalsTable.createdAt));

    const allItems = await db.select().from(policyProposalItemsTable);

    return res.json(
      proposals.map(p =>
        proposalToResponse(
          p,
          allItems.filter(i => i.proposalId === p.id),
        ),
      ),
    );
  } catch {
    return res.status(500).json({ error: "Failed to fetch proposals" });
  }
});

// ── GET /ips/proposals/:id ────────────────────────────────────────────────────

router.get("/proposals/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [proposal] = await db
      .select()
      .from(policyProposalsTable)
      .where(eq(policyProposalsTable.id, id));
    if (!proposal) return res.status(404).json({ error: "Proposal not found" });

    const items = await db
      .select()
      .from(policyProposalItemsTable)
      .where(eq(policyProposalItemsTable.proposalId, id));

    return res.json(proposalToResponse(proposal, items));
  } catch {
    return res.status(500).json({ error: "Failed to fetch proposal" });
  }
});

// ── PUT /ips/proposals/:id/items/:itemId ──────────────────────────────────────

router.put("/proposals/:id/items/:itemId", async (req, res) => {
  try {
    const itemId = parseInt(req.params.itemId);
    const { status, editedFields } = req.body as {
      status: string;
      editedFields?: ProposedFields;
    };

    if (!["approved", "rejected", "edited"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const [item] = await db
      .select()
      .from(policyProposalItemsTable)
      .where(eq(policyProposalItemsTable.id, itemId));
    if (!item) return res.status(404).json({ error: "Item not found" });

    let updatedItem: typeof policyProposalItemsTable.$inferSelect;

    if (status === "approved" || status === "edited") {
      const fieldsToApply: ProposedFields =
        status === "edited" && editedFields
          ? editedFields
          : (item.proposedFields as ProposedFields);

      await db.transaction(async tx => {
        // Get ipsVersion from the parent proposal
        const [proposal] = await tx
          .select()
          .from(policyProposalsTable)
          .where(eq(policyProposalsTable.id, item.proposalId));

        // Build the position update payload
        const posUpdates: Record<string, unknown> = { updatedAt: new Date() };
        if ("positionBucket" in fieldsToApply)
          posUpdates.positionBucket = fieldsToApply.positionBucket ?? null;
        if ("ipsAction" in fieldsToApply)
          posUpdates.ipsAction = fieldsToApply.ipsAction ?? null;
        if ("stopPrice" in fieldsToApply)
          posUpdates.stopPrice =
            fieldsToApply.stopPrice != null
              ? String(fieldsToApply.stopPrice)
              : null;
        if ("addZoneLow" in fieldsToApply)
          posUpdates.addZoneLow =
            fieldsToApply.addZoneLow != null
              ? String(fieldsToApply.addZoneLow)
              : null;
        if ("addZoneHigh" in fieldsToApply)
          posUpdates.addZoneHigh =
            fieldsToApply.addZoneHigh != null
              ? String(fieldsToApply.addZoneHigh)
              : null;
        if ("policyNote" in fieldsToApply)
          posUpdates.policyNote = fieldsToApply.policyNote ?? null;
        if (proposal?.ipsVersion)
          posUpdates.ipsVersion = proposal.ipsVersion;

        // Write to all positions for this symbol (IPS policy is symbol-wide)
        await tx
          .update(positionsTable)
          .set(posUpdates)
          .where(eq(positionsTable.symbol, item.entityKey));

        // Update the proposal item
        const itemUpdates: Record<string, unknown> = {
          status,
          updatedAt: new Date(),
        };
        if (status === "edited" && editedFields) {
          itemUpdates.proposedFields = editedFields as Record<string, unknown>;
        }

        const [updated] = await tx
          .update(policyProposalItemsTable)
          .set(itemUpdates)
          .where(eq(policyProposalItemsTable.id, itemId))
          .returning();
        updatedItem = updated;
      });
    } else {
      // rejected — just update status, no position writes
      const [updated] = await db
        .update(policyProposalItemsTable)
        .set({ status, updatedAt: new Date() })
        .where(eq(policyProposalItemsTable.id, itemId))
        .returning();
      updatedItem = updated;
    }

    return res.json(itemToResponse(updatedItem!));
  } catch (err) {
    console.error("[ips/items] error:", err);
    return res.status(500).json({ error: "Failed to update proposal item" });
  }
});

export default router;
