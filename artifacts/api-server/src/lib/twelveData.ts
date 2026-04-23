import { logger } from "./logger";

const BASE_URL = "https://api.twelvedata.com";

export interface StockIndicators {
  symbol: string;
  price: number;
  rsi14: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  ema50: number;
  ema150: number;
  ema200: number;
  fetchedAt: string;
}

export interface MinerviniResult {
  symbol: string;
  price: number;
  isStage2: boolean;
  criteria: {
    priceAbove150: boolean;
    priceAbove200: boolean;
    ema150Above200: boolean;
    priceAboveEma50: boolean;
    rsiHealthy: boolean;
  };
  indicators: StockIndicators;
  fetchedAt: string;
}

const cache = new Map<string, { result: MinerviniResult; cachedAt: number }>();
const CACHE_TTL = 3_600_000;

export function clearCache(): void {
  cache.clear();
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function tdFetch(path: string): Promise<any> {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE_URL}${path}${sep}apikey=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status} for ${path}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Primary: POST /complex_data — 1 call for all indicators + 1 GET for prices
async function fetchComplexData(symbols: string[]): Promise<Map<string, StockIndicators>> {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  const url = `${BASE_URL}/complex_data?apikey=${apiKey}`;

  const body = {
    symbols,
    intervals: ["1day"],
    indicators: [
      { indicator: "rsi", parameters: { time_period: 14 } },
      { indicator: "macd", parameters: { fast_period: 12, slow_period: 26, signal_period: 9 } },
      { indicator: "ema", parameters: { time_period: 50 } },
      { indicator: "ema", parameters: { time_period: 150 } },
      { indicator: "ema", parameters: { time_period: 200 } },
    ],
    outputsize: 1,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let json: any;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`complex_data HTTP ${res.status}`);
    json = await res.json();
  } finally {
    clearTimeout(timer);
  }

  if (json?.status !== "ok") {
    throw new Error(`complex_data error: ${json?.message ?? json?.status}`);
  }

  const priceJson = await tdFetch(`/price?symbol=${symbols.join(",")}`);
  // Single-symbol /price returns { price: "..." }; multi returns { SYMBOL: { price: "..." } }
  const priceBySymbol: Record<string, any> =
    symbols.length === 1 ? { [symbols[0].toUpperCase()]: priceJson } : priceJson;

  const result = new Map<string, StockIndicators>();
  const entries: any[] = Array.isArray(json?.data) ? json.data : [];
  const fetchedAt = new Date().toISOString();

  for (const entry of entries) {
    try {
      const symbol = entry?.meta?.symbol?.toUpperCase();
      if (!symbol) continue;

      const values = entry?.values?.[0];
      if (!values) continue;

      const price = parseFloat(priceBySymbol[symbol]?.price ?? "NaN");
      const rsi14 = parseFloat(values.rsi ?? "NaN");
      const macd = parseFloat(values.macd ?? "NaN");
      const macdSignal = parseFloat(values.macd_signal ?? "NaN");
      const macdHist = parseFloat(values.macd_hist ?? "NaN");
      // When multiple EMAs are requested, complex_data may key them as ema(50)/ema(150)/ema(200)
      // or suffix with _2/_3. Try both patterns.
      const ema50 = parseFloat(values["ema(50)"] ?? values.ema ?? values.ema_1 ?? "NaN");
      const ema150 = parseFloat(values["ema(150)"] ?? values.ema_2 ?? "NaN");
      const ema200 = parseFloat(values["ema(200)"] ?? values.ema_3 ?? "NaN");

      if ([price, rsi14, macd, macdSignal, macdHist, ema50, ema150, ema200].some(isNaN)) {
        throw new Error(`NaN in parsed values`);
      }

      result.set(symbol, { symbol, price, rsi14, macd, macdSignal, macdHist, ema50, ema150, ema200, fetchedAt });
    } catch (err) {
      logger.warn({ symbol: entry?.meta?.symbol, err }, "complex_data: skipping symbol");
    }
  }

  if (result.size === 0) throw new Error("complex_data: no symbols parsed successfully");
  return result;
}

// Fallback: 6 batch GETs (one per indicator type), each with all symbols comma-separated
async function fetchPerIndicator(symbols: string[]): Promise<Map<string, StockIndicators>> {
  const s = symbols.join(",");
  const isSingle = symbols.length === 1;

  const [rsiData, macdData, ema50Data, ema150Data, ema200Data, priceData] = await Promise.all([
    tdFetch(`/rsi?symbol=${s}&interval=1day&time_period=14&outputsize=1`),
    tdFetch(`/macd?symbol=${s}&interval=1day&fast_period=12&slow_period=26&signal_period=9&outputsize=1`),
    tdFetch(`/ema?symbol=${s}&interval=1day&time_period=50&outputsize=1`),
    tdFetch(`/ema?symbol=${s}&interval=1day&time_period=150&outputsize=1`),
    tdFetch(`/ema?symbol=${s}&interval=1day&time_period=200&outputsize=1`),
    tdFetch(`/price?symbol=${s}`),
  ]);

  const result = new Map<string, StockIndicators>();
  const fetchedAt = new Date().toISOString();

  for (const sym of symbols) {
    try {
      const key = sym.toUpperCase();
      const rsiEntry   = isSingle ? rsiData   : rsiData[key];
      const macdEntry  = isSingle ? macdData  : macdData[key];
      const e50Entry   = isSingle ? ema50Data  : ema50Data[key];
      const e150Entry  = isSingle ? ema150Data : ema150Data[key];
      const e200Entry  = isSingle ? ema200Data : ema200Data[key];
      const priceEntry = isSingle ? priceData  : priceData[key];

      const price      = parseFloat(priceEntry?.price ?? "NaN");
      const rsi14      = parseFloat(rsiEntry?.values?.[0]?.rsi ?? "NaN");
      const macd       = parseFloat(macdEntry?.values?.[0]?.macd ?? "NaN");
      const macdSignal = parseFloat(macdEntry?.values?.[0]?.macd_signal ?? "NaN");
      const macdHist   = parseFloat(macdEntry?.values?.[0]?.macd_hist ?? "NaN");
      const ema50      = parseFloat(e50Entry?.values?.[0]?.ema ?? "NaN");
      const ema150     = parseFloat(e150Entry?.values?.[0]?.ema ?? "NaN");
      const ema200     = parseFloat(e200Entry?.values?.[0]?.ema ?? "NaN");

      if ([price, rsi14, macd, macdSignal, macdHist, ema50, ema150, ema200].some(isNaN)) {
        logger.warn({ symbol: key }, "fetchPerIndicator: NaN values, skipping");
        continue;
      }

      result.set(key, { symbol: key, price, rsi14, macd, macdSignal, macdHist, ema50, ema150, ema200, fetchedAt });
    } catch (err) {
      logger.warn({ symbol: sym, err }, "fetchPerIndicator: symbol failed, skipping");
    }
  }

  return result;
}

function populateCache(indicatorMap: Map<string, StockIndicators>): void {
  const now = Date.now();
  for (const [sym, indicators] of indicatorMap) {
    const { price, rsi14, ema50, ema150, ema200 } = indicators;
    const criteria = {
      priceAbove150: price > ema150,
      priceAbove200: price > ema200,
      ema150Above200: ema150 > ema200,
      priceAboveEma50: price > ema50,
      rsiHealthy: rsi14 > 50 && rsi14 < 80,
    };
    const isStage2 = Object.values(criteria).every(Boolean);
    cache.set(sym, {
      result: { symbol: sym, price, isStage2, criteria, indicators, fetchedAt: indicators.fetchedAt },
      cachedAt: now,
    });
  }
}

async function batchGetIndicators(symbols: string[]): Promise<void> {
  let indicatorMap: Map<string, StockIndicators>;
  try {
    indicatorMap = await fetchComplexData(symbols);
  } catch (err) {
    logger.warn({ err }, "Twelvedata /complex_data failed, falling back to per-indicator batch GETs");
    indicatorMap = await fetchPerIndicator(symbols);
  }
  populateCache(indicatorMap);
}

export async function screenMinervini(symbol: string): Promise<MinerviniResult> {
  const key = symbol.toUpperCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.result;
  }

  await batchGetIndicators([symbol]);

  const fresh = cache.get(key);
  if (!fresh) throw new Error(`No data returned for ${symbol}`);
  return fresh.result;
}

export async function batchScreen(symbols: string[]): Promise<MinerviniResult[]> {
  const now = Date.now();
  const uncached = symbols.filter((s) => {
    const entry = cache.get(s.toUpperCase());
    return !entry || now - entry.cachedAt >= CACHE_TTL;
  });

  if (uncached.length > 0) {
    const chunks = chunkArray(uncached, 50);
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1000));
      console.log(`Twelvedata batch fetch: ${chunks[i].length} symbols, chunk ${i + 1} of ${chunks.length}`);
      try {
        await batchGetIndicators(chunks[i]);
      } catch (err) {
        logger.warn({ chunk: i + 1, err }, "batchScreen: chunk failed entirely");
      }
    }
  }

  const results: MinerviniResult[] = [];
  for (const symbol of symbols) {
    const entry = cache.get(symbol.toUpperCase());
    if (entry) {
      results.push(entry.result);
    } else {
      logger.warn({ symbol }, "batchScreen: symbol missing from cache after batch fetch, skipping");
    }
  }

  return results.sort((a, b) => {
    if (a.isStage2 !== b.isStage2) return a.isStage2 ? -1 : 1;
    return b.indicators.rsi14 - a.indicators.rsi14;
  });
}
