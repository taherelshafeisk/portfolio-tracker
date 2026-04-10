import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const convictionsTable = pgTable("convictions", {
  id:              text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId:          text("user_id"),                    // nullable for now — single-user app
  sourceType:      text("source_type").notNull(),      // 'NEWS' | 'VIDEO' | 'PERSON' | 'OWN_THESIS'
  sourceUrl:       text("source_url"),
  sourceName:      text("source_name"),                // e.g. "Bloomberg", "Kobeissi"
  rawNote:         text("raw_note"),                   // user's own interpretation
  fetchedContent:  text("fetched_content"),            // extracted article text
  fetchStatus:     text("fetch_status").notNull().default("PENDING"), // 'PENDING' | 'SUCCESS' | 'FAILED' | 'SKIPPED'
  tickers:         text("tickers").array(),
  themes:          text("themes").array(),
  claudeProposal:  jsonb("claude_proposal"),           // structured proposal from Claude
  proposalStatus:  text("proposal_status").notNull().default("PROCESSING"), // 'PROCESSING' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'
  rejectionReason: text("rejection_reason"),
  actionId:        integer("action_id"),               // FK to order_suggestions when approved with TRADE type
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
});

export type Conviction = typeof convictionsTable.$inferSelect;
export type InsertConviction = typeof convictionsTable.$inferInsert;
