import { pgTable, serial, integer, text, numeric, jsonb, timestamp } from "drizzle-orm/pg-core";

export const policyProposalsTable = pgTable("policy_proposals", {
  id:             serial("id").primaryKey(),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  ipsVersion:     text("ips_version"),
  sourceFilename: text("source_filename"),
  /** pending | completed | dismissed */
  status:         text("status").notNull().default("pending"),
});

export const policyProposalItemsTable = pgTable("policy_proposal_items", {
  id:              serial("id").primaryKey(),
  proposalId:      integer("proposal_id").notNull().references(() => policyProposalsTable.id, { onDelete: "cascade" }),
  /** position | account | portfolio */
  entityType:      text("entity_type").notNull(),
  /** symbol for positions, account name for accounts */
  entityKey:       text("entity_key").notNull(),
  /** extracted policy fields — jsonb */
  proposedFields:  jsonb("proposed_fields").notNull(),
  confidence:      numeric("confidence", { precision: 4, scale: 3 }),
  rationale:       text("rationale"),
  evidenceSnippet: text("evidence_snippet"),
  /** pending | approved | rejected | edited */
  status:          text("status").notNull().default("pending"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
});
