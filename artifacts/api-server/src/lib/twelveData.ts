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

export async function getIndicators(symbol: string): Promise<StockIndicators> {
  const s = encodeURIComponent(symbol);
  const [rsiData, macdData, ema50Data, ema150Data, ema200Data, priceData] =
    await Promise.all([
      tdFetch(`/rsi?symbol=${s}&interval=1day&outputsize=1`),
      tdFetch(`/macd?symbol=${s}&interval=1day&fast_period=12&slow_period=26&signal_period=9&outputsize=1`),
      tdFetch(`/ema?symbol=${s}&interval=1day&time_period=50&outputsize=1`),
      tdFetch(`/ema?symbol=${s}&interval=1day&time_period=150&outputsize=1`),
      tdFetch(`/ema?symbol=${s}&interval=1day&time_period=200&outputsize=1`),
      tdFetch(`/price?symbol=${s}`),
    ]);

  return {
    symbol,
    price: parseFloat(priceData.price),
    rsi14: parseFloat(rsiData.values?.[0]?.rsi ?? rsiData.value),
    macd: parseFloat(macdData.values?.[0]?.macd ?? macdData.macd),
    macdSignal: parseFloat(macdData.values?.[0]?.macd_signal ?? macdData.macd_signal),
    macdHist: parseFloat(macdData.values?.[0]?.macd_hist ?? macdData.macd_hist),
    ema50: parseFloat(ema50Data.values?.[0]?.ema ?? ema50Data.value),
    ema150: parseFloat(ema150Data.values?.[0]?.ema ?? ema150Data.value),
    ema200: parseFloat(ema200Data.values?.[0]?.ema ?? ema200Data.value),
    fetchedAt: new Date().toISOString(),
  };
}

export async function screenMinervini(symbol: string): Promise<MinerviniResult> {
  const cached = cache.get(symbol.toUpperCase());
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.result;
  }

  const indicators = await getIndicators(symbol);
  const { price, rsi14, ema50, ema150, ema200 } = indicators;

  const criteria = {
    priceAbove150: price > ema150,
    priceAbove200: price > ema200,
    ema150Above200: ema150 > ema200,
    priceAboveEma50: price > ema50,
    rsiHealthy: rsi14 > 50 && rsi14 < 80,
  };

  const isStage2 = Object.values(criteria).every(Boolean);
  const fetchedAt = new Date().toISOString();

  const result: MinerviniResult = {
    symbol,
    price,
    isStage2,
    criteria,
    indicators,
    fetchedAt,
  };

  cache.set(symbol.toUpperCase(), { result, cachedAt: Date.now() });
  return result;
}

export async function batchScreen(symbols: string[]): Promise<MinerviniResult[]> {
  const results: MinerviniResult[] = [];

  for (let i = 0; i < symbols.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 500));
    try {
      const result = await screenMinervini(symbols[i]);
      results.push(result);
    } catch (err) {
      logger.warn({ symbol: symbols[i], err }, "batchScreen: symbol failed, skipping");
    }
  }

  return results.sort((a, b) => {
    if (a.isStage2 !== b.isStage2) return a.isStage2 ? -1 : 1;
    return b.indicators.rsi14 - a.indicators.rsi14;
  });
}
