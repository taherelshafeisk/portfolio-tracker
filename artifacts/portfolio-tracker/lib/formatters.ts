// ─── Sleeve ──────────────────────────────────────────────────────────────────

const SLEEVE_ABBREVS: Record<string, string> = {
  def: 'Defensive',
  inc: 'Income',
  spec: 'Speculative',
  mkt: 'Market',
  idx: 'Index',
  div: 'Dividend',
  grw: 'Growth',
  alt: 'Alternative',
};

/**
 * Expand a raw positionBucket/sleeveKey value to a human-readable display name.
 * Returns "Unassigned" for null, undefined, or empty string so sleeve-grouped
 * UI sections never fall back to showing account names.
 */
export function sleeveDisplayName(key: string | null | undefined): string {
  if (!key || !key.trim()) return 'Unassigned';
  const lower = key.toLowerCase().trim();
  if (SLEEVE_ABBREVS[lower]) return SLEEVE_ABBREVS[lower];
  return key.replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Currency ────────────────────────────────────────────────────────────────

function withCommas(n: number, dec = 2): string {
  const [int, frac] = n.toFixed(dec).split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac !== undefined ? '.' + frac : '');
}

/**
 * Format a dollar value.
 *
 * mode 'full'    (default) — $43,484.04, comma-separated, 2 decimal places.
 * mode 'compact'           — $43.5K / $1.2M, 1 decimal place with K/M suffix.
 */
export function formatCurrency(value: number, mode: 'full' | 'compact' = 'full'): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (mode === 'compact') {
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
    return `${sign}$${abs.toFixed(0)}`;
  }
  if (abs >= 1_000_000) return `${sign}$${withCommas(abs / 1_000_000, 2)}M`;
  return `${sign}$${withCommas(abs, 2)}`;
}

/**
 * Format a P&L value with sign prefix: +$1,234.56 or −$567.89.
 * Full precision (2 decimals) — useful for realized/unrealized P&L display.
 */
export function formatPnl(n: number): string {
  const sign = n >= 0 ? '+' : '−';
  return `${sign}$${withCommas(Math.abs(n))}`;
}

/**
 * Signed dollar change: +$1,052 or −$340.
 * Uses unicode minus (−) for visual consistency.
 */
export function fmtSigned(n: number): string {
  const abs = Math.abs(n);
  const s = abs >= 1000 ? Math.round(abs).toLocaleString() : abs.toFixed(0);
  return (n >= 0 ? '+$' : '−$') + s;
}

/**
 * Format a percentage value.
 * @param decimals — decimal places (default 2).
 * @param signed — whether to prefix with +/- (default true).
 */
export function fmtPct(n: number, decimals = 2, signed = true): string {
  if (!signed) return n.toFixed(decimals) + '%';
  return (n >= 0 ? '+' : '') + n.toFixed(decimals) + '%';
}
