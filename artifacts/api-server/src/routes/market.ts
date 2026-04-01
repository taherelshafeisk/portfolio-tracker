import { Router, type IRouter } from "express";

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
    const results = await Promise.allSettled(
      screenSymbols.map(async (symbol) => {
        const url = `${YAHOO_BASE}/v8/finance/chart/${symbol}?interval=1d&range=1mo`;
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
        // Calculate relative volume and swing score
        const closes = result.indicators?.quote?.[0]?.close?.filter(Boolean) || [];
        const volumes = result.indicators?.quote?.[0]?.volume?.filter(Boolean) || [];
        const avgVolume = volumes.length > 0 ? volumes.reduce((a: number, b: number) => a + b, 0) / volumes.length : 0;
        const relativeVolume = avgVolume > 0 ? volume / avgVolume : 1;
        // Simple RSI approximation using last 14 closes
        let rsi = 50;
        if (closes.length >= 15) {
          const recentCloses = closes.slice(-15);
          let gains = 0, losses = 0;
          for (let i = 1; i < recentCloses.length; i++) {
            const diff = recentCloses[i] - recentCloses[i-1];
            if (diff > 0) gains += diff;
            else losses += Math.abs(diff);
          }
          const avgGain = gains / 14;
          const avgLoss = losses / 14;
          const rs = avgLoss > 0 ? avgGain / avgLoss : 100;
          rsi = 100 - (100 / (1 + rs));
        }
        // Swing score: high volume, RSI between 40-60 (momentum without overbought)
        const swingScore = Math.min(100,
          (relativeVolume > 1.5 ? 30 : relativeVolume * 20) +
          (rsi >= 40 && rsi <= 65 ? 40 : Math.max(0, 40 - Math.abs(rsi - 52) * 2)) +
          (Math.abs(changePercent) > 1 && Math.abs(changePercent) < 10 ? 30 : 15)
        );
        return {
          symbol: meta.symbol,
          name: meta.shortName || meta.longName || symbol,
          price,
          changePercent,
          volume,
          avgVolume: Math.round(avgVolume),
          relativeVolume: Math.round(relativeVolume * 100) / 100,
          sector: undefined,
          marketCap: meta.marketCap || undefined,
          rsi: Math.round(rsi * 10) / 10,
          swingScore: Math.round(swingScore),
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
