import { Router, type IRouter } from "express";
import { db, priceAlertsTable } from "@workspace/db";
import { eq, and, gte } from "drizzle-orm";
import { z } from "@workspace/api-zod/schemas";

const router: IRouter = Router();

const createSchema = z.object({
  symbol: z.string().min(1).toUpperCase(),
  positionId: z.number().int().optional(),
  accountId: z.number().int().optional(),
  triggerPrice: z.number().positive(),
  direction: z.enum(["above", "below"]),
  note: z.string().optional(),
});

// GET /price-alerts — list; ?status=active|triggered|all, ?symbol=X
router.get("/", async (req, res) => {
  try {
    const { status, symbol, since } = req.query;
    let rows = await db.select().from(priceAlertsTable);

    if (symbol) {
      rows = rows.filter(r => r.symbol === (symbol as string).toUpperCase());
    }
    if (status && status !== "all") {
      rows = rows.filter(r => r.status === status);
    }
    if (since) {
      const sinceDate = new Date(since as string);
      rows = rows.filter(r => {
        if (status === "triggered") return r.triggeredAt != null && r.triggeredAt >= sinceDate;
        return r.createdAt >= sinceDate;
      });
    }

    res.json(rows);
  } catch (err) {
    console.error("[price-alerts GET /]", err);
    res.status(500).json({ error: "Failed to fetch price alerts" });
  }
});

// POST /price-alerts — create
router.post("/", async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;
    const [row] = await db.insert(priceAlertsTable).values({
      symbol: d.symbol,
      positionId: d.positionId ?? null,
      accountId: d.accountId ?? null,
      triggerPrice: d.triggerPrice.toString(),
      direction: d.direction,
      note: d.note ?? null,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    console.error("[price-alerts POST /]", err);
    res.status(500).json({ error: "Failed to create price alert" });
  }
});

// PATCH /price-alerts/:id — dismiss or manually trigger
router.patch("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body as { status: string };
    const [row] = await db.update(priceAlertsTable)
      .set({
        status,
        triggeredAt: status === "triggered" ? new Date() : undefined,
      })
      .where(eq(priceAlertsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    console.error("[price-alerts PATCH /:id]", err);
    res.status(500).json({ error: "Failed to update price alert" });
  }
});

// DELETE /price-alerts/:id
router.delete("/:id", async (req, res) => {
  try {
    await db.delete(priceAlertsTable).where(eq(priceAlertsTable.id, Number(req.params.id)));
    res.status(204).send();
  } catch (err) {
    console.error("[price-alerts DELETE /:id]", err);
    res.status(500).json({ error: "Failed to delete price alert" });
  }
});

/**
 * Check active alerts against a live price map and trigger any that crossed.
 * Called from positions/refresh-prices after prices are fetched.
 */
export async function checkPriceAlerts(
  priceMap: Record<string, { price: number }>,
): Promise<number> {
  const active = await db.select().from(priceAlertsTable)
    .where(eq(priceAlertsTable.status, "active"));

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
