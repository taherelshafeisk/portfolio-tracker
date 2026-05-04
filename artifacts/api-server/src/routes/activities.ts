import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { activitiesTable, tradeAnnotationsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { validate } from "../middlewares/validate";
import { CreateActivityBody, z } from "@workspace/api-zod/schemas";
import { logger } from "../lib/logger";
import { reconcilePosition, recomputeCashBalance, reconcileAll } from "../services/activityService";

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

// ── Routes ─────────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const rawLimit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 50;
    const accountId = req.query.accountId ? parseInt(req.query.accountId as string) : undefined;
    const whereClause = accountId
      ? and(eq(activitiesTable.accountId, accountId), eq(activitiesTable.userId, req.userId))
      : eq(activitiesTable.userId, req.userId);
    const activities = await db.select().from(activitiesTable)
      .where(whereClause)
      .orderBy(desc(activitiesTable.tradeDate), desc(activitiesTable.id))
      .limit(limit);
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

    const activity = await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(activitiesTable).values({
        accountId,
        symbol: upperSymbol,
        activityType,
        quantity: quantity ? quantity.toString() : null,
        price: price ? price.toString() : null,
        totalAmount: totalAmount ? totalAmount.toString() : (quantity && price ? (quantity * price).toString() : null),
        notes: notes || null,
        tradeDate: new Date(tradeDate),
        userId: req.userId,
      }).onConflictDoNothing().returning();

      // Duplicate row — nothing was written; return null to signal skip
      if (!inserted) return null;

      if (upperSymbol) {
        await reconcilePosition(accountId, upperSymbol, req.userId, tx);
      }
      await recomputeCashBalance(accountId, tx);

      return inserted;
    });

    if (!activity) return res.status(200).json({ skipped: true });
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

    await db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(activitiesTable)
        .where(and(eq(activitiesTable.id, id), eq(activitiesTable.userId, req.userId)))
        .returning();

      if (!deleted) return;

      if (deleted.symbol && deleted.accountId) {
        await reconcilePosition(deleted.accountId, deleted.symbol, req.userId, tx);
      }
      await recomputeCashBalance(deleted.accountId, tx);
    });

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete activity" });
  }
});

export default router;
