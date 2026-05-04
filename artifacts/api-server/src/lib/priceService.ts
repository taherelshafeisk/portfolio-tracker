export const YAHOO_BASE = "https://query1.finance.yahoo.com";

export const CRYPTO_SYMBOLS = new Set([
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

export function toYahooSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (SYMBOL_OVERRIDES[upper]) return SYMBOL_OVERRIDES[upper];
  if (!upper.includes("-") && !upper.includes(".") && CRYPTO_SYMBOLS.has(upper)) {
    return `${upper}-USD`;
  }
  return symbol;
}

export interface LivePriceData {
  price: number;
  previousClose: number | null;
  changePercent: number | null;
}

const _priceCache = new Map<string, { data: LivePriceData; ts: number }>();
const CACHE_TTL_MS = 60_000;

export async function fetchLivePrice(symbol: string): Promise<LivePriceData | null> {
  try {
    const yahooSymbol = toYahooSymbol(symbol);
    const res = await fetch(
      `${YAHOO_BASE}/v8/finance/chart/${yahooSymbol}?interval=1d&range=5d`,
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }
    );
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = await res.json() as any;
    const meta = json?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    if (typeof price !== "number") return null;

    // Use OHLCV close array for reliable day-change in both open & closed market
    const closes: (number | null)[] = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const validCloses = closes.filter((c): c is number => typeof c === "number" && c > 0);
    const marketState: string = meta?.marketState ?? "CLOSED";

    // Yahoo duplicates the last close when market is closed — strip trailing dupes
    let tail = validCloses.length;
    while (tail > 1 && validCloses[tail - 1] === validCloses[tail - 2]) tail--;
    const dedupedCloses = validCloses.slice(0, tail);

    let changePercent: number | null = null;
    let previousClose: number | null = null;

    if (marketState === "REGULAR" && dedupedCloses.length >= 1) {
      previousClose = dedupedCloses[dedupedCloses.length - 1];
      changePercent = previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : null;
    } else if (dedupedCloses.length >= 2) {
      previousClose = dedupedCloses[dedupedCloses.length - 2];
      const lastClose = dedupedCloses[dedupedCloses.length - 1];
      changePercent = previousClose > 0 ? ((lastClose - previousClose) / previousClose) * 100 : null;
    }

    return { price, previousClose, changePercent };
  } catch {
    return null;
  }
}

export async function fetchLivePrices(symbols: string[]): Promise<Record<string, LivePriceData>> {
  const now = Date.now();
  const result: Record<string, LivePriceData> = {};
  const toFetch: string[] = [];

  for (const sym of [...new Set(symbols)]) {
    const cached = _priceCache.get(sym);
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      result[sym] = cached.data;
    } else {
      toFetch.push(sym);
    }
  }

  if (toFetch.length > 0) {
    const results = await Promise.allSettled(
      toFetch.map(async (sym) => ({ sym, data: await fetchLivePrice(sym) }))
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.data !== null) {
        _priceCache.set(r.value.sym, { data: r.value.data, ts: now });
        result[r.value.sym] = r.value.data;
      }
    }
  }

  return result;
}

/** Returns only prices already in the 60s in-memory cache. No HTTP calls, no side effects. */
export function getCachedPrices(symbols: string[]): Record<string, LivePriceData> {
  const now = Date.now();
  const result: Record<string, LivePriceData> = {};
  for (const sym of [...new Set(symbols)]) {
    const cached = _priceCache.get(sym);
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      result[sym] = cached.data;
    }
  }
  return result;
}
