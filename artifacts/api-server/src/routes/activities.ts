import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { activitiesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

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

router.get("/", async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const accountId = req.query.accountId ? parseInt(req.query.accountId as string) : undefined;
    let query = db.select().from(activitiesTable).orderBy(desc(activitiesTable.tradeDate)).limit(limit);
    if (accountId) {
      const activities = await db.select().from(activitiesTable)
        .where(eq(activitiesTable.accountId, accountId))
        .orderBy(desc(activitiesTable.tradeDate))
        .limit(limit);
      return res.json(activities.map(toResponse));
    }
    const activities = await query;
    res.json(activities.map(toResponse));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch activities" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { accountId, symbol, activityType, quantity, price, totalAmount, notes, tradeDate } = req.body;
    const [activity] = await db.insert(activitiesTable).values({
      accountId,
      symbol: symbol ? symbol.toUpperCase() : null,
      activityType,
      quantity: quantity ? quantity.toString() : null,
      price: price ? price.toString() : null,
      totalAmount: totalAmount ? totalAmount.toString() : (quantity && price ? (quantity * price).toString() : null),
      notes: notes || null,
      tradeDate: new Date(tradeDate),
    }).returning();
    res.status(201).json(toResponse(activity));
  } catch (error) {
    res.status(500).json({ error: "Failed to create activity" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(activitiesTable).where(eq(activitiesTable.id, id));
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete activity" });
  }
});

export default router;
