import { pgTable, serial, text, numeric, integer, timestamp } from "drizzle-orm/pg-core";

export const priceAlertsTable = pgTable("price_alerts", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  positionId: integer("position_id"),
  accountId: integer("account_id"),
  triggerPrice: numeric("trigger_price", { precision: 10, scale: 4 }).notNull(),
  direction: text("direction").notNull(), // 'above' | 'below'
  note: text("note"),
  status: text("status").notNull().default("active"), // 'active' | 'triggered' | 'dismissed'
  createdAt: timestamp("created_at").notNull().defaultNow(),
  triggeredAt: timestamp("triggered_at"),
});
