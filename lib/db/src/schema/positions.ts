import { pgTable, serial, integer, text, numeric, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const positionsTable = pgTable("positions", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  quantity: numeric("quantity", { precision: 20, scale: 8 }).notNull(),
  avgCost: numeric("avg_cost", { precision: 20, scale: 4 }).notNull(),
  currentPrice: numeric("current_price", { precision: 20, scale: 4 }).notNull().default("0"),
  assetType: text("asset_type"),
  sector: text("sector"),
  notes: text("notes"),
  // IPS / policy fields (all nullable — additive, no breaking change)
  positionBucket: text("position_bucket"),   // 'core'|'swing'|'spec'|'def'|'anchor'|'inc'|'cut'
  ipsAction: text("ips_action"),             // 'hold'|'add'|'trim'|'monitor'|'cut'|'exit'
  stopPrice: numeric("stop_price", { precision: 20, scale: 4 }),
  addZoneLow: numeric("add_zone_low", { precision: 20, scale: 4 }),
  addZoneHigh: numeric("add_zone_high", { precision: 20, scale: 4 }),
  cutListAddedAt: timestamp("cut_list_added_at"),
  policyNote: text("policy_note"),
  ipsVersion: text("ips_version"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("positions_account_symbol_idx").on(t.accountId, t.symbol),
]);

export const insertPositionSchema = createInsertSchema(positionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPosition = z.infer<typeof insertPositionSchema>;
export type Position = typeof positionsTable.$inferSelect;
