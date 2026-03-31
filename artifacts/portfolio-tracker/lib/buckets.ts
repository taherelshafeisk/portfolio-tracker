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

export function autoBucketFromAssetType(assetType?: string | null): Bucket {
  switch (assetType?.toLowerCase()) {
    case 'crypto':  return 'crypto';
    case 'etf':
    case 'bond':
    case 'reit':
    case 'index':   return 'long_term';
    default:        return 'speculative'; // stock, commodity, forex, null
  }
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
  assetType: string | null | undefined,
  overrides: Record<number, Bucket>,
): Bucket {
  return overrides[positionId] ?? autoBucketFromAssetType(assetType);
}
