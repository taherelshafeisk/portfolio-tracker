import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { positionsTable } from "@workspace/db";

const router: IRouter = Router();

const YAHOO_BASE = "https://query1.finance.yahoo.com";

// Keep in sync with routes/positions.ts
const CRYPTO_SYMBOLS = new Set([
  "BTC", "ETH", "SOL", "ADA", "XRP", "DOGE", "AVAX", "DOT", "MATIC",
  "LINK", "UNI", "ATOM", "LTC", "BCH", "XLM", "ALGO", "VET", "FIL",
  "TRX", "SHIB", "BNB", "NEAR", "FTM", "SAND", "MANA", "THETA", "HBAR",
  "ICP", "ETC", "FLOW", "CHZ", "APE", "CRO", "GRT", "ENJ", "BAT",
  "ZEC", "DASH", "NEO", "EOS", "PEPE", "WIF", "BONK", "ARB", "OP",
  "SUI", "APT", "INJ", "TIA", "SEI", "RUNE", "CRV", "AAVE", "COMP",
  "MKR", "SNX", "YFI", "SUSHI", "ZRX",
]);
const SYMBOL_OVERRIDES: Record<string, string> = {
  "GOLD": "GC=F",
  "XAU": "GC=F",
  "SILVER": "SI=F",
  "XAG": "SI=F",
};

function toYahooSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (SYMBOL_OVERRIDES[upper]) return SYMBOL_OVERRIDES[upper];
  if (!upper.includes("-") && !upper.includes(".") && CRYPTO_SYMBOLS.has(upper)) {
    return `${upper}-USD`;
  }
  return upper;
}

async function fetchYahoo(url: string) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });
  if (!res.ok) throw new Error(`Yahoo Finance error: ${res.status}`);
  return res.json();
}

router.get("/search", async (req, res) => {
  try {
    const q = (req.query.q as string) || "";
    if (!q.trim()) return res.json([]);
    const url = `${YAHOO_BASE}/v1/finance/search?q=${encodeURIComponent(q)}&lang=en-US&region=US&quotesCount=6&newsCount=0&listsCount=0`;
    const data = await fetchYahoo(url);
    const quotes = (data?.quotes || []).filter(
      (item: any) => item.quoteType === "EQUITY" || item.quoteType === "ETF" || item.quoteType === "INDEX"
    );
    res.json(quotes.slice(0, 6).map((item: any) => ({
      symbol: item.symbol,
      name: item.shortname || item.longname || item.symbol,
      type: item.quoteType,
      exchange: item.exchDisp || item.exchange,
    })));
  } catch (error) {
    res.status(500).json({ error: "Search failed" });
  }
});

router.get("/quote/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const yahooSymbol = toYahooSymbol(symbol);
    const url = `${YAHOO_BASE}/v8/finance/chart/${yahooSymbol}?interval=1d&range=5d`;
    const data = await fetchYahoo(url);
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: "Symbol not found" });
    const meta = result.meta;
    const regularMarketPrice = meta.regularMarketPrice || 0;
    const marketState: string = meta?.marketState ?? "CLOSED";
    const rawCloses: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const closes = rawCloses.filter((c): c is number => typeof c === "number" && c > 0);
    let tail = closes.length;
    while (tail > 1 && closes[tail - 1] === closes[tail - 2]) tail--;
    const deduped = closes.slice(0, tail);
    let previousClose = regularMarketPrice;
    let change = 0;
    let changePercent = 0;
    if (marketState === "REGULAR" && deduped.length >= 1) {
      previousClose = deduped[deduped.length - 1];
      change = regularMarketPrice - previousClose;
      changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;
    } else if (deduped.length >= 2) {
      previousClose = deduped[deduped.length - 2];
      const lastClose = deduped[deduped.length - 1];
      change = lastClose - previousClose;
      changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;
    }
    res.json({
      symbol: meta.symbol,
      name: meta.shortName || meta.longName || symbol,
      price: regularMarketPrice,
      change,
      changePercent,
      volume: meta.regularMarketVolume || 0,
      marketCap: meta.marketCap || undefined,
      high52w: meta.fiftyTwoWeekHigh || undefined,
      low52w: meta.fiftyTwoWeekLow || undefined,
      peRatio: undefined,
      previousClose,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch quote" });
  }
});

router.get("/chart/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const yahooSymbol = toYahooSymbol(symbol);
    const interval = (req.query.interval as string) || "1d";
    const range = (req.query.range as string) || "1mo";
    const url = `${YAHOO_BASE}/v8/finance/chart/${yahooSymbol}?interval=${interval}&range=${range}`;
    const data = await fetchYahoo(url);
    const result = data?.chart?.result?.[0];
    if (!result) return res.status(404).json({ error: "Symbol not found" });
    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    res.json({
      symbol,
      interval,
      range,
      timestamps,
      opens: quote.open || [],
      highs: quote.high || [],
      lows: quote.low || [],
      closes: quote.close || [],
      volumes: quote.volume || [],
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch chart data" });
  }
});

router.get("/indices", async (_req, res) => {
  try {
    const symbols = ["^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX"];
    const results = await Promise.allSettled(
      symbols.map(async (symbol) => {
        const url = `${YAHOO_BASE}/v8/finance/chart/${symbol}?interval=1d&range=5d`;
        const data = await fetchYahoo(url);
        const result = data?.chart?.result?.[0];
        if (!result) return null;
        const meta = result.meta;
        const regularMarketPrice = meta.regularMarketPrice || 0;
        const marketState: string = meta?.marketState ?? "CLOSED";

        // Derive prior-session close from the OHLCV close array — same logic as
        // positions.ts fetchLivePrice. meta.previousClose is null on the chart
        // endpoint; meta.chartPreviousClose is the range-start close (5d ago).
        const rawCloses: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
        const closes = rawCloses.filter((c): c is number => typeof c === "number" && c > 0);
        // Yahoo duplicates the last close when market is closed — strip trailing dupes
        let tail = closes.length;
        while (tail > 1 && closes[tail - 1] === closes[tail - 2]) tail--;
        const deduped = closes.slice(0, tail);

        let previousClose = regularMarketPrice;
        let change = 0;
        let changePercent = 0;

        if (marketState === "REGULAR" && deduped.length >= 1) {
          previousClose = deduped[deduped.length - 1];
          change = regularMarketPrice - previousClose;
          changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;
        } else if (deduped.length >= 2) {
          previousClose = deduped[deduped.length - 2];
          const lastClose = deduped[deduped.length - 1];
          change = lastClose - previousClose;
          changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;
        }

        return {
          symbol: meta.symbol,
          name: meta.shortName || meta.longName || symbol,
          price: regularMarketPrice,
          change,
          changePercent,
          volume: meta.regularMarketVolume || 0,
          previousClose,
        };
      })
    );
    const indices = results
      .filter((r): r is PromiseFulfilledResult<typeof r extends PromiseFulfilledResult<infer T> ? T : never> => r.status === "fulfilled" && r.value !== null)
      .map(r => r.value);
    res.json(indices);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch indices" });
  }
});

router.get("/screener", async (req, res) => {
  try {
    const minPrice = req.query.minPrice ? parseFloat(req.query.minPrice as string) : 5;
    const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice as string) : 500;
    // Fetch popular stocks for swing screening
    const screenSymbols = [
      "AAPL","MSFT","NVDA","AMZN","META","GOOGL","TSLA","AMD","NFLX","CRM",
      "PLTR","SOFI","RIOT","MARA","COIN","SHOP","SNAP","PINS","RBLX","U",
      "ARKK","SPY","QQQ","IWM","XLF","XLV","XLE","XLK","XLY","XLC"
    ];
    // FIX 4: query all active positions upfront so we can flag alreadyOwned per result
    const allPositions = await db.select({ symbol: positionsTable.symbol, quantity: positionsTable.quantity })
      .from(positionsTable);
    const ownedSymbols = new Set(
      allPositions
        .filter(p => parseFloat(p.quantity) > 0)
        .map(p => p.symbol.toUpperCase())
    );

    const results = await Promise.allSettled(
      screenSymbols.map(async (symbol) => {
        // FIX 1: fetch 3 months so Wilder's EMA has enough bars to stabilise
        const url = `${YAHOO_BASE}/v8/finance/chart/${symbol}?interval=1d&range=3mo`;
        const data = await fetchYahoo(url);
        const result = data?.chart?.result?.[0];
        if (!result) return null;
        const meta = result.meta;
        const price = meta.regularMarketPrice || 0;
        if (price < minPrice || price > maxPrice) return null;
        const previousClose = meta.previousClose || meta.chartPreviousClose || price;
        const change = price - previousClose;
        const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;
        const volume = meta.regularMarketVolume || 0;
        // Calculate relative volume
        const closes: number[] = (result.indicators?.quote?.[0]?.close || []).filter(Boolean);
        const volumes: number[] = (result.indicators?.quote?.[0]?.volume || []).filter(Boolean);
        const avgVolume = volumes.length > 0 ? volumes.reduce((a: number, b: number) => a + b, 0) / volumes.length : 0;
        const relativeVolume = avgVolume > 0 ? volume / avgVolume : 1;

        // FIX 1: Wilder's smoothed RSI(14) — seed on first 14 periods, then EMA
        let rsi = 50;
        if (closes.length >= 15) {
          let avgGain = 0;
          let avgLoss = 0;
          // Seed: simple average of first 14 price changes
          for (let i = 1; i <= 14; i++) {
            const diff = closes[i] - closes[i - 1];
            if (diff > 0) avgGain += diff;
            else avgLoss += Math.abs(diff);
          }
          avgGain /= 14;
          avgLoss /= 14;
          // Smooth remaining periods with Wilder's EMA
          for (let i = 15; i < closes.length; i++) {
            const diff = closes[i] - closes[i - 1];
            const gain = diff > 0 ? diff : 0;
            const loss = diff < 0 ? Math.abs(diff) : 0;
            avgGain = (avgGain * 13 + gain) / 14;
            avgLoss = (avgLoss * 13 + loss) / 14;
          }
          const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
          rsi = 100 - (100 / (1 + rs));
        }

        // FIX 3: RSI scoring — trending zone earns full points, pullback partial, extended/oversold zero
        let rsiScore: number;
        if (rsi >= 50 && rsi <= 70) rsiScore = 40;
        else if (rsi >= 40 && rsi < 50) rsiScore = 25;
        else if (rsi > 70 && rsi <= 80) rsiScore = 15;
        else rsiScore = 0; // < 40 or > 80

        // FIX 2: direction-aware price move scoring — breakouts rewarded, distribution penalised
        let priceScore: number;
        if (changePercent >= 1 && changePercent <= 5) priceScore = 30;
        else if (changePercent > 5 && changePercent <= 10) priceScore = 20;
        else if (changePercent < 0 && changePercent >= -3 && relativeVolume < 1.2) priceScore = 20;
        else if (changePercent < -3 || (changePercent < 0 && relativeVolume > 1.5)) priceScore = 0;
        else priceScore = 10;

        const swingScore = Math.min(100,
          (relativeVolume > 1.5 ? 30 : relativeVolume * 20) +
          rsiScore +
          priceScore
        );

        return {
          symbol: meta.symbol,
          name: meta.shortName || meta.longName || symbol,
          price,
          changePercent,
          volume,
          avgVolume: Math.round(avgVolume),
          relativeVolume: Math.round(relativeVolume * 100) / 100,
          marketCap: meta.marketCap || undefined,
          rsi: Math.round(rsi * 10) / 10,
          swingScore: Math.round(swingScore),
          // FIX 4: flag symbols already held in any sleeve with qty > 0
          alreadyOwned: ownedSymbols.has((meta.symbol || symbol).toUpperCase()),
        };
      })
    );
    const stocks = results
      .filter((r): r is PromiseFulfilledResult<NonNullable<typeof r extends PromiseFulfilledResult<infer T> ? T : never>> =>
        r.status === "fulfilled" && r.value !== null)
      .map(r => r.value)
      .sort((a, b) => (b?.swingScore || 0) - (a?.swingScore || 0));
    res.json(stocks);
  } catch (error) {
    res.status(500).json({ error: "Failed to screen stocks" });
  }
});

export default router;
