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
