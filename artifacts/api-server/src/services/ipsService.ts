import { db } from "@workspace/db";
import {
  policyProposalsTable,
  policyProposalItemsTable,
  positionsTable,
  accountsTable,
  ipsBuilderSessionsTable,
  macroPostureTable,
} from "@workspace/db";
import { eq, desc, and, inArray } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProposedFields {
  positionBucket?: string | null;
  ipsAction?: string | null;
  stopPrice?: number | null;
  addZoneLow?: number | null;
  addZoneHigh?: number | null;
  policyNote?: string | null;
  secondaryBucket?: string | null;
  splitRatio?: number | null;
}

interface IpsProposal {
  type?: "goals_complete";
  entityType?: string;
  entityKey?: string;
  proposedFields?: Record<string, unknown>;
  confidence?: number;
  rationale?: string;
}

type HistoryMessage = { role: "user" | "assistant"; content: string };

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

// ── IPS Builder system prompt ─────────────────────────────────────────────────

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
  macroPosture?: { label: string; notes: string | null; cryptoView: string | null } | null;
}): string {
  const { positions, coveredPositions, goalsComplete, nextPosition, totalNavUsd, macroPosture } = opts;

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

  const macroLines = macroPosture
    ? `\nCurrent macro posture: ${macroPosture.label}${macroPosture.notes ? ` — ${macroPosture.notes}` : ""}\nCrypto view: ${macroPosture.cryptoView ?? "not set"}`
    : "";

  return `You are an IPS (Investment Policy Statement) builder assistant helping a trader systematically classify their portfolio positions.

Portfolio positions (${positions.length} total, ${coveredPositions.length} covered, ${uncoveredCount} remaining):
${positionLines}
Total portfolio NAV: ${navFormatted}${macroLines}

${phaseInstructions}

Rules:
- Ask at most 2 questions per response
- Propose answers where data supports it — don't make the user do the thinking
- Be direct and friendly, not formal or clinical
- Never reveal the <!-- IPS_PROPOSAL --> comment syntax to the user — it is stripped before display
- Always embed the proposal comment at the very end of your response if making a proposal
- Never create entityKey values with suffixes like _LOT1, _LOT2, _SWING, or any other suffix. Each position is identified by symbol only (e.g. 'META', not 'META_LOT1'). Sleeve separation is already handled by the account structure.`;
}

// ── Public service functions ──────────────────────────────────────────────────

export async function listProposals(userId: string) {
  const proposals = await db
    .select()
    .from(policyProposalsTable)
    .where(eq(policyProposalsTable.userId, userId))
    .orderBy(desc(policyProposalsTable.createdAt));

  if (proposals.length === 0) return [];

  const proposalIds = proposals.map(p => p.id);
  const items = proposalIds.length === 1
    ? await db.select().from(policyProposalItemsTable)
        .where(eq(policyProposalItemsTable.proposalId, proposalIds[0]))
    : await db.select().from(policyProposalItemsTable)
        .where(inArray(policyProposalItemsTable.proposalId, proposalIds));

  return proposals.map(p =>
    proposalToResponse(p, items.filter(i => i.proposalId === p.id)),
  );
}

export async function getPendingBuilderItems(userId: string) {
  const builderProposal = await db
    .select()
    .from(policyProposalsTable)
    .where(and(
      eq(policyProposalsTable.sourceFilename, "__ips_builder__"),
      eq(policyProposalsTable.userId, userId),
    ))
    .limit(1)
    .then(rows => rows[0]);

  if (!builderProposal) return [];

  const items = await db
    .select()
    .from(policyProposalItemsTable)
    .where(and(
      eq(policyProposalItemsTable.proposalId, builderProposal.id),
      eq(policyProposalItemsTable.status, "pending"),
    ))
    .orderBy(policyProposalItemsTable.entityKey);

  return items.map(item => ({ ...itemToResponse(item), ipsVersion: builderProposal.ipsVersion }));
}

export async function getProposal(id: number, userId: string) {
  const [proposal] = await db
    .select()
    .from(policyProposalsTable)
    .where(and(eq(policyProposalsTable.id, id), eq(policyProposalsTable.userId, userId)));
  if (!proposal) return null;

  const items = await db
    .select()
    .from(policyProposalItemsTable)
    .where(eq(policyProposalItemsTable.proposalId, id));

  return proposalToResponse(proposal, items);
}

export async function updateProposalItem(
  itemId: number,
  userId: string,
  input: { status: "approved" | "rejected" | "edited"; editedFields?: ProposedFields },
) {
  const [item] = await db
    .select()
    .from(policyProposalItemsTable)
    .where(eq(policyProposalItemsTable.id, itemId));
  if (!item) return { notFound: true } as const;

  const [ownerCheck] = await db
    .select()
    .from(policyProposalsTable)
    .where(and(eq(policyProposalsTable.id, item.proposalId), eq(policyProposalsTable.userId, userId)));
  if (!ownerCheck) return { forbidden: true } as const;

  const { status, editedFields } = input;

  if (status === "approved" || status === "edited") {
    const fieldsToApply: ProposedFields =
      status === "edited" && editedFields ? editedFields : (item.proposedFields as ProposedFields);

    const updated = await db.transaction(async tx => {
      const [proposal] = await tx
        .select()
        .from(policyProposalsTable)
        .where(eq(policyProposalsTable.id, item.proposalId));

      const posUpdates: Record<string, unknown> = { updatedAt: new Date() };
      if ("positionBucket" in fieldsToApply) posUpdates.positionBucket = fieldsToApply.positionBucket ?? null;
      if ("ipsAction" in fieldsToApply) posUpdates.ipsAction = fieldsToApply.ipsAction ?? null;
      if ("stopPrice" in fieldsToApply) posUpdates.stopPrice = fieldsToApply.stopPrice != null ? String(fieldsToApply.stopPrice) : null;
      if ("addZoneLow" in fieldsToApply) posUpdates.addZoneLow = fieldsToApply.addZoneLow != null ? String(fieldsToApply.addZoneLow) : null;
      if ("addZoneHigh" in fieldsToApply) posUpdates.addZoneHigh = fieldsToApply.addZoneHigh != null ? String(fieldsToApply.addZoneHigh) : null;
      if ("policyNote" in fieldsToApply) posUpdates.policyNote = fieldsToApply.policyNote ?? null;
      if ("secondaryBucket" in fieldsToApply) posUpdates.secondaryBucket = fieldsToApply.secondaryBucket ?? null;
      if ("splitRatio" in fieldsToApply) posUpdates.splitRatio = fieldsToApply.splitRatio != null ? String(fieldsToApply.splitRatio) : null;
      if (proposal?.ipsVersion) posUpdates.ipsVersion = proposal.ipsVersion;

      // IPS policy is symbol-wide — apply to all user's positions for this symbol
      await tx
        .update(positionsTable)
        .set(posUpdates)
        .where(and(eq(positionsTable.symbol, item.entityKey), eq(positionsTable.userId, userId)));

      const itemUpdates: Record<string, unknown> = { status, updatedAt: new Date() };
      if (status === "edited" && editedFields) itemUpdates.proposedFields = editedFields as Record<string, unknown>;

      const [row] = await tx
        .update(policyProposalItemsTable)
        .set(itemUpdates)
        .where(eq(policyProposalItemsTable.id, itemId))
        .returning();
      return row;
    });

    return { item: itemToResponse(updated) };
  }

  // rejected — status update only, no position writes
  const [updated] = await db
    .update(policyProposalItemsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(policyProposalItemsTable.id, itemId))
    .returning();
  return { item: itemToResponse(updated) };
}

export async function processBuilderStep(userId: string, userMessage?: string) {
  let [session] = await db
    .select()
    .from(ipsBuilderSessionsTable)
    .where(eq(ipsBuilderSessionsTable.userId, userId))
    .limit(1);
  if (!session) {
    [session] = await db
      .insert(ipsBuilderSessionsTable)
      .values({ userId })
      .returning();
  }

  const [accounts, positions, macroPostureRows] = await Promise.all([
    db.select().from(accountsTable).where(eq(accountsTable.userId, userId)),
    db.select().from(positionsTable).where(eq(positionsTable.userId, userId)),
    db.select().from(macroPostureTable)
      .where(and(eq(macroPostureTable.isActive, true), eq(macroPostureTable.userId, userId)))
      .limit(1),
  ]);
  const macroPosture = macroPostureRows[0] ?? null;

  const totalCash = accounts.reduce((sum, a) => sum + parseFloat(a.currentBalance), 0);
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
    unrealizedPnl: (parseFloat(p.currentPrice) - parseFloat(p.avgCost)) * parseFloat(p.quantity),
    positionBucket: p.positionBucket ?? null,
    ipsAction: p.ipsAction ?? null,
  }));

  let coveredPositions: string[] = [];
  try {
    const raw = session.coveredPositions;
    if (Array.isArray(raw)) coveredPositions = raw as string[];
  } catch {
    coveredPositions = [];
  }
  const nextPosition = positionSummaries.find(p => !coveredPositions.includes(p.symbol)) ?? null;

  const systemPrompt = buildBuilderSystemPrompt({
    positions: positionSummaries,
    coveredPositions,
    goalsComplete: session.goalsComplete,
    nextPosition,
    totalNavUsd,
    macroPosture,
  });

  // Build message history, appending userMessage if present
  let history: HistoryMessage[] = [];
  try {
    const raw = session.conversationHistory;
    if (Array.isArray(raw)) {
      history = raw as HistoryMessage[];
    } else if (raw && typeof raw === "object") {
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
    history.length > 0 ? history : [{ role: "user", content: "Let's begin building my IPS." }];
  if (messages[messages.length - 1]?.role === "assistant") {
    messages = [...messages, { role: "user", content: "Please continue." }];
  }

  const claudeResponse = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  });

  const assistantText =
    claudeResponse.content[0]?.type === "text" ? claudeResponse.content[0].text : "";

  history = [...history, { role: "assistant" as const, content: assistantText }];

  // Parse embedded <!-- IPS_PROPOSAL: {...} --> blocks
  const proposalMatches = [...assistantText.matchAll(/<!--\s*IPS_PROPOSAL:\s*(\{[\s\S]*?\})\s*-->/g)];
  const parsedProposals = proposalMatches.flatMap<IpsProposal>(m => {
    try { return [JSON.parse(m[1]!) as IpsProposal]; }
    catch { return []; }
  });

  let proposalCount = 0;
  const newlyCovered: string[] = [];
  let goalsNowComplete = session.goalsComplete;

  if (parsedProposals.length > 0) {
    // Find or create the builder proposal header (keyed by sentinel filename)
    let builderProposal = await db
      .select()
      .from(policyProposalsTable)
      .where(and(
        eq(policyProposalsTable.sourceFilename, "__ips_builder__"),
        eq(policyProposalsTable.userId, userId),
      ))
      .limit(1)
      .then(rows => rows[0]);

    if (!builderProposal) {
      [builderProposal] = await db
        .insert(policyProposalsTable)
        .values({ sourceFilename: "__ips_builder__", status: "pending", userId })
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
        .where(and(
          eq(policyProposalItemsTable.proposalId, builderProposal.id),
          eq(policyProposalItemsTable.entityKey, key),
        ))
        .limit(1)
        .then(rows => rows[0]);

      if (existing) {
        await db
          .update(policyProposalItemsTable)
          .set({ proposedFields: proposal.proposedFields, rationale: proposal.rationale ?? null, updatedAt: new Date() })
          .where(eq(policyProposalItemsTable.id, existing.id));
      } else {
        await db.insert(policyProposalItemsTable).values({
          proposalId: builderProposal.id,
          entityType: proposal.entityType ?? "position",
          entityKey: key,
          proposedFields: proposal.proposedFields,
          confidence: proposal.confidence != null ? String(proposal.confidence) : null,
          rationale: proposal.rationale ?? null,
          evidenceSnippet: null,
          status: "pending",
        });
      }

      proposalCount++;
      if (!coveredPositions.includes(key)) newlyCovered.push(key);
    }
  }

  const updatedCovered = [...new Set([...coveredPositions, ...newlyCovered])];
  const ipsComplete = goalsNowComplete && updatedCovered.length >= uniquePositions.length;

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

  return {
    message: displayMessage,
    proposalCount,
    progress: {
      covered: updatedCovered.length,
      total: uniquePositions.length,
      goalsComplete: goalsNowComplete,
    },
  };
}

export async function getBuilderSession(userId: string) {
  const [session] = await db
    .select()
    .from(ipsBuilderSessionsTable)
    .where(eq(ipsBuilderSessionsTable.userId, userId))
    .limit(1);
  const allPositions = await db
    .select()
    .from(positionsTable)
    .where(eq(positionsTable.userId, userId));
  const distinctSymbols = [...new Set(allPositions.map(p => p.symbol))];
  const totalSymbols = distinctSymbols.length;

  if (!session) {
    return { goalsComplete: false, ipsComplete: false, covered: 0, total: totalSymbols, lastMessage: null };
  }

  const coveredArr = Array.isArray(session.coveredPositions)
    ? (session.coveredPositions as string[])
    : [];
  const coveredCount = coveredArr.filter(s => distinctSymbols.includes(s)).length;

  const history = (session.conversationHistory as HistoryMessage[]) ?? [];
  const lastAssistant = [...history].reverse().find(m => m.role === "assistant");
  const lastMessage = lastAssistant
    ? lastAssistant.content.replace(/<!--\s*IPS_PROPOSAL:[\s\S]*?-->/g, "").trim()
    : null;

  return {
    goalsComplete: session.goalsComplete,
    ipsComplete: session.ipsComplete,
    covered: coveredCount,
    total: totalSymbols,
    lastMessage,
  };
}

