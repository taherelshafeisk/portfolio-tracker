import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const positionFlagsTable = pgTable("position_flags", {
  id:                          serial("id").primaryKey(),
  positionId:                  integer("position_id"),        // null for account-level flags (leverage)
  accountId:                   integer("account_id").notNull(),
  flagType:                    text("flag_type").notNull(),   // 'cut'|'trim'|'review'|'stop'|'reduce_leverage'
  source:                      text("source").notNull().default("user"), // 'user'|'system'
  createdAt:                   timestamp("created_at").notNull().defaultNow(),
  dueAt:                       timestamp("due_at"),
  resolvedAt:                  timestamp("resolved_at"),
  resolutionType:              text("resolution_type"),       // 'sold'|'trimmed'|'dismissed'|'expired'|'manual_complete'
  resolutionNote:              text("resolution_note"),
  appGeneratedReasonSnapshot:  text("app_generated_reason_snapshot"),
  userConfirmed:               boolean("user_confirmed").notNull().default(false),
});

export const insertPositionFlagSchema = createInsertSchema(positionFlagsTable).omit({
  id: true, createdAt: true,
});
export type InsertPositionFlag = z.infer<typeof insertPositionFlagSchema>;
export type PositionFlagRow = typeof positionFlagsTable.$inferSelect;
