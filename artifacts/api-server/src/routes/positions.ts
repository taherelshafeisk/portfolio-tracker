import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { positionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.post("/", async (req, res) => {
  try {
    const { accountId, symbol, name, quantity, avgCost, sector, notes } = req.body;
    const [position] = await db.insert(positionsTable).values({
      accountId,
      symbol: symbol.toUpperCase(),
      name,
      quantity: quantity.toString(),
      avgCost: avgCost.toString(),
      currentPrice: avgCost.toString(),
      sector: sector || null,
      notes: notes || null,
    }).returning();
    const qty = parseFloat(position.quantity);
    const avg = parseFloat(position.avgCost);
    const cur = parseFloat(position.currentPrice);
    const marketValue = qty * cur;
    const unrealizedPnl = marketValue - (qty * avg);
    const unrealizedPnlPct = qty * avg > 0 ? (unrealizedPnl / (qty * avg)) * 100 : 0;
    res.status(201).json({
      id: position.id,
      accountId: position.accountId,
      symbol: position.symbol,
      name: position.name,
      quantity: qty,
      avgCost: avg,
      currentPrice: cur,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPct,
      sector: position.sector || undefined,
      notes: position.notes || undefined,
      createdAt: position.createdAt.toISOString(),
      updatedAt: position.updatedAt.toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to create position" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { quantity, avgCost, currentPrice, notes } = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (quantity !== undefined) updates.quantity = quantity.toString();
    if (avgCost !== undefined) updates.avgCost = avgCost.toString();
    if (currentPrice !== undefined) updates.currentPrice = currentPrice.toString();
    if (notes !== undefined) updates.notes = notes;
    const [position] = await db.update(positionsTable).set(updates).where(eq(positionsTable.id, id)).returning();
    if (!position) return res.status(404).json({ error: "Position not found" });
    const qty = parseFloat(position.quantity);
    const avg = parseFloat(position.avgCost);
    const cur = parseFloat(position.currentPrice);
    const marketValue = qty * cur;
    const unrealizedPnl = marketValue - (qty * avg);
    const unrealizedPnlPct = qty * avg > 0 ? (unrealizedPnl / (qty * avg)) * 100 : 0;
    res.json({
      id: position.id,
      accountId: position.accountId,
      symbol: position.symbol,
      name: position.name,
      quantity: qty,
      avgCost: avg,
      currentPrice: cur,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPct,
      sector: position.sector || undefined,
      notes: position.notes || undefined,
      createdAt: position.createdAt.toISOString(),
      updatedAt: position.updatedAt.toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to update position" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(positionsTable).where(eq(positionsTable.id, id));
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete position" });
  }
});

export default router;
