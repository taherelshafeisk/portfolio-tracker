import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { convictionsTable } from "./convictions";

export const convictionAttachmentsTable = pgTable("conviction_attachments", {
  id:           text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  convictionId: text("conviction_id").notNull().references(() => convictionsTable.id, { onDelete: "cascade" }),
  storagePath:  text("storage_path").notNull(),   // relative path on server filesystem
  mimeType:     text("mime_type").notNull(),       // 'image/jpeg' | 'image/png' | 'image/webp' etc.
  displayOrder: integer("display_order").notNull(), // preserves user upload order
  createdAt:    timestamp("created_at").notNull().defaultNow(),
});

export type ConvictionAttachment = typeof convictionAttachmentsTable.$inferSelect;
export type InsertConvictionAttachment = typeof convictionAttachmentsTable.$inferInsert;
