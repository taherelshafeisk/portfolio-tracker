export type AssetTypeKey = 'stock' | 'etf' | 'crypto' | 'commodity' | 'bond' | 'reit' | 'forex' | 'index';

export interface AssetTypeConfig {
  key: AssetTypeKey;
  label: string;
  color: string;
  icon: string; // Feather icon name
}

export const ASSET_TYPES: AssetTypeConfig[] = [
  { key: 'stock',     label: 'Stock',     color: '#2196F3', icon: 'trending-up' },
  { key: 'etf',       label: 'ETF',       color: '#FF9800', icon: 'layers' },
  { key: 'crypto',    label: 'Crypto',    color: '#9C27B0', icon: 'hash' },
  { key: 'commodity', label: 'Commodity', color: '#FFD700', icon: 'package' },
  { key: 'bond',      label: 'Bond',      color: '#4CAF50', icon: 'shield' },
  { key: 'reit',      label: 'REIT',      color: '#00BCD4', icon: 'home' },
  { key: 'forex',     label: 'Forex',     color: '#607D8B', icon: 'repeat' },
  { key: 'index',     label: 'Index',     color: '#E91E63', icon: 'bar-chart-2' },
];

const ASSET_MAP = new Map<string, AssetTypeConfig>(ASSET_TYPES.map(a => [a.key, a]));

export function getAssetType(type?: string | null): AssetTypeConfig {
  return ASSET_MAP.get(type ?? '') ?? { key: 'stock', label: 'Stock', color: '#2196F3', icon: 'trending-up' };
}
