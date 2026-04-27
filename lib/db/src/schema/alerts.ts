import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const alertsTable = pgTable("alerts", {
  id:             serial("id").primaryKey(),
  accountId:      integer("account_id").notNull(),
  positionId:     integer("position_id"),           // null for account-level alerts (e.g. leverage)
  symbol:         text("symbol"),                   // denormalised for display; null for account-level
  alertType:      text("alert_type").notNull(),     // 'concentration' | 'drawdown' | 'leverage'
  severity:       text("severity").notNull(),       // 'warning' | 'critical'
  title:          text("title").notNull(),
  message:        text("message").notNull(),
  metricValue:    numeric("metric_value",    { precision: 10, scale: 4 }).notNull(),
  thresholdValue: numeric("threshold_value", { precision: 10, scale: 4 }).notNull(),
  /** Stable deduplication key. Format: `{alertType}:{accountId}:{positionId|account}` */
  fingerprint:    text("fingerprint").notNull().unique(),
  status:         text("status").notNull().default("active"),  // 'active' | 'acknowledged' | 'resolved'
  acknowledgedAt: timestamp("acknowledged_at"),
  resolvedAt:     timestamp("resolved_at"),
  dismissReason:  text("dismiss_reason"),          // logged reason for acknowledged/red items
  generatedAt:    timestamp("generated_at").notNull().defaultNow(),
  userId:         text("user_id").notNull(),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
});

export const insertAlertSchema = createInsertSchema(alertsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type AlertRow = typeof alertsTable.$inferSelect;
