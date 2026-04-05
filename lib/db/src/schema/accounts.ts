import { pgTable, serial, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const accountsTable = pgTable("accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  broker: text("broker").notNull(),
  accountType: text("account_type").notNull(),
  currency: text("currency").notNull().default("USD"),
  initialBalance: numeric("initial_balance", { precision: 20, scale: 4 }).notNull().default("0"),
  currentBalance: numeric("current_balance", { precision: 20, scale: 4 }).notNull().default("0"),
  // IPS / policy fields (all nullable — additive, no breaking change)
  sleeveKey: text("sleeve_key"),                                            // 'A'|'B'|...|'H'
  maxLeverageRatio: numeric("max_leverage_ratio", { precision: 10, scale: 4 }),
  ipsVersion: text("ips_version"),
  // Compliance thresholds — null means use global default (0.20 / 1.50)
  concentrationLimit: numeric("concentration_limit", { precision: 10, scale: 4 }),
  leverageCeiling: numeric("leverage_ceiling", { precision: 10, scale: 4 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAccountSchema = createInsertSchema(accountsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accountsTable.$inferSelect;
