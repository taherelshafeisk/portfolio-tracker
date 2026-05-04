import { Router, type IRouter } from "express";
import { db, priceAlertsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { z } from "@workspace/api-zod/schemas";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const createSchema = z.object({
  symbol: z.string().min(1).toUpperCase(),
  positionId: z.number().int().optional(),
  accountId: z.number().int().optional(),
  triggerPrice: z.number().positive(),
  direction: z.enum(["above", "below"]),
  note: z.string().optional(),
});

router.get("/", async (req, res) => {
  try {
    const { status, symbol, since } = req.query;
    let rows = await db.select().from(priceAlertsTable).where(eq(priceAlertsTable.userId, req.userId));

    if (symbol) rows = rows.filter(r => r.symbol === (symbol as string).toUpperCase());
    if (status && status !== "all") rows = rows.filter(r => r.status === status);
    if (since) {
      const sinceDate = new Date(since as string);
      rows = rows.filter(r => {
        if (status === "triggered") return r.triggeredAt != null && r.triggeredAt >= sinceDate;
        return r.createdAt >= sinceDate;
      });
    }
    res.json(rows);
  } catch (err) {
    logger.error(err, "[price-alerts GET /]");
    res.status(500).json({ error: "Failed to fetch price alerts" });
  }
});

router.post("/", async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
    const d = parsed.data;
    const [row] = await db.insert(priceAlertsTable).values({
      symbol: d.symbol,
      positionId: d.positionId ?? null,
      accountId: d.accountId ?? null,
      triggerPrice: d.triggerPrice.toString(),
      direction: d.direction,
      note: d.note ?? null,
      userId: req.userId,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    logger.error(err, "[price-alerts POST /]");
    res.status(500).json({ error: "Failed to create price alert" });
  }
});

const VALID_PRICE_ALERT_STATUSES = new Set(["active", "triggered", "dismissed"]);

router.patch("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body as { status: string };
    if (!status || !VALID_PRICE_ALERT_STATUSES.has(status)) {
      res.status(400).json({ error: "status must be one of: active, triggered, dismissed" });
      return;
    }
    const [row] = await db.update(priceAlertsTable)
      .set({ status, triggeredAt: status === "triggered" ? new Date() : undefined })
      .where(and(eq(priceAlertsTable.id, id), eq(priceAlertsTable.userId, req.userId)))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    logger.error(err, "[price-alerts PATCH /:id]");
    res.status(500).json({ error: "Failed to update price alert" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await db.delete(priceAlertsTable)
      .where(and(eq(priceAlertsTable.id, Number(req.params.id)), eq(priceAlertsTable.userId, req.userId)));
    res.status(204).send();
  } catch (err) {
    logger.error(err, "[price-alerts DELETE /:id]");
    res.status(500).json({ error: "Failed to delete price alert" });
  }
});

/**
 * Check active alerts against a live price map and trigger any that crossed.
 * Called from positions/refresh-prices — no user scoping needed here since
 * this is a background sweep over all active alerts.
 */
export async function checkPriceAlerts(priceMap: Record<string, { price: number }>): Promise<number> {
  const active = await db.select().from(priceAlertsTable).where(eq(priceAlertsTable.status, "active"));

  const triggered = active.filter(a => {
    const live = priceMap[a.symbol]?.price;
    if (live == null) return false;
    const target = parseFloat(a.triggerPrice);
    return a.direction === "above" ? live >= target : live <= target;
  });

  if (triggered.length === 0) return 0;

  await Promise.all(triggered.map(a =>
    db.update(priceAlertsTable)
      .set({ status: "triggered", triggeredAt: new Date() })
      .where(eq(priceAlertsTable.id, a.id))
  ));

  return triggered.length;
}

export default router;
