import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { portfolioSnapshotsTable } from "@workspace/db";
import { desc, eq, isNull, and } from "drizzle-orm";
import { captureSnapshot } from "../lib/snapshotService";

const router: IRouter = Router();

/** Manual trigger — also used for backfilling. Idempotent: re-running replaces today's rows. */
router.post("/capture", async (_req, res) => {
  try {
    const result = await captureSnapshot();
    res.json(result);
  } catch (error) {
    console.error("[snapshots POST /capture] Error:", error);
    res.status(500).json({ error: "Snapshot capture failed" });
  }
});

/** List recent snapshots — optional ?accountId= filter, defaults to rollup rows. */
router.get("/", async (req, res) => {
  try {
    const accountIdParam = req.query.accountId;
    let rows;
    if (accountIdParam === undefined) {
      rows = await db
        .select()
        .from(portfolioSnapshotsTable)
        .where(isNull(portfolioSnapshotsTable.accountId))
        .orderBy(desc(portfolioSnapshotsTable.snapshotDate))
        .limit(90);
    } else {
      const accountId = parseInt(accountIdParam as string);
      rows = await db
        .select()
        .from(portfolioSnapshotsTable)
        .where(eq(portfolioSnapshotsTable.accountId, accountId))
        .orderBy(desc(portfolioSnapshotsTable.snapshotDate))
        .limit(90);
    }
    res.json(rows.map(r => ({
      id: r.id,
      snapshotDate: r.snapshotDate,
      snapshotAt: r.snapshotAt,
      accountId: r.accountId,
      navUsd: parseFloat(r.navUsd),
      cashUsd: parseFloat(r.cashUsd),
      investedUsd: parseFloat(r.investedUsd),
      dayChangeUsd: parseFloat(r.dayChangeUsd),
      dayChangePct: parseFloat(r.dayChangePct),
      aedUsdRate: parseFloat(r.aedUsdRate),
      positionCount: r.positionCount,
    })));
  } catch (error) {
    console.error("[snapshots GET /] Error:", error);
    res.status(500).json({ error: "Failed to fetch snapshots" });
  }
});

export default router;
