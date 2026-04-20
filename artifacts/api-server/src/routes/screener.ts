import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { positionsTable } from "@workspace/db";
import { batchScreen, screenMinervini, clearCache } from "../lib/twelveData";

const router: IRouter = Router();

const DEFAULT_SYMBOLS = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AVGO", "TSM",
  "ORCL", "CRM", "AMD", "INTC", "QCOM", "TXN", "MU", "AMAT", "LRCX", "KLAC",
  "COST", "WMT", "HD", "LOW", "TGT", "NKE", "SBUX", "MCD", "DIS", "NFLX",
  "JPM", "BAC", "GS", "MS", "V", "MA", "PYPL", "SQ", "COIN",
  "XOM", "CVX", "COP", "SLB", "XLE",
  "LLY", "UNH", "JNJ", "PFE", "ABBV",
  "RKLB", "IONQ", "QBTS", "NBIS", "CRWD", "SNOW", "PLTR", "PANW",
];

router.get("/scan", async (req, res) => {
  try {
    let symbols: string[];

    if (req.query.symbols) {
      symbols = (req.query.symbols as string)
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else {
      const positions = await db
        .select({ symbol: positionsTable.symbol })
        .from(positionsTable);
      const positionSymbols = positions.map((p) => p.symbol.toUpperCase());
      const combined = new Set([...DEFAULT_SYMBOLS, ...positionSymbols]);
      symbols = Array.from(combined);
    }

    const results = await batchScreen(symbols);
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: "Screener scan failed" });
  }
});

router.get("/stock/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const result = await screenMinervini(symbol);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: `Failed to screen ${req.params.symbol}` });
  }
});

router.get("/cache/clear", (_req, res) => {
  clearCache();
  res.json({ ok: true, message: "Screener cache cleared" });
});

export default router;
