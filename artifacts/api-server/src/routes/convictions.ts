import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { logger } from "../lib/logger";
import {
  createConviction,
  runConvictionPipeline,
  listConvictions,
  getConvictionStatus,
  getConviction,
  approveConviction,
  rejectConviction,
  deleteAttachment,
} from "../services/convictionService";

const router: IRouter = Router();

// ─── Storage setup ─────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(process.cwd(), "uploads", "convictions");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are accepted"));
    }
  },
});

// ─── Routes ─────────────────────────────────────────────────────────────────

router.post("/", upload.array("screenshots"), async (req: Request, res: Response) => {
  try {
    const { source_type, source_url, source_name, raw_note, tickers: tickersRaw, themes: themesRaw } =
      req.body as Record<string, string>;

    if (!source_type) {
      res.status(400).json({ error: "source_type is required" });
      return;
    }

    const files = (req.files ?? []) as Express.Multer.File[];

    let tickers: string[] = [];
    let themes: string[] = [];
    try { tickers = tickersRaw ? (JSON.parse(tickersRaw) as string[]) : []; } catch { tickers = []; }
    try { themes = themesRaw ? (JSON.parse(themesRaw) as string[]) : []; } catch { themes = []; }

    const result = await createConviction(
      { sourceType: source_type, sourceUrl: source_url, sourceName: source_name, rawNote: raw_note, tickers, themes, userId: req.userId },
      files.map(f => ({ filename: f.filename, mimetype: f.mimetype })),
    );

    if (!result) {
      res.status(500).json({ error: "Failed to create conviction" });
      return;
    }

    res.status(201).json(result);

    setImmediate(() => {
      runConvictionPipeline(result.id, source_url).catch((err) => {
        logger.error(err, "[convictions] async processing error");
      });
    });
  } catch (err) {
    logger.error(err, "[convictions] POST error");
    res.status(500).json({ error: "Failed to create conviction" });
  }
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const { proposal_status, ticker } = req.query as Record<string, string>;
    const results = await listConvictions(req.userId, { proposalStatus: proposal_status, ticker });
    res.json(results);
  } catch (err) {
    logger.error(err, "[convictions] GET / error");
    res.status(500).json({ error: "Failed to fetch convictions" });
  }
});

router.get("/:id/status", async (req: Request, res: Response) => {
  try {
    const result = await getConvictionStatus(req.params.id as string, req.userId);
    if (!result) { res.status(404).json({ error: "Conviction not found" }); return; }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch status" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const result = await getConviction(req.params.id as string, req.userId);
    if (!result) { res.status(404).json({ error: "Conviction not found" }); return; }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch conviction" });
  }
});

router.patch("/:id/approve", async (req: Request, res: Response) => {
  try {
    const result = await approveConviction(req.params.id as string, req.userId);
    if ("notFound" in result) { res.status(404).json({ error: "Conviction not found" }); return; }
    if ("badStatus" in result) { res.status(400).json({ error: "Only PENDING_REVIEW convictions can be approved" }); return; }
    res.json(result);
  } catch (err) {
    logger.error(err, "[convictions] PATCH /:id/approve error");
    res.status(500).json({ error: "Failed to approve conviction" });
  }
});

router.patch("/:id/reject", async (req: Request, res: Response) => {
  try {
    const { rejection_reason } = req.body as { rejection_reason?: string };
    const result = await rejectConviction(req.params.id as string, req.userId, rejection_reason);
    if (!result) { res.status(404).json({ error: "Conviction not found" }); return; }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to reject conviction" });
  }
});

router.delete("/:id/attachments/:attachmentId", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const attachmentId = req.params.attachmentId as string;
    const result = await deleteAttachment(id, attachmentId, req.userId);
    if ("notFound" in result) {
      res.status(404).json({ error: result.notFound === "conviction" ? "Conviction not found" : "Attachment not found" });
      return;
    }
    if ("badStatus" in result) {
      res.status(400).json({ error: "Attachments can only be removed from PROCESSING or PENDING_REVIEW convictions" });
      return;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Failed to delete attachment" });
  }
});

export default router;
