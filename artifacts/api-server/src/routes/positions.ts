import { Router, type IRouter } from "express";
import { checkPriceAlerts } from "./priceAlerts";
import { validate } from "../middlewares/validate";
import { CreatePositionBody, UpdatePositionBody } from "@workspace/api-zod/schemas";
import { logger } from "../lib/logger";
import {
  getPositionHistorySleeves,
  getPositionHistoryByTicker,
  getPositionTradeHistory,
  createPosition,
  updatePosition,
  deletePosition,
  refreshPositionPrices,
} from "../services/positionService";

const router: IRouter = Router();

// ─── GET /history — sleeve-level aggregation (literal, must precede /:id) ─────
router.get("/history", async (req, res) => {
  try {
    const accountId = req.query.accountId ? parseInt(req.query.accountId as string) : null;
    const statusFilter = (req.query.status as string) || 'all';
    const sleeves = await getPositionHistorySleeves(req.userId, accountId, statusFilter);
    res.json(sleeves);
  } catch (error) {
    logger.error(error, "[positions GET /history] Error");
    res.status(500).json({ error: "Failed to fetch position history" });
  }
});

// ─── GET /history/:ticker — position-level detail (literal prefix, before /:id) ─
router.get("/history/:ticker", async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const accountId = req.query.accountId ? parseInt(req.query.accountId as string) : null;
    if (!accountId) { res.status(400).json({ error: "accountId query param is required" }); return; }

    const result = await getPositionHistoryByTicker(req.userId, accountId, ticker);
    if (!result) { res.status(404).json({ error: "Position not found" }); return; }
    res.json(result);
  } catch (error) {
    logger.error(error, "[positions GET /history/:ticker] Error");
    res.status(500).json({ error: "Failed to fetch position detail" });
  }
});

router.post("/", validate(CreatePositionBody), async (req, res) => {
  try {
    const { accountId, symbol, name, quantity, avgCost, assetType, sector, notes,
            positionBucket, ipsAction, stopPrice, addZoneLow, addZoneHigh,
            cutListAddedAt, policyNote, ipsVersion } = req.body;
    const result = await createPosition(req.userId, {
      accountId, symbol, name, quantity, avgCost, assetType, sector, notes,
      positionBucket, ipsAction, stopPrice, addZoneLow, addZoneHigh,
      cutListAddedAt, policyNote, ipsVersion,
    });
    res.status(201).json(result);
  } catch (error) {
    logger.error(error, "Failed to create position");
    res.status(500).json({ error: "Failed to create position" });
  }
});

router.put("/:id", validate(UpdatePositionBody), async (req, res) => {
  try {
    const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
    const { quantity, avgCost, currentPrice, assetType, notes,
            positionBucket, ipsAction, stopPrice, targetPrice, addZoneLow, addZoneHigh,
            cutListAddedAt, policyNote, ipsVersion, exitReason } = req.body;
    const result = await updatePosition(req.userId, id, {
      quantity, avgCost, currentPrice, assetType, notes,
      positionBucket, ipsAction, stopPrice, targetPrice, addZoneLow, addZoneHigh,
      cutListAddedAt, policyNote, ipsVersion, exitReason,
    });
    if (!result) { res.status(404).json({ error: "Position not found" }); return; }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to update position" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await deletePosition(req.userId, id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete position" });
  }
});

router.post("/refresh-prices", async (req, res) => {
  try {
    const { accountId } = req.body as { accountId?: number };
    const result = await refreshPositionPrices(req.userId, accountId);
    // No positions — return early without alertsTriggered field (preserves original shape)
    if (!result) { res.json({ updated: 0 }); return; }
    const alertsTriggered = await checkPriceAlerts(result.priceMap).catch(() => 0);
    res.json({ updated: result.updated, alertsTriggered });
  } catch (error) {
    res.status(500).json({ error: "Failed to refresh prices" });
  }
});

/** Returns trade history (activities) for a position, newest first. */
router.get("/:id/history", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await getPositionTradeHistory(req.userId, id);
    if (!result) { res.status(404).json({ error: "Position not found" }); return; }
    res.json(result);
  } catch (error) {
    logger.error(error, "[positions GET /:id/history] Error");
    res.status(500).json({ error: "Failed to fetch position history" });
  }
});

export default router;
