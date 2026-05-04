import { Router, type IRouter } from "express";
import { z } from "@workspace/api-zod/schemas";
import { logger } from "../lib/logger";
import { listFlags, createFlag, resolveFlag, deleteFlag } from "../services/flagService";

const router: IRouter = Router();

const createFlagSchema = z.object({
  positionId: z.number().int().optional(),
  accountId: z.number().int(),
  flagType: z.enum(["cut", "trim", "review", "stop", "reduce_leverage"]),
  source: z.enum(["user", "system"]).default("user"),
  dueAt: z.string().datetime().optional(),
  appGeneratedReasonSnapshot: z.string().optional(),
  userConfirmed: z.boolean().default(false),
});

const resolveFlagSchema = z.object({
  resolutionType: z.enum(["sold", "trimmed", "dismissed", "expired", "manual_complete"]),
  resolutionNote: z.string().optional(),
});

router.get("/", async (req, res) => {
  try {
    const { resolved, accountId, positionId } = req.query;
    const resolvedFilter = resolved === "true" ? true : resolved === "false" ? false : undefined;
    const flags = await listFlags(req.userId, {
      resolved: resolvedFilter,
      accountId: accountId ? Number(accountId) : undefined,
      positionId: positionId ? Number(positionId) : undefined,
    });
    res.json(flags);
  } catch (err) {
    logger.error(err, "[flags GET /]");
    res.status(500).json({ error: "Failed to fetch flags" });
  }
});

router.post("/", async (req, res) => {
  try {
    const parsed = createFlagSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
    const data = parsed.data;
    const flag = await createFlag(req.userId, {
      positionId: data.positionId,
      accountId: data.accountId,
      flagType: data.flagType,
      source: data.source,
      dueAt: data.dueAt ? new Date(data.dueAt) : null,
      appGeneratedReasonSnapshot: data.appGeneratedReasonSnapshot,
      userConfirmed: data.userConfirmed,
    });
    res.status(201).json(flag);
  } catch (err) {
    logger.error(err, "[flags POST /]");
    res.status(500).json({ error: "Failed to create flag" });
  }
});

router.patch("/:id/resolve", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const parsed = resolveFlagSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
    const updated = await resolveFlag(id, req.userId, parsed.data);
    if (!updated) { res.status(404).json({ error: "Flag not found" }); return; }
    res.json(updated);
  } catch (err) {
    logger.error(err, "[flags PATCH /:id/resolve]");
    res.status(500).json({ error: "Failed to resolve flag" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await deleteFlag(Number(req.params.id), req.userId);
    res.status(204).send();
  } catch (err) {
    logger.error(err, "[flags DELETE /:id]");
    res.status(500).json({ error: "Failed to delete flag" });
  }
});

export default router;
