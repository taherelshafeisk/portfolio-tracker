import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { positionsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const router: IRouter = Router();

const YAHOO_BASE = "https://query1.finance.yahoo.com";

async function fetchLivePrice(symbol: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${YAHOO_BASE}/v8/finance/chart/${symbol}?interval=1d&range=5d`,
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof price === "number" ? price : null;
  } catch {
    return null;
  }
}

async function fetchLivePrices(symbols: string[]): Promise<Record<string, number>> {
  const unique = [...new Set(symbols)];
  const results = await Promise.allSettled(
    unique.map(async (sym) => ({ sym, price: await fetchLivePrice(sym) }))
  );
  const priceMap: Record<string, number> = {};
  for (const r of results) {
    if (r.status === "fulfilled" && r.value.price !== null) {
      priceMap[r.value.sym] = r.value.price;
    }
  }
  return priceMap;
}

function toPositionResponse(p: typeof positionsTable.$inferSelect, livePrice?: number) {
  const qty = parseFloat(p.quantity);
  const avg = parseFloat(p.avgCost);
  const cur = livePrice ?? parseFloat(p.currentPrice);
  const marketValue = qty * cur;
  const unrealizedPnl = marketValue - qty * avg;
  const unrealizedPnlPct = qty * avg > 0 ? (unrealizedPnl / (qty * avg)) * 100 : 0;
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
    sector: p.sector ?? undefined,
    notes: p.notes ?? undefined,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

router.post("/", async (req, res) => {
  try {
    const { accountId, symbol, name, quantity, avgCost, sector, notes } = req.body;
    const upperSymbol = symbol.toUpperCase();

    // Fetch live price at insert time
    const livePrice = await fetchLivePrice(upperSymbol);
    const priceToStore = livePrice ?? parseFloat(avgCost);

    const [position] = await db.insert(positionsTable).values({
      accountId,
      symbol: upperSymbol,
      name,
      quantity: quantity.toString(),
      avgCost: avgCost.toString(),
      currentPrice: priceToStore.toString(),
      sector: sector || null,
      notes: notes || null,
    }).returning();

    res.status(201).json(toPositionResponse(position, livePrice ?? undefined));
  } catch (error) {
    console.error("Failed to create position:", error);
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
    res.json(toPositionResponse(position));
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

// Refresh live prices for a list of position IDs and persist to DB
router.post("/refresh-prices", async (req, res) => {
  try {
    const { accountId } = req.body as { accountId?: number };
    let positions;
    if (accountId) {
      positions = await db.select().from(positionsTable).where(eq(positionsTable.accountId, accountId));
    } else {
      positions = await db.select().from(positionsTable);
    }
    if (positions.length === 0) return res.json({ updated: 0 });

    const symbols = positions.map(p => p.symbol);
    const priceMap = await fetchLivePrices(symbols);

    // Update DB for each position that has a live price
    const updates = await Promise.allSettled(
      positions
        .filter(p => priceMap[p.symbol] !== undefined)
        .map(p =>
          db.update(positionsTable)
            .set({ currentPrice: priceMap[p.symbol].toString(), updatedAt: new Date() })
            .where(eq(positionsTable.id, p.id))
        )
    );
    res.json({ updated: updates.filter(r => r.status === "fulfilled").length });
  } catch (error) {
    res.status(500).json({ error: "Failed to refresh prices" });
  }
});

export { fetchLivePrices };
export default router;
