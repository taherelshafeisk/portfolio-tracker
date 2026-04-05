/**
 * lib/buckets.ts
 *
 * Local-first position bucket model.
 *
 * Three visible buckets: long_term | speculative | crypto
 *
 * Classification:
 *   autoBucket      — derived from position.assetType using v1 heuristic
 *   userOverride    — manually set by user, stored in AsyncStorage (local-only in v1)
 *   effectiveBucket — userOverride ?? autoBucket
 *
 * Override storage uses AsyncStorage keyed by positionId.
 * Backend persistence is planned but not in scope for v1.
 *
 * Heuristic rationale:
 *   crypto → crypto          (distinct asset class, own group always)
 *   etf/bond/reit/index → long_term   (passive, income, diversified — core holdings)
 *   stock/commodity/forex/null → speculative  (individual names, tactical — safe fallback)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type Bucket = 'long_term' | 'speculative' | 'crypto';

// ─── Symbol lists ─────────────────────────────────────────────────────────────

/** Known crypto base symbols — appended with -USD for Yahoo Finance lookups. */
export const CRYPTO_SYMBOLS = new Set([
  'BTC', 'ETH', 'SOL', 'ADA', 'XRP', 'DOGE', 'AVAX', 'DOT', 'MATIC',
  'LINK', 'UNI', 'ATOM', 'LTC', 'BCH', 'XLM', 'ALGO', 'VET', 'FIL',
  'TRX', 'SHIB', 'BNB', 'NEAR', 'FTM', 'SAND', 'MANA', 'THETA', 'HBAR',
  'ICP', 'ETC', 'FLOW', 'CHZ', 'APE', 'CRO', 'GRT', 'ENJ', 'BAT',
  'ZEC', 'DASH', 'NEO', 'EOS', 'PEPE', 'WIF', 'BONK', 'ARB', 'OP',
  'SUI', 'APT', 'INJ', 'TIA', 'SEI', 'RUNE', 'CRV', 'AAVE', 'COMP',
  'MKR', 'SNX', 'YFI', 'SUSHI', 'ZRX',
]);

/**
 * Well-known blue-chip / large-cap tickers that classify as long_term
 * when the assetType is not explicitly set. Extend this list as needed.
 */
export const CORE_TICKERS = new Set([
  'MSFT', 'NVDA', 'GOOGL', 'AAPL', 'AMZN', 'TSLA', 'META', 'TSM', 'AVGO', 'MU',
  'VOO', 'QQQ', 'SPY', 'GLD', 'GOLD', 'SILVER', 'XLE', 'NLY', 'WMT', 'COST',
]);

export const BUCKET_ORDER: Bucket[] = ['long_term', 'speculative', 'crypto'];

export const BUCKET_LABELS: Record<Bucket, string> = {
  long_term:   'Long Term',
  speculative: 'Speculative',
  crypto:      'Crypto',
};

export const BUCKET_COLORS: Record<Bucket, string> = {
  long_term:   '#4CAF50',
  speculative: '#FF9800',
  crypto:      '#9C27B0',
};

// ─── Auto-classification heuristic ───────────────────────────────────────────

/**
 * Derives a bucket from symbol + assetType. Rules (first match wins):
 *  1. assetType === 'crypto'  OR  symbol in CRYPTO_SYMBOLS  → crypto
 *  2. assetType === 'etf'                                   → long_term
 *  3. symbol in CORE_TICKERS                                → long_term
 *  4. everything else                                       → speculative
 */
export function autoBucket(
  symbol: string | null | undefined,
  assetType: string | null | undefined,
): Bucket {
  const upper = symbol?.toUpperCase() ?? '';
  const type  = assetType?.toLowerCase() ?? '';
  if (type === 'crypto' || CRYPTO_SYMBOLS.has(upper)) return 'crypto';
  if (type === 'etf') return 'long_term';
  if (CORE_TICKERS.has(upper)) return 'long_term';
  return 'speculative';
}

// ─── Override storage ─────────────────────────────────────────────────────────

const overrideKey = (positionId: number) => `@bucket_override_${positionId}`;

export async function loadAllBucketOverrides(
  positionIds: number[],
): Promise<Record<number, Bucket>> {
  if (positionIds.length === 0) return {};
  try {
    const keys = positionIds.map(overrideKey);
    const pairs = await AsyncStorage.multiGet(keys);
    const result: Record<number, Bucket> = {};
    for (const [key, val] of pairs) {
      if (val) {
        const id = parseInt(key.replace('@bucket_override_', ''), 10);
        if (!isNaN(id)) result[id] = val as Bucket;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export async function saveBucketOverride(
  positionId: number,
  bucket: Bucket,
): Promise<void> {
  try {
    await AsyncStorage.setItem(overrideKey(positionId), bucket);
  } catch { /* ignore storage errors */ }
}

export async function clearBucketOverride(positionId: number): Promise<void> {
  try {
    await AsyncStorage.removeItem(overrideKey(positionId));
  } catch { /* ignore */ }
}

// ─── Resolved bucket ─────────────────────────────────────────────────────────

export function effectiveBucket(
  positionId: number,
  symbol: string | null | undefined,
  assetType: string | null | undefined,
  overrides: Record<number, Bucket>,
): Bucket {
  return overrides[positionId] ?? autoBucket(symbol, assetType);
}
