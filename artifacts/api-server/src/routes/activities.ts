import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { activitiesTable, positionsTable, accountsTable, tradeAnnotationsTable } from "@workspace/db";
import { eq, desc, and, asc, isNotNull, inArray, sql } from "drizzle-orm";
import { validate } from "../middlewares/validate";
import { CreateActivityBody, z } from "@workspace/api-zod/schemas";

// tradeDate arrives as an ISO string over HTTP; coerce it to Date before validation.
const CreateActivityBodyHttp = CreateActivityBody.extend({ tradeDate: z.coerce.date() });

const router: IRouter = Router();

const toResponse = (a: typeof activitiesTable.$inferSelect) => ({
  id: a.id,
  accountId: a.accountId,
  symbol: a.symbol || undefined,
  activityType: a.activityType,
  quantity: a.quantity ? parseFloat(a.quantity) : undefined,
  price: a.price ? parseFloat(a.price) : undefined,
  totalAmount: a.totalAmount ? parseFloat(a.totalAmount) : undefined,
  notes: a.notes || undefined,
  tradeDate: a.tradeDate.toISOString(),
  createdAt: a.createdAt.toISOString(),
});

// ── Cash adjustment ────────────────────────────────────────────────────────────

/**
 * Adjusts account.currentBalance for a single activity.
 * direction=1 applies the normal effect; direction=-1 reverses it (used on delete).
 *
 * Cash effects:
 *   buy / withdrawal  → debit  (balance decreases)
 *   sell / deposit / dividend → credit (balance increases)
 */
async function adjustCashForActivity(
  accountId: number,
  activityType: string,
  quantity: number | null,
  price: number | null,
  totalAmount: number | null,
  direction: 1 | -1 = 1,
): Promise<void> {
  const absAmt =
    totalAmount != null
      ? Math.abs(totalAmount)
      : quantity != null && price != null
        ? Math.abs(quantity * price)
        : null;

  if (absAmt == null || absAmt === 0) return;

  const isDebit = activityType === "buy" || activityType === "withdrawal";
  const delta = direction * (isDebit ? -absAmt : absAmt);

  await db
    .update(accountsTable)
    .set({ currentBalance: sql`current_balance + ${delta}`, updatedAt: new Date() })
    .where(eq(accountsTable.id, accountId));
}

// ── Reconciliation ─────────────────────────────────────────────────────────────

/**
 * Recomputes qty and avgCost for a (accountId, symbol) pair from scratch
 * by walking all activity rows in chronological order.
 *
 * - buy:  adds qty, recalculates weighted avg cost
 * - sell: subtracts qty, avg cost stays the same
 * - other types: ignored for qty/cost purposes
 *
 * After computation:
 *   currentQty > 0  → upsert positionsTable
 *   currentQty <= 0 → delete position row (fully exited)
 */
async function reconcilePosition(
  accountId: number,
  symbol: string,
): Promise<{ qty: number; avgCost: number; symbol: string; accountId: number }> {
  const activities = await db
    .select()
    .from(activitiesTable)
    .where(and(eq(activitiesTable.accountId, accountId), eq(activitiesTable.symbol, symbol)))
    .orderBy(asc(activitiesTable.tradeDate));

  // If there are no buy activities, the position was seeded directly (imported without trade
  // history). Seed the opening balance from the existing position row so that sells applied
  // after import are treated as deltas against that balance rather than against zero.
  const hasBuys = activities.some((a) => a.activityType === "buy");

  let currentQty = 0;
  let avgCost = 0;

  if (!hasBuys) {
    const [existing] = await db
      .select()
      .from(positionsTable)
      .where(and(eq(positionsTable.accountId, accountId), eq(positionsTable.symbol, symbol)));
    if (existing) {
      currentQty = parseFloat(existing.quantity);
      avgCost = parseFloat(existing.avgCost);
    }
  }

  for (const activity of activities) {
    const qty = activity.quantity ? parseFloat(activity.quantity) : 0;
    const price = activity.price ? parseFloat(activity.price) : 0;

    if (activity.activityType === "buy" && qty > 0) {
      const newQty = currentQty + qty;
      avgCost = (currentQty * avgCost + qty * price) / newQty;
      currentQty = newQty;
    } else if (activity.activityType === "sell" && qty > 0) {
      currentQty = Math.max(0, currentQty - qty);
    }
  }

  // Find ALL rows for this (accountId, symbol) pair. More than one means a
  // duplicate crept in (e.g. screenshot import ran twice before the unique
  // constraint existed). Delete the extras, keeping only the canonical row.
  const allExisting = await db
    .select()
    .from(positionsTable)
    .where(and(eq(positionsTable.accountId, accountId), eq(positionsTable.symbol, symbol)));

  if (allExisting.length > 1) {
    const [, ...dupes] = allExisting; // keep first, delete the rest
    await db.delete(positionsTable).where(inArray(positionsTable.id, dupes.map(r => r.id)));
  }

  const existing = allExisting[0] ?? null;

  if (currentQty > 0) {
    if (existing) {
      await db
        .update(positionsTable)
        .set({ quantity: currentQty.toString(), avgCost: avgCost.toFixed(4), updatedAt: new Date() })
        .where(eq(positionsTable.id, existing.id));
    } else {
      // No position row yet — create one from activity data (symbol used as name fallback)
      await db.insert(positionsTable).values({
        accountId,
        symbol,
        name: symbol,
        quantity: currentQty.toString(),
        avgCost: avgCost.toFixed(4),
        currentPrice: "0",
      });
    }
  } else {
    // Keep a closed tombstone (qty=0) so activity history links remain valid.
    if (existing) {
      await db
        .update(positionsTable)
        .set({ quantity: "0", updatedAt: new Date() })
        .where(eq(positionsTable.id, existing.id));
    } else {
      // No row existed (e.g. SELL imported without a prior position row) — create a tombstone.
      await db.insert(positionsTable).values({
        accountId,
        symbol,
        name: symbol,
        quantity: "0",
        avgCost: avgCost.toFixed(4),
        currentPrice: "0",
      });
    }
  }

  return { qty: currentQty, avgCost, symbol, accountId };
}

/**
 * Reconciles every unique (accountId, symbol) pair found in activitiesTable.
 * Safe to run at any time — idempotent.
 */
export async function reconcileAll(): Promise<{
  reconciled: number;
  positionsUpdated: number;
  positionsDeleted: number;
}> {
  const pairs = await db
    .selectDistinct({ accountId: activitiesTable.accountId, symbol: activitiesTable.symbol })
    .from(activitiesTable)
    .where(isNotNull(activitiesTable.symbol));

  let positionsUpdated = 0;
  let positionsDeleted = 0;

  for (const { accountId, symbol } of pairs) {
    if (!symbol) continue;
    const result = await reconcilePosition(accountId, symbol);
    if (result.qty > 0) positionsUpdated++;
    else positionsDeleted++;
  }

  return { reconciled: pairs.length, positionsUpdated, positionsDeleted };
}

// ── Routes ─────────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const accountId = req.query.accountId ? parseInt(req.query.accountId as string) : undefined;
    let query = db.select().from(activitiesTable).orderBy(desc(activitiesTable.tradeDate), desc(activitiesTable.id)).limit(limit);
    if (accountId) {
      const activities = await db.select().from(activitiesTable)
        .where(eq(activitiesTable.accountId, accountId))
        .orderBy(desc(activitiesTable.tradeDate), desc(activitiesTable.id))
        .limit(limit);
      return res.json(activities.map(toResponse));
    }
    const activities = await query;
    return res.json(activities.map(toResponse));
  } catch (error) {
    console.error("[activities GET /] Error:", error);
    return res.status(500).json({ error: "Failed to fetch activities" });
  }
});

router.post("/", validate(CreateActivityBodyHttp), async (req, res) => {
  try {
    const { accountId, symbol, activityType, quantity, price, totalAmount, notes, tradeDate } = req.body;
    const upperSymbol = symbol ? symbol.toUpperCase() : null;
    const [activity] = await db.insert(activitiesTable).values({
      accountId,
      symbol: upperSymbol,
      activityType,
      quantity: quantity ? quantity.toString() : null,
      price: price ? price.toString() : null,
      totalAmount: totalAmount ? totalAmount.toString() : (quantity && price ? (quantity * price).toString() : null),
      notes: notes || null,
      tradeDate: new Date(tradeDate),
    }).onConflictDoNothing().returning();

    // Duplicate — silently return 200 with no body
    if (!activity) return res.status(200).json({ skipped: true });

    if (upperSymbol) {
      await reconcilePosition(accountId, upperSymbol);
    }

    await adjustCashForActivity(
      accountId,
      activityType,
      quantity ?? null,
      price ?? null,
      totalAmount ?? null,
    );

    return res.status(201).json(toResponse(activity));
  } catch (error) {
    return res.status(500).json({ error: "Failed to create activity" });
  }
});

// ── Trade annotation endpoints ───────────────────────────────────────────────
// Literal paths (/annotations, /reconcile-all) MUST be registered before
// parameterised paths (/:id) at the same depth.

/** All annotations with full data — used by Journal tab; activityId field also supports activity-tab dot indicators */
router.get("/annotations", async (_req, res) => {
  try {
    const rows = await db.select().from(tradeAnnotationsTable);
    return res.json(rows);
  } catch {
    return res.status(500).json({ error: "Failed to fetch annotations" });
  }
});

/**
 * POST /activities/reconcile-all
 * Recovery tool: recomputes every position's qty and avgCost from activity history.
 */
router.post("/reconcile-all", async (_req, res) => {
  try {
    const summary = await reconcileAll();
    return res.json(summary);
  } catch (error) {
    console.error("[activities POST /reconcile-all] Error:", error);
    return res.status(500).json({ error: "Reconciliation failed" });
  }
});

/** GET /activities/:id/annotation — returns full annotation or null */
router.get("/:id/annotation", async (req, res) => {
  try {
    const activityId = parseInt(req.params.id);
    const [row] = await db
      .select()
      .from(tradeAnnotationsTable)
      .where(eq(tradeAnnotationsTable.activityId, activityId));
    return res.json(row ?? null);
  } catch {
    return res.status(500).json({ error: "Failed to fetch annotation" });
  }
});

const VALID_VERDICTS = new Set(["right_decision", "wrong_decision", "too_early_to_tell"]);

/** PUT /activities/:id/annotation — upsert, partial update (only included fields are written) */
router.put("/:id/annotation", async (req, res) => {
  try {
    const activityId = parseInt(req.params.id);
    const { thesis, ips_aligned, planned_exit, verdict, verdict_note } = req.body;

    if (verdict !== undefined && verdict !== null && !VALID_VERDICTS.has(verdict)) {
      return res.status(400).json({ error: "Invalid verdict value" });
    }

    const [existing] = await db
      .select()
      .from(tradeAnnotationsTable)
      .where(eq(tradeAnnotationsTable.activityId, activityId));

    if (existing) {
      // Partial update — only overwrite fields explicitly present in request body
      const [updated] = await db
        .update(tradeAnnotationsTable)
        .set({
          thesis:      "thesis"       in req.body ? (thesis       ?? null) : existing.thesis,
          ipsAligned:  "ips_aligned"  in req.body ? (ips_aligned  ?? null) : existing.ipsAligned,
          plannedExit: "planned_exit" in req.body ? (planned_exit ?? null) : existing.plannedExit,
          verdict:     "verdict"      in req.body ? (verdict      ?? null) : existing.verdict,
          verdictNote: "verdict_note" in req.body ? (verdict_note ?? null) : existing.verdictNote,
          updatedAt: new Date(),
        })
        .where(eq(tradeAnnotationsTable.activityId, activityId))
        .returning();
      return res.json(updated);
    }

    // Insert new annotation
    const [created] = await db
      .insert(tradeAnnotationsTable)
      .values({
        activityId,
        thesis:      thesis       ?? null,
        ipsAligned:  ips_aligned  ?? null,
        plannedExit: planned_exit ?? null,
        verdict:     verdict      ?? null,
        verdictNote: verdict_note ?? null,
      })
      .returning();
    return res.status(201).json(created);
  } catch {
    return res.status(500).json({ error: "Failed to save annotation" });
  }
});

// Parameterised single-segment routes last — after all literal paths above.
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [deleted] = await db
      .delete(activitiesTable)
      .where(eq(activitiesTable.id, id))
      .returning();

    if (deleted?.symbol && deleted?.accountId) {
      await reconcilePosition(deleted.accountId, deleted.symbol);
    }

    if (deleted?.accountId) {
      await adjustCashForActivity(
        deleted.accountId,
        deleted.activityType,
        deleted.quantity ? parseFloat(deleted.quantity) : null,
        deleted.price ? parseFloat(deleted.price) : null,
        deleted.totalAmount ? parseFloat(deleted.totalAmount) : null,
        -1,
      );
    }

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete activity" });
  }
});

export default router;
