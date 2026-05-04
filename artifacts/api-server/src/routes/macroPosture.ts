import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";
import { getActiveMacroPosture, setMacroPosture } from "../services/macroPostureService";

const router: IRouter = Router();

const VALID_LABELS = [
  "bull", "late-cycle", "distribution", "stagflation",
  "war-escalation", "recession", "neutral",
] as const;

type ValidLabel = (typeof VALID_LABELS)[number];

router.get("/", async (req, res) => {
  try {
    const result = await getActiveMacroPosture(req.userId);
    if (!result) return res.json({ label: null, notes: null, cryptoView: null, recessionRisk: null, setAt: null });
    return res.json(result);
  } catch (err) {
    logger.error(err, "[macro-posture GET] error");
    return res.status(500).json({ error: "Failed to fetch macro posture" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { label, notes, cryptoView, recessionRisk } = req.body as {
      label: string;
      notes?: string;
      cryptoView?: string;
      recessionRisk?: number;
    };

    if (!VALID_LABELS.includes(label as ValidLabel)) {
      return res.status(400).json({ error: `Invalid label. Must be one of: ${VALID_LABELS.join(", ")}` });
    }

    if (recessionRisk != null && (recessionRisk < 0 || recessionRisk > 100)) {
      return res.status(400).json({ error: "recessionRisk must be 0–100" });
    }

    const result = await setMacroPosture(req.userId, { label, notes, cryptoView, recessionRisk });
    return res.json(result);
  } catch (err) {
    logger.error(err, "[macro-posture POST] error");
    return res.status(500).json({ error: "Failed to set macro posture" });
  }
});

export default router;
