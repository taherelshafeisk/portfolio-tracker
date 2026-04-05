import app from "./app";
import { logger } from "./lib/logger";
import { reconcileAll } from "./routes/activities";
import { db, activitiesTable, positionsTable } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function printDataIntegrityCheck() {
  // Two queries — all positions and all trade activities — then everything in-memory.
  const [positions, activities] = await Promise.all([
    db.select().from(positionsTable),
    db.select().from(activitiesTable),
  ]);

  // Build a map of (accountId|symbol) → activities for O(1) lookup
  type ActivityRow = typeof activitiesTable.$inferSelect;
  const activityMap = new Map<string, ActivityRow[]>();
  for (const act of activities) {
    if (!act.symbol) continue;
    const key = `${act.accountId}|${act.symbol}`;
    const bucket = activityMap.get(key) ?? [];
    bucket.push(act);
    activityMap.set(key, bucket);
  }

  const seedOnly: string[] = [];
  const withHistory: string[] = [];
  const drifted: Array<{ symbol: string; accountId: number; stored: number; reconciled: number; delta: number }> = [];

  for (const pos of positions) {
    const key = `${pos.accountId}|${pos.symbol}`;
    const acts = activityMap.get(key) ?? [];
    const hasBuys = acts.some((a) => a.activityType === "buy");
    const storedQty = parseFloat(pos.quantity);

    if (!hasBuys) {
      seedOnly.push(pos.symbol);
    } else {
      withHistory.push(pos.symbol);
    }

    // Compute reconciled qty using the same walk logic as reconcilePosition
    let reconQty = hasBuys ? 0 : storedQty; // seed baseline if no buys
    for (const act of acts.sort((a, b) => a.tradeDate.getTime() - b.tradeDate.getTime())) {
      const qty = act.quantity ? parseFloat(act.quantity) : 0;
      if (act.activityType === "buy" && qty > 0) {
        reconQty += qty;
      } else if (act.activityType === "sell" && qty > 0) {
        reconQty = Math.max(0, reconQty - qty);
      }
    }

    const delta = Math.abs(storedQty - reconQty);
    if (delta > 0.01) {
      drifted.push({ symbol: pos.symbol, accountId: pos.accountId, stored: storedQty, reconciled: reconQty, delta });
    }
  }

  const lines: string[] = [
    "┌─ DATA INTEGRITY CHECK ─────────────────────────────────",
    `│  Total positions      : ${positions.length}`,
    `│  With buy history     : ${withHistory.length}${withHistory.length ? " (" + withHistory.join(", ") + ")" : ""}`,
    `│  Seed-only (no buys)  : ${seedOnly.length}${seedOnly.length ? " (" + seedOnly.join(", ") + ")" : ""}`,
  ];

  if (drifted.length === 0) {
    lines.push("│  Qty drift > 0.01     : none");
  } else {
    lines.push(`│  Qty drift > 0.01     : ${drifted.length} position(s)`);
    for (const d of drifted) {
      lines.push(`│    ${d.symbol} (account ${d.accountId}): stored=${d.stored} reconciled=${d.reconciled.toFixed(4)} delta=${d.delta.toFixed(4)}`);
    }
  }

  lines.push("└────────────────────────────────────────────────────────");
  console.log(lines.join("\n"));
}

app.listen(port, async () => {
  logger.info({ port }, "Server listening");

  try {
    await printDataIntegrityCheck();
  } catch (err) {
    logger.error(err, "Data integrity check failed");
  }

  if (process.env["RECONCILE_ON_STARTUP"] === "true") {
    try {
      logger.info("RECONCILE_ON_STARTUP enabled — running reconcileAll...");
      const summary = await reconcileAll();
      logger.info(summary, "reconcileAll complete");
    } catch (err) {
      logger.error(err, "reconcileAll failed on startup");
    }
  }
});
