import { pgTable, text, timestamp, boolean, uuid, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ipsBuilderSessionsTable = pgTable("ips_builder_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id"),
  conversationHistory: jsonb("conversation_history").$type<{ role: "assistant" | "user"; content: string }[]>().default([]).notNull(),
  coveredPositions: jsonb("covered_positions").$type<string[]>().default([]).notNull(),
  goalsComplete: boolean("goals_complete").default(false).notNull(),
  ipsComplete: boolean("ips_complete").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertIpsBuilderSessionSchema = createInsertSchema(ipsBuilderSessionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type IpsBuilderSession = typeof ipsBuilderSessionsTable.$inferSelect;
export type InsertIpsBuilderSession = z.infer<typeof insertIpsBuilderSessionSchema>;
