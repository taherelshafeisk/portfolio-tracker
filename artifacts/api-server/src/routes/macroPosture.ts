import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { macroPostureTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const VALID_LABELS = [
  "bull",
  "late-cycle",
  "distribution",
  "stagflation",
  "war-escalation",
  "recession",
  "neutral",
] as const;

type ValidLabel = (typeof VALID_LABELS)[number];

// ── GET /macro-posture ────────────────────────────────────────────────────────

router.get("/", async (_req, res) => {
  try {
    const [row] = await db
      .select()
      .from(macroPostureTable)
      .where(eq(macroPostureTable.isActive, true))
      .limit(1);

    if (!row) {
      return res.json({ label: null, notes: null, cryptoView: null, setAt: null });
    }

    return res.json({
      id: row.id,
      label: row.label,
      notes: row.notes,
      cryptoView: row.cryptoView,
      isActive: row.isActive,
      setAt: row.setAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("[macro-posture GET] error:", err);
    return res.status(500).json({ error: "Failed to fetch macro posture" });
  }
});

// ── POST /macro-posture ───────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  try {
    const { label, notes, cryptoView } = req.body as {
      label: string;
      notes?: string;
      cryptoView?: string;
    };

    if (!VALID_LABELS.includes(label as ValidLabel)) {
      return res.status(400).json({
        error: `Invalid label. Must be one of: ${VALID_LABELS.join(", ")}`,
      });
    }

    const now = new Date();

    await db
      .update(macroPostureTable)
      .set({ isActive: false, supersededAt: now })
      .where(eq(macroPostureTable.isActive, true));

    const [newRow] = await db
      .insert(macroPostureTable)
      .values({
        label,
        notes: notes ?? null,
        cryptoView: cryptoView ?? null,
        isActive: true,
        setAt: now,
      })
      .returning();

    return res.json({
      id: newRow.id,
      label: newRow.label,
      notes: newRow.notes,
      cryptoView: newRow.cryptoView,
      isActive: newRow.isActive,
      setAt: newRow.setAt.toISOString(),
      createdAt: newRow.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("[macro-posture POST] error:", err);
    return res.status(500).json({ error: "Failed to set macro posture" });
  }
});

export default router;
