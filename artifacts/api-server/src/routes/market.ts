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

function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(closes.length - period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

// 7-criterion Minervini Trend Template
function minerviniCriteria(closes: number[], price: number, high52w: number, low52w: number) {
  const sma50 = sma(closes, 50);
  const sma150 = sma(closes, 150);
  const sma200 = sma(closes, 200);
  // 200 SMA 20 bars ago (approx 1 month)
  const sma200_20ago = closes.length >= 220 ? sma(closes.slice(0, closes.length - 20), 200) : null;

  const criteria = [
    {
      label: "Price > 200 SMA",
      pass: sma200 != null && price > sma200,
    },
    {
      label: "200 SMA trending up (1 month)",
      pass: sma200 != null && sma200_20ago != null && sma200 > sma200_20ago,
    },
    {
      label: "150 SMA > 200 SMA",
      pass: sma150 != null && sma200 != null && sma150 > sma200,
    },
    {
      label: "50 SMA > 150 SMA",
      pass: sma50 != null && sma150 != null && sma50 > sma150,
    },
    {
      label: "Price > 50 SMA",
      pass: sma50 != null && price > sma50,
    },
    {
      label: "Within 25% of 52W high",
      pass: high52w > 0 && price >= high52w * 0.75,
    },
    {
      label: "30%+ above 52W low",
      pass: low52w > 0 && price >= low52w * 1.30,
    },
  ];

  const score = criteria.filter(c => c.pass).length;
  return { criteria, score, sma50, sma150, sma200 };
}

router.get("/screener", async (req, res) => {
  try {
    const minPrice = req.query.minPrice ? parseFloat(req.query.minPrice as string) : 5;
    const maxPrice = req.query.maxPrice ? parseFloat(req.query.maxPrice as string) : 2000;
    const extraSymbols = req.query.symbols
      ? (req.query.symbols as string).split(",").map(s => s.trim().toUpperCase()).filter(Boolean)
      : [];

    const baseUniverse = [
      "AAPL","MSFT","NVDA","AMZN","META","GOOGL","TSLA","AMD","NFLX","CRM",
      "PLTR","SOFI","UPST","AFRM","RKLB","HIMS","APP","AXON","DDOG","CRWD",
      "NET","MNDY","TTD","SNOW","ZS","BILL","DUOL","MELI","NU","SE",
      "SMCI","ARM","HOOD","COIN","MSTR","RBLX","U","SHOP","GTLB","BASE",
    ];

    const allPositions = await db.select({ symbol: positionsTable.symbol, quantity: positionsTable.quantity })
      .from(positionsTable);
    const ownedSymbols = new Set(
      allPositions.filter(p => parseFloat(p.quantity) > 0).map(p => p.symbol.toUpperCase())
    );
    const ownedList = [...ownedSymbols].filter(s => !CRYPTO_SYMBOLS.has(s));

    const screenSymbols = [...new Set([...baseUniverse, ...ownedList, ...extraSymbols])];

    const results = await Promise.allSettled(
      screenSymbols.map(async (symbol) => {
        const url = `${YAHOO_BASE}/v8/finance/chart/${symbol}?interval=1d&range=1y`;
        const data = await fetchYahoo(url);
        const result = data?.chart?.result?.[0];
        if (!result) return null;
        const meta = result.meta;
        const price = meta.regularMarketPrice || 0;
        if (price < minPrice || price > maxPrice) return null;

        const previousClose = meta.previousClose || meta.chartPreviousClose || price;
        const changePercent = previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0;
        const volume = meta.regularMarketVolume || 0;

        const rawCloses: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
        const closes = rawCloses.filter((c): c is number => typeof c === "number" && c > 0);
        const volumes: number[] = (result.indicators?.quote?.[0]?.volume || []).filter(Boolean);

        const avgVolume = volumes.length > 0 ? volumes.reduce((a: number, b: number) => a + b, 0) / volumes.length : 0;
        const relativeVolume = avgVolume > 0 ? volume / avgVolume : 1;

        const high52w = meta.fiftyTwoWeekHigh || Math.max(...closes);
        const low52w = meta.fiftyTwoWeekLow || Math.min(...closes);

        const { criteria, score, sma50, sma150, sma200 } = minerviniCriteria(closes, price, high52w, low52w);

        return {
          symbol: meta.symbol || symbol,
          name: meta.shortName || meta.longName || symbol,
          price,
          changePercent: Math.round(changePercent * 100) / 100,
          volume,
          avgVolume: Math.round(avgVolume),
          relativeVolume: Math.round(relativeVolume * 100) / 100,
          high52w,
          low52w,
          sma50: sma50 ? Math.round(sma50 * 100) / 100 : null,
          sma150: sma150 ? Math.round(sma150 * 100) / 100 : null,
          sma200: sma200 ? Math.round(sma200 * 100) / 100 : null,
          minerviniScore: score,
          minerviniCriteria: criteria,
          alreadyOwned: ownedSymbols.has((meta.symbol || symbol).toUpperCase()),
        };
      })
    );

    const stocks = (results as any[])
      .filter(r => r.status === "fulfilled" && r.value !== null)
      .map(r => r.value)
      .sort((a: any, b: any) => (b.minerviniScore ?? 0) - (a.minerviniScore ?? 0));

    res.json(stocks);
  } catch (error) {
    console.error("[market/screener]", error);
    res.status(500).json({ error: "Failed to screen stocks" });
  }
});

export default router;
