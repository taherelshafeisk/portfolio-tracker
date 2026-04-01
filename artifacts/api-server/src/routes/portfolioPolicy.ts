import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { portfolioPolicyTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const POLICY_ID = 1;

function toPolicyResponse(row: typeof portfolioPolicyTable.$inferSelect) {
  return {
    id: row.id,
    goldFloorPct: row.goldFloorPct != null ? parseFloat(row.goldFloorPct) : null,
    goldTargetPct: row.goldTargetPct != null ? parseFloat(row.goldTargetPct) : null,
    goldTargetDate: row.goldTargetDate ?? null,
    monthlyContribution: row.monthlyContribution != null ? parseFloat(row.monthlyContribution) : null,
    macroPosture: row.macroPosture ?? null,
    ipsVersion: row.ipsVersion ?? null,
    ipsDate: row.ipsDate ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** GET /portfolio-policy — returns the policy row or {} if none exists yet */
router.get("/", async (_req, res) => {
  try {
    const [row] = await db.select().from(portfolioPolicyTable).where(eq(portfolioPolicyTable.id, POLICY_ID));
    if (!row) return res.json({});
    res.json(toPolicyResponse(row));
  } catch (error) {
    console.error("[portfolio-policy GET /] Error:", error);
    res.status(500).json({ error: "Failed to fetch portfolio policy" });
  }
});

/** PUT /portfolio-policy — upsert by id=1 */
router.put("/", async (req, res) => {
  try {
    const {
      goldFloorPct, goldTargetPct, goldTargetDate,
      monthlyContribution, macroPosture, ipsVersion, ipsDate,
    } = req.body as Record<string, unknown>;

    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (goldFloorPct !== undefined) values.goldFloorPct = goldFloorPct != null ? String(goldFloorPct) : null;
    if (goldTargetPct !== undefined) values.goldTargetPct = goldTargetPct != null ? String(goldTargetPct) : null;
    if (goldTargetDate !== undefined) values.goldTargetDate = goldTargetDate || null;
    if (monthlyContribution !== undefined) values.monthlyContribution = monthlyContribution != null ? String(monthlyContribution) : null;
    if (macroPosture !== undefined) values.macroPosture = macroPosture || null;
    if (ipsVersion !== undefined) values.ipsVersion = ipsVersion || null;
    if (ipsDate !== undefined) values.ipsDate = ipsDate || null;

    // Try update first; if nothing was updated, insert
    const updated = await db.update(portfolioPolicyTable)
      .set(values)
      .where(eq(portfolioPolicyTable.id, POLICY_ID))
      .returning();

    if (updated.length > 0) {
      return res.json(toPolicyResponse(updated[0]));
    }

    // First-time creation
    const [created] = await db.insert(portfolioPolicyTable)
      .values({ id: POLICY_ID as any, ...values })
      .returning();
    res.json(toPolicyResponse(created));
  } catch (error) {
    console.error("[portfolio-policy PUT /] Error:", error);
    res.status(500).json({ error: "Failed to update portfolio policy" });
  }
});

export default router;
