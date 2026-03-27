import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { accountsTable, positionsTable, activitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fetchLivePrices } from "./positions";

const router: IRouter = Router();

router.get("/", async (_req, res) => {
  try {
    const accounts = await db.select().from(accountsTable).orderBy(accountsTable.createdAt);
    const result = accounts.map(a => ({
      id: a.id,
      name: a.name,
      broker: a.broker,
      accountType: a.accountType,
      currency: a.currency,
      initialBalance: parseFloat(a.initialBalance),
      currentBalance: parseFloat(a.currentBalance),
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    }));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch accounts" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, broker, accountType, currency, initialBalance } = req.body;
    const [account] = await db.insert(accountsTable).values({
      name,
      broker,
      accountType,
      currency: currency || "USD",
      initialBalance: initialBalance.toString(),
      currentBalance: initialBalance.toString(),
    }).returning();
    res.status(201).json({
      id: account.id,
      name: account.name,
      broker: account.broker,
      accountType: account.accountType,
      currency: account.currency,
      initialBalance: parseFloat(account.initialBalance),
      currentBalance: parseFloat(account.currentBalance),
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to create account" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, id));
    if (!account) return res.status(404).json({ error: "Account not found" });
    res.json({
      id: account.id,
      name: account.name,
      broker: account.broker,
      accountType: account.accountType,
      currency: account.currency,
      initialBalance: parseFloat(account.initialBalance),
      currentBalance: parseFloat(account.currentBalance),
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch account" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, broker, accountType, currentBalance } = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (broker !== undefined) updates.broker = broker;
    if (accountType !== undefined) updates.accountType = accountType;
    if (currentBalance !== undefined) updates.currentBalance = currentBalance.toString();
    const [account] = await db.update(accountsTable).set(updates).where(eq(accountsTable.id, id)).returning();
    if (!account) return res.status(404).json({ error: "Account not found" });
    res.json({
      id: account.id,
      name: account.name,
      broker: account.broker,
      accountType: account.accountType,
      currency: account.currency,
      initialBalance: parseFloat(account.initialBalance),
      currentBalance: parseFloat(account.currentBalance),
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to update account" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    // Cascade: delete positions and activities before account
    await db.delete(positionsTable).where(eq(positionsTable.accountId, id));
    await db.delete(activitiesTable).where(eq(activitiesTable.accountId, id));
    await db.delete(accountsTable).where(eq(accountsTable.id, id));
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete account" });
  }
});

router.get("/:id/positions", async (req, res) => {
  try {
    const accountId = parseInt(req.params.id);
    const positions = await db.select().from(positionsTable)
      .where(eq(positionsTable.accountId, accountId))
      .orderBy(positionsTable.symbol);

    if (positions.length === 0) return res.json([]);

    // Fetch live prices from Yahoo Finance
    const symbols = positions.map(p => p.symbol);
    const priceMap = await fetchLivePrices(symbols);

    // Persist updated prices to DB in the background
    await Promise.allSettled(
      positions
        .filter(p => priceMap[p.symbol] !== undefined)
        .map(p =>
          db.update(positionsTable)
            .set({ currentPrice: priceMap[p.symbol].price.toString(), updatedAt: new Date() })
            .where(eq(positionsTable.id, p.id))
        )
    );

    const result = positions.map(p => {
      const qty = parseFloat(p.quantity);
      const avg = parseFloat(p.avgCost);
      const cur = priceMap[p.symbol]?.price ?? parseFloat(p.currentPrice);
      const marketValue = qty * cur;
      const unrealizedPnl = marketValue - qty * avg;
      const unrealizedPnlPct = qty * avg > 0 ? (unrealizedPnl / (qty * avg)) * 100 : 0;
      const prevPrice = priceMap[p.symbol]?.previousClose ?? cur;
      const dayChange = qty * (cur - prevPrice);
      const dayChangePct = priceMap[p.symbol]?.changePercent ?? 0;
      return {
        id: p.id,
        accountId: p.accountId,
        symbol: p.symbol,
        name: p.name,
        quantity: qty,
        avgCost: avg,
        currentPrice: cur,
        marketValue,
        unrealizedPnl,
        unrealizedPnlPct,
        dayChange,
        dayChangePct,
        assetType: p.assetType ?? undefined,
        sector: p.sector ?? undefined,
        notes: p.notes ?? undefined,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch positions" });
  }
});

export default router;
