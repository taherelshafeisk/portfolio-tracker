/**
 * One-time migration: adds user_id TEXT NOT NULL to all user-owned tables.
 *
 * Steps:
 *   1. Generate a UUID for Taher — log it so the operator can copy it into .env / Railway
 *   2. ALTER each table to add user_id with a temporary DEFAULT of that UUID
 *   3. UPDATE all existing rows to ensure user_id is set
 *   4. DROP DEFAULT on each column (future inserts must supply user_id explicitly)
 *
 * Run:
 *   DATABASE_URL=<...> tsx scripts/src/migrate-add-user-id.ts
 * or:
 *   tsx --env-file artifacts/api-server/.env scripts/src/migrate-add-user-id.ts
 *
 * Safe to re-run: uses IF NOT EXISTS for ADD COLUMN.
 */

import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Tables that get a top-level user_id column.
// Tables that are child rows accessed via FK from a parent (messages, tradeAnnotations,
// convictionAttachments, policyProposalItems) are intentionally excluded — filter them
// through their parent's user_id.
const USER_OWNED_TABLES = [
  "accounts",
  "positions",
  "activities",
  "conversations",
  "alerts",
  "order_suggestions",
  "portfolio_policy",
  "portfolio_snapshots",
  "macro_posture",
  "position_flags",
  "price_alerts",
  "policy_proposals",
] as const;

// These tables already have a user_id column (added by previous migration or schema design)
// but may be nullable — we'll backfill them separately.
const ALREADY_HAVE_USER_ID = ["convictions", "ips_builder_sessions"] as const;

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const taherId = crypto.randomUUID();
    console.log("\n==================================================");
    console.log(`TAHER_USER_ID: ${taherId}`);
    console.log("Copy this value into:");
    console.log("  - artifacts/api-server/.env  (TAHER_USER_ID=...)");
    console.log("  - Railway environment variables");
    console.log("==================================================\n");

    for (const table of USER_OWNED_TABLES) {
      console.log(`Migrating table: ${table}`);

      // Add column with temporary DEFAULT so NOT NULL doesn't reject existing rows
      await client.query(`
        ALTER TABLE ${table}
          ADD COLUMN IF NOT EXISTS user_id TEXT NOT NULL DEFAULT '${taherId}'
      `);

      // Backfill — idempotent if column already existed with correct value
      await client.query(`
        UPDATE ${table} SET user_id = '${taherId}'
        WHERE user_id = '${taherId}'
      `);

      // Drop the DEFAULT — all future inserts must supply user_id explicitly
      await client.query(`
        ALTER TABLE ${table} ALTER COLUMN user_id DROP DEFAULT
      `);

      console.log(`  ✓ ${table}.user_id added and backfilled`);
    }

    // Backfill the tables that already have user_id (nullable → set Taher's UUID)
    for (const table of ALREADY_HAVE_USER_ID) {
      console.log(`Backfilling existing user_id on: ${table}`);
      await client.query(`
        UPDATE ${table} SET user_id = '${taherId}' WHERE user_id IS NULL
      `);
      console.log(`  ✓ ${table}.user_id backfilled`);
    }

    await client.query("COMMIT");
    console.log("\nMigration complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed, rolled back:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
