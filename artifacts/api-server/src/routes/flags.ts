import { Router, type IRouter } from "express";
import { db, positionFlagsTable } from "@workspace/db";
import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { z } from "@workspace/api-zod/schemas";

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
    const conditions = [eq(positionFlagsTable.userId, req.userId)];
    if (accountId) conditions.push(eq(positionFlagsTable.accountId, Number(accountId)));
    if (positionId) conditions.push(eq(positionFlagsTable.positionId, Number(positionId)));
    if (resolved === "false") conditions.push(isNull(positionFlagsTable.resolvedAt));
    else if (resolved === "true") conditions.push(isNotNull(positionFlagsTable.resolvedAt));

    const flags = await db.select().from(positionFlagsTable).where(and(...conditions));
    res.json(flags);
  } catch (err) {
    console.error("[flags GET /]", err);
    res.status(500).json({ error: "Failed to fetch flags" });
  }
});

router.post("/", async (req, res) => {
  try {
    const parsed = createFlagSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
    const data = parsed.data;
    const [flag] = await db.insert(positionFlagsTable).values({
      positionId: data.positionId ?? null,
      accountId: data.accountId,
      flagType: data.flagType,
      source: data.source,
      dueAt: data.dueAt ? new Date(data.dueAt) : null,
      appGeneratedReasonSnapshot: data.appGeneratedReasonSnapshot ?? null,
      userConfirmed: data.userConfirmed,
      userId: req.userId,
    }).returning();
    res.status(201).json(flag);
  } catch (err) {
    console.error("[flags POST /]", err);
    res.status(500).json({ error: "Failed to create flag" });
  }
});

router.patch("/:id/resolve", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const parsed = resolveFlagSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
    const { resolutionType, resolutionNote } = parsed.data;
    const [updated] = await db.update(positionFlagsTable)
      .set({ resolvedAt: new Date(), resolutionType, resolutionNote: resolutionNote ?? null })
      .where(and(eq(positionFlagsTable.id, id), eq(positionFlagsTable.userId, req.userId)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Flag not found" }); return; }
    res.json(updated);
  } catch (err) {
    console.error("[flags PATCH /:id/resolve]", err);
    res.status(500).json({ error: "Failed to resolve flag" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.delete(positionFlagsTable)
      .where(and(eq(positionFlagsTable.id, id), eq(positionFlagsTable.userId, req.userId)));
    res.status(204).send();
  } catch (err) {
    console.error("[flags DELETE /:id]", err);
    res.status(500).json({ error: "Failed to delete flag" });
  }
});

export default router;
