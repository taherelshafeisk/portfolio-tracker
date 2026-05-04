import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { portfolioSnapshotsTable } from "@workspace/db";
import { desc, eq, isNull, and } from "drizzle-orm";
import { captureSnapshot } from "../lib/snapshotService";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/capture", async (req, res) => {
  try {
    const result = await captureSnapshot(req.userId);
    res.json(result);
  } catch (error) {
    logger.error(error, "[snapshots POST /capture] Error");
    res.status(500).json({ error: "Snapshot capture failed" });
  }
});

router.get("/", async (req, res) => {
  try {
    const accountIdParam = req.query.accountId;
    let rows;
    if (accountIdParam === undefined) {
      rows = await db.select().from(portfolioSnapshotsTable)
        .where(and(isNull(portfolioSnapshotsTable.accountId), eq(portfolioSnapshotsTable.userId, req.userId)))
        .orderBy(desc(portfolioSnapshotsTable.snapshotDate))
        .limit(90);
    } else {
      const accountId = parseInt(accountIdParam as string);
      rows = await db.select().from(portfolioSnapshotsTable)
        .where(and(eq(portfolioSnapshotsTable.accountId, accountId), eq(portfolioSnapshotsTable.userId, req.userId)))
        .orderBy(desc(portfolioSnapshotsTable.snapshotDate))
        .limit(90);
    }
    res.json(rows.map(r => ({
      id: r.id, snapshotDate: r.snapshotDate, snapshotAt: r.snapshotAt,
      accountId: r.accountId, navUsd: parseFloat(r.navUsd), cashUsd: parseFloat(r.cashUsd),
      investedUsd: parseFloat(r.investedUsd), dayChangeUsd: parseFloat(r.dayChangeUsd),
      dayChangePct: parseFloat(r.dayChangePct), aedUsdRate: parseFloat(r.aedUsdRate),
      positionCount: r.positionCount,
    })));
  } catch (error) {
    logger.error(error, "[snapshots GET /] Error");
    res.status(500).json({ error: "Failed to fetch snapshots" });
  }
});

export default router;
