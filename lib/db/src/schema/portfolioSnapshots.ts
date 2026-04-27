import { pgTable, serial, integer, numeric, timestamp, date, uniqueIndex, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const portfolioSnapshotsTable = pgTable("portfolio_snapshots", {
  id: serial("id").primaryKey(),
  snapshotDate: date("snapshot_date").notNull(),
  snapshotAt: timestamp("snapshot_at").notNull().defaultNow(),
  // null = total portfolio rollup; non-null = per-account row
  accountId: integer("account_id"),
  navUsd: numeric("nav_usd", { precision: 20, scale: 4 }).notNull(),
  cashUsd: numeric("cash_usd", { precision: 20, scale: 4 }).notNull(),
  investedUsd: numeric("invested_usd", { precision: 20, scale: 4 }).notNull(),
  dayChangeUsd: numeric("day_change_usd", { precision: 20, scale: 4 }).notNull().default("0"),
  dayChangePct: numeric("day_change_pct", { precision: 10, scale: 6 }).notNull().default("0"),
  aedUsdRate: numeric("aed_usd_rate", { precision: 10, scale: 6 }).notNull().default("1"),
  positionCount: integer("position_count").notNull().default(0),
  userId: text("user_id").notNull(),
}, (t) => [
  // One row per account (or null rollup) per day
  uniqueIndex("portfolio_snapshots_date_account_idx").on(t.snapshotDate, t.accountId),
]);

export const insertPortfolioSnapshotSchema = createInsertSchema(portfolioSnapshotsTable).omit({ id: true });
export type InsertPortfolioSnapshot = z.infer<typeof insertPortfolioSnapshotSchema>;
export type PortfolioSnapshot = typeof portfolioSnapshotsTable.$inferSelect;
