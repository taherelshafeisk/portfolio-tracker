import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const orderSuggestionsTable = pgTable("order_suggestions", {
  id:             serial("id").primaryKey(),
  accountId:      integer("account_id").notNull(),
  symbol:         text("symbol").notNull(),
  side:           text("side").notNull(),           // 'buy' | 'sell'
  quantity:       numeric("quantity",     { precision: 20, scale: 8 }),
  quantityMin:    numeric("quantity_min", { precision: 20, scale: 8 }),
  quantityMax:    numeric("quantity_max", { precision: 20, scale: 8 }),
  orderType:      text("order_type").notNull(),     // 'market' | 'limit' | 'stop' | 'stop_limit' | 'laddered_limit'
  limitPrice:     numeric("limit_price", { precision: 20, scale: 4 }),
  stopPrice:      numeric("stop_price",  { precision: 20, scale: 4 }),
  priceLogic:     text("price_logic"),
  timeInForce:    text("time_in_force").notNull().default("gtc"),  // 'day' | 'gtc' | 'ioc'
  urgency:        text("urgency").notNull(),        // 'low' | 'medium' | 'high' | 'critical'
  rationale:      text("rationale").notNull(),
  trigger:        text("trigger").notNull(),        // free text for v1; FK to rules table in future
  executionNotes: text("execution_notes"),
  status:         text("status").notNull().default("pending"), // 'pending' | 'dismissed' | 'executed'
  generatedAt:    timestamp("generated_at").notNull().defaultNow(),
  expiresAt:      timestamp("expires_at"),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
});

export const insertOrderSuggestionSchema = createInsertSchema(orderSuggestionsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertOrderSuggestion = z.infer<typeof insertOrderSuggestionSchema>;
export type OrderSuggestionRow = typeof orderSuggestionsTable.$inferSelect;
