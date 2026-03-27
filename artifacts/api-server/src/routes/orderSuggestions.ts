import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { accountsTable, positionsTable, orderSuggestionsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { validate } from "../middlewares/validate";
import { GenerateOrderSuggestionsBody, UpdateOrderSuggestionBody } from "@workspace/api-zod/schemas";
import { generateSuggestions } from "../lib/suggestion-engine";

const router: IRouter = Router();

function formatSuggestion(row: typeof orderSuggestionsTable.$inferSelect, accountName: string) {
  return {
    id: row.id,
    accountId: row.accountId,
    accountName,
    symbol: row.symbol,
    side: row.side,
    quantity: row.quantity !== null ? parseFloat(row.quantity) : null,
    quantityMin: row.quantityMin !== null ? parseFloat(row.quantityMin) : null,
    quantityMax: row.quantityMax !== null ? parseFloat(row.quantityMax) : null,
    orderType: row.orderType,
    limitPrice: row.limitPrice !== null ? parseFloat(row.limitPrice) : null,
    stopPrice: row.stopPrice !== null ? parseFloat(row.stopPrice) : null,
    priceLogic: row.priceLogic ?? null,
    timeInForce: row.timeInForce,
    urgency: row.urgency,
    rationale: row.rationale,
    trigger: row.trigger,
    executionNotes: row.executionNotes ?? null,
    status: row.status,
    generatedAt: row.generatedAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// POST /order-suggestions/generate
router.post("/generate", validate(GenerateOrderSuggestionsBody), async (req, res) => {
  try {
    const { accountId } = req.body as { accountId?: number | null };

    const [allAccounts, allPositions] = await Promise.all([
      db.select().from(accountsTable),
      db.select().from(positionsTable),
    ]);

    const engineAccounts = allAccounts.map(a => ({
      id: a.id,
      name: a.name,
      currentBalance: parseFloat(a.currentBalance),
    }));

    const enginePositions = allPositions.map(p => ({
      id: p.id,
      accountId: p.accountId,
      symbol: p.symbol,
      quantity: parseFloat(p.quantity),
      avgCost: parseFloat(p.avgCost),
      currentPrice: parseFloat(p.currentPrice),
    }));

    const inputs = generateSuggestions(
      engineAccounts,
      enginePositions,
      accountId ?? undefined,
    );

    if (inputs.length === 0) {
      res.json([]);
      return;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h

    const inserted = await db
      .insert(orderSuggestionsTable)
      .values(
        inputs.map(s => ({
          accountId: s.accountId,
          symbol: s.symbol,
          side: s.side,
          quantity: s.quantity !== undefined ? s.quantity.toString() : null,
          quantityMin: s.quantityMin !== undefined ? s.quantityMin.toString() : null,
          quantityMax: s.quantityMax !== undefined ? s.quantityMax.toString() : null,
          orderType: s.orderType,
          limitPrice: s.limitPrice !== undefined ? s.limitPrice.toString() : null,
          stopPrice: s.stopPrice !== undefined ? s.stopPrice.toString() : null,
          priceLogic: s.priceLogic ?? null,
          timeInForce: s.timeInForce,
          urgency: s.urgency,
          rationale: s.rationale,
          trigger: s.trigger,
          executionNotes: s.executionNotes ?? null,
          status: "pending" as const,
          generatedAt: now,
          expiresAt,
        })),
      )
      .returning();

    const accountNameMap = Object.fromEntries(allAccounts.map(a => [a.id, a.name]));
    res.json(inserted.map(r => formatSuggestion(r, accountNameMap[r.accountId] ?? "")));
  } catch (error) {
    res.status(500).json({ error: "Failed to generate order suggestions" });
  }
});

// GET /order-suggestions
router.get("/", async (req, res) => {
  try {
    const accountIdParam = req.query.accountId;
    const accountId = accountIdParam ? parseInt(accountIdParam as string, 10) : undefined;

    const rows = accountId
      ? await db
          .select()
          .from(orderSuggestionsTable)
          .where(eq(orderSuggestionsTable.accountId, accountId))
          .orderBy(orderSuggestionsTable.generatedAt)
      : await db
          .select()
          .from(orderSuggestionsTable)
          .orderBy(orderSuggestionsTable.generatedAt);

    if (rows.length === 0) {
      res.json([]);
      return;
    }

    const accountIds = [...new Set(rows.map(r => r.accountId))];
    const accounts = await db
      .select({ id: accountsTable.id, name: accountsTable.name })
      .from(accountsTable)
      .where(inArray(accountsTable.id, accountIds));
    const accountNameMap = Object.fromEntries(accounts.map(a => [a.id, a.name]));

    res.json(rows.map(r => formatSuggestion(r, accountNameMap[r.accountId] ?? "")));
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch order suggestions" });
  }
});

// PATCH /order-suggestions/:id
router.patch("/:id", validate(UpdateOrderSuggestionBody), async (req, res) => {
  try {
    const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
    const { status } = req.body as { status: string };

    const [updated] = await db
      .update(orderSuggestionsTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(orderSuggestionsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Order suggestion not found" });
      return;
    }

    const [account] = await db
      .select({ id: accountsTable.id, name: accountsTable.name })
      .from(accountsTable)
      .where(eq(accountsTable.id, updated.accountId));

    res.json(formatSuggestion(updated, account?.name ?? ""));
  } catch (error) {
    res.status(500).json({ error: "Failed to update order suggestion" });
  }
});

export default router;
