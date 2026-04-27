import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const activitiesTable = pgTable("activities", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  symbol: text("symbol"),
  activityType: text("activity_type").notNull(),
  quantity: numeric("quantity", { precision: 20, scale: 8 }),
  price: numeric("price", { precision: 20, scale: 4 }),
  totalAmount: numeric("total_amount", { precision: 20, scale: 4 }),
  notes: text("notes"),
  tradeDate: timestamp("trade_date").notNull(),
  userId: text("user_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertActivitySchema = createInsertSchema(activitiesTable).omit({ id: true, createdAt: true });
export type InsertActivity = z.infer<typeof insertActivitySchema>;
export type Activity = typeof activitiesTable.$inferSelect;
