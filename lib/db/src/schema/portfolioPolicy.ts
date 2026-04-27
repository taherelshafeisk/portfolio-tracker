import { pgTable, serial, text, numeric, date, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Single-row table that stores portfolio-level IPS policy fields.
 * Application enforces a single row (id = 1). Use upsert on id = 1.
 *
 * All fields are nullable — the row may be partially filled before the full
 * IPS is entered. Route returns {} when no row exists yet.
 */
export const portfolioPolicyTable = pgTable("portfolio_policy", {
  id:                  serial("id").primaryKey(),
  goldFloorPct:        numeric("gold_floor_pct",        { precision: 10, scale: 4 }), // 0.05 = 5%
  goldTargetPct:       numeric("gold_target_pct",       { precision: 10, scale: 4 }), // 0.09 = 9%
  goldTargetDate:      date("gold_target_date"),                                       // e.g. 2026-12-31
  monthlyContribution: numeric("monthly_contribution",  { precision: 20, scale: 4 }), // e.g. 5000
  macroPosture:        text("macro_posture"),                                          // freeform narrative
  ipsVersion:          text("ips_version"),                                            // e.g. 'v4.8'
  ipsDate:             date("ips_date"),                                               // e.g. 2026-03-26
  userId:              text("user_id").notNull(),
  updatedAt:           timestamp("updated_at").notNull().defaultNow(),
});

export const insertPortfolioPolicySchema = createInsertSchema(portfolioPolicyTable).omit({
  id: true, updatedAt: true,
});
export type InsertPortfolioPolicy = z.infer<typeof insertPortfolioPolicySchema>;
export type PortfolioPolicyRow = typeof portfolioPolicyTable.$inferSelect;
