import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import type { ProposedFields } from "../services/ipsService";
import {
  listProposals,
  getPendingBuilderItems,
  getProposal,
  updateProposalItem,
  processBuilderStep,
  getBuilderSession,
} from "../services/ipsService";

const router: IRouter = Router();

router.get("/proposals", async (req, res) => {
  try {
    return res.json(await listProposals(req.userId));
  } catch {
    return res.status(500).json({ error: "Failed to fetch proposals" });
  }
});

router.get("/proposals/pending-items", async (req, res) => {
  try {
    return res.json(await getPendingBuilderItems(req.userId));
  } catch (err) {
    logger.error(err, "[ips/proposals/pending-items] error");
    return res.status(500).json({ error: "Failed to fetch pending items" });
  }
});

router.get("/proposals/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await getProposal(id, req.userId);
    if (!result) return res.status(404).json({ error: "Proposal not found" });
    return res.json(result);
  } catch {
    return res.status(500).json({ error: "Failed to fetch proposal" });
  }
});

router.put("/proposals/:id/items/:itemId", async (req, res) => {
  try {
    const itemId = parseInt(req.params.itemId);
    const { status, editedFields } = req.body as { status: string; editedFields?: ProposedFields };

    if (!["approved", "rejected", "edited"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const result = await updateProposalItem(itemId, req.userId, {
      status: status as "approved" | "rejected" | "edited",
      editedFields,
    });
    if ("notFound" in result) return res.status(404).json({ error: "Item not found" });
    if ("forbidden" in result) return res.status(403).json({ error: "Forbidden" });
    return res.json(result.item);
  } catch (err) {
    logger.error(err, "[ips/items] error");
    return res.status(500).json({ error: "Failed to update proposal item" });
  }
});

router.post("/builder/next", async (req, res) => {
  try {
    const { userMessage } = req.body as { userMessage?: string };
    return res.json(await processBuilderStep(req.userId, userMessage));
  } catch (err) {
    logger.error(err, "[ips/builder/next] error");
    return res.status(500).json({ error: "Failed to process builder step" });
  }
});

router.get("/builder/session", async (req, res) => {
  try {
    return res.json(await getBuilderSession(req.userId));
  } catch (err) {
    logger.error(err, "[ips/builder/session] error");
    return res.status(500).json({ error: "Failed to fetch builder session" });
  }
});

export default router;
