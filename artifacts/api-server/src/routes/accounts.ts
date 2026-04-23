import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { accountsTable, positionsTable, activitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fetchLivePrices } from "./positions";
import { validate } from "../middlewares/validate";
import { CreateAccountBody, UpdateAccountBody } from "@workspace/api-zod/schemas";

const router: IRouter = Router();

function toAccountResponse(a: typeof accountsTable.$inferSelect) {
  return {
    id: a.id,
    name: a.name,
    broker: a.broker,
    accountType: a.accountType,
    currency: a.currency,
    initialBalance: parseFloat(a.initialBalance),
    currentBalance: parseFloat(a.currentBalance),
    sleeveKey: a.sleeveKey ?? null,
    maxLeverageRatio: a.maxLeverageRatio != null ? parseFloat(a.maxLeverageRatio) : null,
    ipsVersion: a.ipsVersion ?? null,
    concentrationLimit: a.concentrationLimit != null ? parseFloat(a.concentrationLimit) : null,
    leverageCeiling: a.leverageCeiling != null ? parseFloat(a.leverageCeiling) : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

router.get("/", async (_req, res) => {
  try {
    const accounts = await db.select().from(accountsTable).orderBy(accountsTable.createdAt);
    const result = accounts.map(toAccountResponse);
    res.json(result);
  } catch (error) {
    console.error("[accounts GET /] Error:", error);
    res.status(500).json({ error: "Failed to fetch accounts" });
  }
});

router.post("/", validate(CreateAccountBody), async (req, res) => {
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
    res.status(201).json(toAccountResponse(account));
  } catch (error) {
    res.status(500).json({ error: "Failed to create account" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, id));
    if (!account) return res.status(404).json({ error: "Account not found" });
    res.json(toAccountResponse(account));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch account" });
  }
});

router.put("/:id", validate(UpdateAccountBody), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, broker, accountType, currentBalance, sleeveKey, maxLeverageRatio, ipsVersion, concentrationLimit, leverageCeiling } = req.body;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (broker !== undefined) updates.broker = broker;
    if (accountType !== undefined) updates.accountType = accountType;
    if (currentBalance !== undefined) updates.currentBalance = currentBalance.toString();
    if (sleeveKey !== undefined) updates.sleeveKey = sleeveKey || null;
    if (maxLeverageRatio !== undefined) updates.maxLeverageRatio = maxLeverageRatio != null ? maxLeverageRatio.toString() : null;
    if (ipsVersion !== undefined) updates.ipsVersion = ipsVersion || null;
    if (concentrationLimit !== undefined) updates.concentrationLimit = concentrationLimit != null ? concentrationLimit.toString() : null;
    if (leverageCeiling !== undefined) updates.leverageCeiling = leverageCeiling != null ? leverageCeiling.toString() : null;
    const [account] = await db.update(accountsTable).set(updates).where(eq(accountsTable.id, id)).returning();
    if (!account) return res.status(404).json({ error: "Account not found" });
    res.json(toAccountResponse(account));
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

    // Closed tombstones (qty=0) are returned for activity linking but get no live price fetch.
    const activePositions = positions.filter(p => parseFloat(p.quantity) > 0);
    const closedPositions = positions.filter(p => parseFloat(p.quantity) <= 0);

    // Fetch live prices only for active positions
    const priceMap = activePositions.length > 0
      ? await fetchLivePrices(activePositions.map(p => p.symbol))
      : {};

    // Persist updated prices to DB in the background
    await Promise.allSettled(
      activePositions
        .filter(p => priceMap[p.symbol] !== undefined)
        .map(p =>
          db.update(positionsTable)
            .set({ currentPrice: priceMap[p.symbol].price.toString(), updatedAt: new Date() })
            .where(eq(positionsTable.id, p.id))
        )
    );

    const mapPosition = (p: typeof positions[number], live: boolean) => {
      const qty = parseFloat(p.quantity);
      const avg = parseFloat(p.avgCost);
      const cur = live ? (priceMap[p.symbol]?.price ?? parseFloat(p.currentPrice)) : parseFloat(p.currentPrice);
      const marketValue = qty * cur;
      const unrealizedPnl = marketValue - qty * avg;
      const unrealizedPnlPct = qty * avg > 0 ? (unrealizedPnl / (qty * avg)) * 100 : 0;
      const prevPrice = live ? (priceMap[p.symbol]?.previousClose ?? cur) : cur;
      const dayChange = qty * (cur - prevPrice);
      const dayChangePct = live ? (priceMap[p.symbol]?.changePercent ?? 0) : 0;
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
        closed: !live,
        assetType: p.assetType ?? undefined,
        sector: p.sector ?? undefined,
        notes: p.notes ?? undefined,
        positionBucket: p.positionBucket ?? null,
        ipsAction: p.ipsAction ?? null,
        stopPrice: p.stopPrice != null ? parseFloat(p.stopPrice) : null,
        addZoneLow: p.addZoneLow != null ? parseFloat(p.addZoneLow) : null,
        addZoneHigh: p.addZoneHigh != null ? parseFloat(p.addZoneHigh) : null,
        cutListAddedAt: p.cutListAddedAt ? p.cutListAddedAt.toISOString() : null,
        policyNote: p.policyNote ?? null,
        ipsVersion: p.ipsVersion ?? null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    };

    const result = [
      ...activePositions.map(p => mapPosition(p, true)),
      ...closedPositions.map(p => mapPosition(p, false)),
    ];
    res.json(result);
  } catch (error) {
    console.error(`[accounts GET /:id/positions] Error:`, error);
    res.status(500).json({ error: "Failed to fetch positions" });
  }
});

export default router;
