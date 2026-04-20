import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  policyProposalsTable,
  policyProposalItemsTable,
  positionsTable,
  accountsTable,
  ipsBuilderSessionsTable,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
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
  secondaryBucket?: string | null;
  splitRatio?: number | null;
}

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

// ── GET /ips/proposals/pending-items ─────────────────────────────────────────

router.get("/proposals/pending-items", async (_req, res) => {
  try {
    const builderProposal = await db
      .select()
      .from(policyProposalsTable)
      .where(eq(policyProposalsTable.sourceFilename, "__ips_builder__"))
      .limit(1)
      .then(rows => rows[0]);

    if (!builderProposal) return res.json([]);

    const items = await db
      .select()
      .from(policyProposalItemsTable)
      .where(
        and(
          eq(policyProposalItemsTable.proposalId, builderProposal.id),
          eq(policyProposalItemsTable.status, "pending"),
        ),
      )
      .orderBy(policyProposalItemsTable.entityKey);

    return res.json(
      items.map(item => ({
        ...itemToResponse(item),
        ipsVersion: builderProposal.ipsVersion,
      })),
    );
  } catch (err) {
    console.error("[ips/proposals/pending-items] error:", err);
    return res.status(500).json({ error: "Failed to fetch pending items" });
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
        if ("secondaryBucket" in fieldsToApply)
          posUpdates.secondaryBucket = fieldsToApply.secondaryBucket ?? null;
        if ("splitRatio" in fieldsToApply)
          posUpdates.splitRatio =
            fieldsToApply.splitRatio != null
              ? String(fieldsToApply.splitRatio)
              : null;
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

// ── IPS Builder types ─────────────────────────────────────────────────────────

interface IpsProposal {
  type?: "goals_complete";
  entityType?: string;
  entityKey?: string;
  proposedFields?: Record<string, unknown>;
  confidence?: number;
  rationale?: string;
}

type HistoryMessage = { role: "user" | "assistant"; content: string };

function buildBuilderSystemPrompt(opts: {
  positions: Array<{
    symbol: string;
    quantity: number;
    unrealizedPnl: number;
    positionBucket: string | null;
    ipsAction: string | null;
  }>;
  coveredPositions: string[];
  goalsComplete: boolean;
  nextPosition: { symbol: string; positionBucket: string | null; ipsAction: string | null } | null;
  totalNavUsd: number;
}): string {
  const { positions, coveredPositions, goalsComplete, nextPosition, totalNavUsd } = opts;

  const positionLines = positions
    .map(p => {
      const pnlSign = p.unrealizedPnl >= 0 ? "+" : "";
      const covered = coveredPositions.includes(p.symbol) ? " ✓" : "";
      return `  ${p.symbol}${covered}: qty=${p.quantity.toFixed(2)}, P&L=${pnlSign}${p.unrealizedPnl.toFixed(0)} USD, bucket=${p.positionBucket ?? "unset"}, action=${p.ipsAction ?? "unset"}`;
    })
    .join("\n");

  const navFormatted = totalNavUsd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  const uncoveredCount = positions.length - coveredPositions.length;

  const phaseInstructions = !goalsComplete
    ? `CURRENT PHASE: Goals Discovery
Ask about investment goals in a conversational way. Cover:
1. Purpose of this portfolio (retirement, wealth building, income, etc.)
2. Time horizon
3. Risk tolerance (can they stomach a 30% drawdown?)
4. Expected contributions or withdrawals

Ask at most 2 questions at a time. Be conversational, not clinical.
When you have enough to characterise their goals, embed this marker at the end of your response:
<!-- IPS_PROPOSAL: {"type":"goals_complete"} -->`
    : nextPosition
    ? `CURRENT PHASE: Position Classification
Next position to cover: ${nextPosition.symbol}
Current bucket: ${nextPosition.positionBucket ?? "unset"}, current action: ${nextPosition.ipsAction ?? "unset"}

Propose a positionBucket and ipsAction for ${nextPosition.symbol} based on its P&L and portfolio context. Ask the user to confirm or adjust. Keep it to 2 questions max.

Valid positionBucket values: core, swing, speculative, crypto, cash, def, anchor, inc, cut
Valid ipsAction values: hold, add, trim, cut, watch, exit, monitor

When the user confirms (or adjusts), embed the proposal at the end of your response:
<!-- IPS_PROPOSAL: {"entityType":"position","entityKey":"${nextPosition.symbol}","proposedFields":{"positionBucket":"<value>","ipsAction":"<value>"},"confidence":0.9,"rationale":"<short reason>"} -->`
    : `CURRENT PHASE: Complete
All positions have been classified. Summarise the IPS policy you've built with the user and invite them to review.`;

  return `You are an IPS (Investment Policy Statement) builder assistant helping a trader systematically classify their portfolio positions.

Portfolio positions (${positions.length} total, ${coveredPositions.length} covered, ${uncoveredCount} remaining):
${positionLines}
Total portfolio NAV: ${navFormatted}

${phaseInstructions}

Rules:
- Ask at most 2 questions per response
- Propose answers where data supports it — don't make the user do the thinking
- Be direct and friendly, not formal or clinical
- Never reveal the <!-- IPS_PROPOSAL --> comment syntax to the user — it is stripped before display
- Always embed the proposal comment at the very end of your response if making a proposal
- Never create entityKey values with suffixes like _LOT1, _LOT2, _SWING, or any other suffix. Each position is identified by symbol only (e.g. 'META', not 'META_LOT1'). Sleeve separation is already handled by the account structure.`;
}

// ── POST /ips/builder/next ────────────────────────────────────────────────────

router.post("/builder/next", async (req, res) => {
  try {
    const { userMessage } = req.body as { userMessage?: string };

    // Fetch or create single session (no auth yet)
    let [session] = await db.select().from(ipsBuilderSessionsTable).limit(1);
    if (!session) {
      [session] = await db
        .insert(ipsBuilderSessionsTable)
        .values({})
        .returning();
    }

    // Fetch accounts + positions
    const [accounts, positions] = await Promise.all([
      db.select().from(accountsTable),
      db.select().from(positionsTable),
    ]);

    // Compute total NAV: cash balances + position market values
    const totalCash = accounts.reduce(
      (sum, a) => sum + parseFloat(a.currentBalance),
      0,
    );
    const totalMv = positions.reduce(
      (sum, p) => sum + parseFloat(p.quantity) * parseFloat(p.currentPrice),
      0,
    );
    const totalNavUsd = totalCash + totalMv;

    // Deduplicate by symbol, keeping the row with the largest market value
    const symbolMap = new Map<string, typeof positions[0]>();
    for (const p of positions) {
      const mv = parseFloat(p.quantity) * parseFloat(p.currentPrice);
      const cur = symbolMap.get(p.symbol);
      const curMv = cur ? parseFloat(cur.quantity) * parseFloat(cur.currentPrice) : -1;
      if (!cur || mv > curMv) symbolMap.set(p.symbol, p);
    }
    const uniquePositions = [...symbolMap.values()];

    const positionSummaries = uniquePositions.map(p => ({
      symbol: p.symbol,
      quantity: parseFloat(p.quantity),
      unrealizedPnl:
        (parseFloat(p.currentPrice) - parseFloat(p.avgCost)) *
        parseFloat(p.quantity),
      positionBucket: p.positionBucket ?? null,
      ipsAction: p.ipsAction ?? null,
    }));

    let coveredPositions: string[] = [];
    try {
      const raw = session.coveredPositions;
      if (Array.isArray(raw)) {
        coveredPositions = raw as string[];
      }
    } catch {
      coveredPositions = [];
    }
    const nextPosition =
      positionSummaries.find(p => !coveredPositions.includes(p.symbol)) ?? null;

    const systemPrompt = buildBuilderSystemPrompt({
      positions: positionSummaries,
      coveredPositions,
      goalsComplete: session.goalsComplete,
      nextPosition,
      totalNavUsd,
    });

    // Build message history, appending userMessage if present
    let history: HistoryMessage[] = [];
    try {
      const raw = session.conversationHistory;
      if (Array.isArray(raw)) {
        history = raw as HistoryMessage[];
      } else if (raw && typeof raw === 'object') {
        history = Object.values(raw) as HistoryMessage[];
      }
    } catch {
      history = [];
    }
    if (userMessage?.trim()) {
      history = [...history, { role: "user" as const, content: userMessage.trim() }];
    }

    // Ensure messages always end with a user turn (Anthropic requirement)
    let messages: HistoryMessage[] =
      history.length > 0
        ? history
        : [{ role: "user", content: "Let's begin building my IPS." }];

    // If last message is assistant (e.g. first call with no userMessage
    // after session already has history), add a silent continuation prompt
    if (messages[messages.length - 1]?.role === "assistant") {
      messages = [
        ...messages,
        { role: "user", content: "Please continue." }
      ];
    }

    // Call Claude
    const claudeResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    const assistantText =
      claudeResponse.content[0]?.type === "text"
        ? claudeResponse.content[0].text
        : "";

    // Append assistant response to history
    history = [...history, { role: "assistant" as const, content: assistantText }];

    // Parse embedded <!-- IPS_PROPOSAL: {...} --> blocks
    const proposalMatches = [
      ...assistantText.matchAll(/<!--\s*IPS_PROPOSAL:\s*(\{[\s\S]*?\})\s*-->/g),
    ];
    const parsedProposals = proposalMatches.flatMap<IpsProposal>(m => {
      try {
        return [JSON.parse(m[1]!) as IpsProposal];
      } catch {
        return [];
      }
    });

    // Upsert proposals into policyProposalItemsTable
    let proposalCount = 0;
    const newlyCovered: string[] = [];
    let goalsNowComplete = session.goalsComplete;

    if (parsedProposals.length > 0) {
      // Find or create the builder proposal header (keyed by sentinel filename)
      let builderProposal = await db
        .select()
        .from(policyProposalsTable)
        .where(eq(policyProposalsTable.sourceFilename, "__ips_builder__"))
        .limit(1)
        .then(rows => rows[0]);

      if (!builderProposal) {
        [builderProposal] = await db
          .insert(policyProposalsTable)
          .values({ sourceFilename: "__ips_builder__", status: "pending" })
          .returning();
      }

      for (const proposal of parsedProposals) {
        if (proposal.type === "goals_complete") {
          goalsNowComplete = true;
          continue;
        }

        if (!proposal.entityKey || !proposal.proposedFields) continue;

        const key = proposal.entityKey.toUpperCase();

        const existing = await db
          .select()
          .from(policyProposalItemsTable)
          .where(
            and(
              eq(policyProposalItemsTable.proposalId, builderProposal.id),
              eq(policyProposalItemsTable.entityKey, key),
            ),
          )
          .limit(1)
          .then(rows => rows[0]);

        if (existing) {
          await db
            .update(policyProposalItemsTable)
            .set({
              proposedFields: proposal.proposedFields,
              rationale: proposal.rationale ?? null,
              updatedAt: new Date(),
            })
            .where(eq(policyProposalItemsTable.id, existing.id));
        } else {
          await db.insert(policyProposalItemsTable).values({
            proposalId: builderProposal.id,
            entityType: proposal.entityType ?? "position",
            entityKey: key,
            proposedFields: proposal.proposedFields,
            confidence:
              proposal.confidence != null ? String(proposal.confidence) : null,
            rationale: proposal.rationale ?? null,
            evidenceSnippet: null,
            status: "pending",
          });
        }

        proposalCount++;
        if (!coveredPositions.includes(key)) {
          newlyCovered.push(key);
        }
      }
    }

    // Update session state
    const updatedCovered = [...new Set([...coveredPositions, ...newlyCovered])];
    const ipsComplete =
      goalsNowComplete && updatedCovered.length >= uniquePositions.length;

    await db
      .update(ipsBuilderSessionsTable)
      .set({
        conversationHistory: history,
        coveredPositions: updatedCovered,
        goalsComplete: goalsNowComplete,
        ipsComplete,
        updatedAt: new Date(),
      })
      .where(eq(ipsBuilderSessionsTable.id, session.id));

    // Strip proposal comments before returning the display message
    const displayMessage = assistantText
      .replace(/<!--\s*IPS_PROPOSAL:[\s\S]*?-->/g, "")
      .trim();

    return res.json({
      message: displayMessage,
      proposalCount,
      progress: {
        covered: updatedCovered.length,
        total: uniquePositions.length,
        goalsComplete: goalsNowComplete,
      },
    });
  } catch (err) {
    console.error("[ips/builder/next] error:", err);
    return res.status(500).json({ error: "Failed to process builder step" });
  }
});

// ── GET /ips/builder/session ──────────────────────────────────────────────────

router.get("/builder/session", async (_req, res) => {
  try {
    const [session] = await db.select().from(ipsBuilderSessionsTable).limit(1);
    const allPositions = await db.select().from(positionsTable);
    const distinctSymbols = [...new Set(allPositions.map(p => p.symbol))];
    const totalSymbols = distinctSymbols.length;

    if (!session) {
      return res.json({
        goalsComplete: false,
        ipsComplete: false,
        covered: 0,
        total: totalSymbols,
        lastMessage: null,
      });
    }

    const coveredArr = Array.isArray(session.coveredPositions)
      ? (session.coveredPositions as string[])
      : [];
    const coveredCount = coveredArr.filter(s => distinctSymbols.includes(s)).length;

    const history = (session.conversationHistory as HistoryMessage[]) ?? [];
    const lastAssistant = [...history].reverse().find(m => m.role === "assistant");
    const lastMessage = lastAssistant
      ? lastAssistant.content
          .replace(/<!--\s*IPS_PROPOSAL:[\s\S]*?-->/g, "")
          .trim()
      : null;

    return res.json({
      goalsComplete: session.goalsComplete,
      ipsComplete: session.ipsComplete,
      covered: coveredCount,
      total: totalSymbols,
      lastMessage,
    });
  } catch (err) {
    console.error("[ips/builder/session] error:", err);
    return res.status(500).json({ error: "Failed to fetch builder session" });
  }
});

export default router;
