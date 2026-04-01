import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { activitiesTable, positionsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
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
    console.error("[activities GET /] Error:", error);
    res.status(500).json({ error: "Failed to fetch activities" });
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
    }).returning();

    // On a buy, update the matching position's quantity and avgCost using weighted average
    if (activityType === "buy" && upperSymbol && quantity > 0 && price > 0) {
      const [existing] = await db
        .select()
        .from(positionsTable)
        .where(and(eq(positionsTable.accountId, accountId), eq(positionsTable.symbol, upperSymbol)));
      if (existing) {
        const oldQty = parseFloat(existing.quantity);
        const oldAvg = parseFloat(existing.avgCost);
        const newQty = oldQty + quantity;
        const newAvg = (oldQty * oldAvg + quantity * price) / newQty;
        await db
          .update(positionsTable)
          .set({ quantity: newQty.toString(), avgCost: newAvg.toFixed(6), updatedAt: new Date() })
          .where(eq(positionsTable.id, existing.id));
      }
    }

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
