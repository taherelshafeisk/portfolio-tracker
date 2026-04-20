import { pgTable, text, timestamp, boolean, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const macroPostureTable = pgTable("macro_posture", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  notes: text("notes"),
  cryptoView: text("crypto_view"),
  isActive: boolean("is_active").default(true).notNull(),
  setAt: timestamp("set_at", { withTimezone: true }).defaultNow().notNull(),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertMacroPostureSchema = createInsertSchema(macroPostureTable).omit({ id: true, createdAt: true });
export type MacroPostureRecord = typeof macroPostureTable.$inferSelect;
export type InsertMacroPosture = z.infer<typeof insertMacroPostureSchema>;
