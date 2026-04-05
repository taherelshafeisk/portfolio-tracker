import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { activitiesTable } from "./activities";

export const tradeAnnotationsTable = pgTable("trade_annotations", {
  id:          serial("id").primaryKey(),
  activityId:  integer("activity_id").notNull().unique().references(() => activitiesTable.id, { onDelete: "cascade" }),
  thesis:      text("thesis"),
  ipsAligned:  boolean("ips_aligned"),
  plannedExit: text("planned_exit"),
  /** 'right_decision' | 'wrong_decision' | 'too_early_to_tell' */
  verdict:     text("verdict"),
  verdictNote: text("verdict_note"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
});

export const insertTradeAnnotationSchema = createInsertSchema(tradeAnnotationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTradeAnnotation = z.infer<typeof insertTradeAnnotationSchema>;
export type TradeAnnotation = typeof tradeAnnotationsTable.$inferSelect;
