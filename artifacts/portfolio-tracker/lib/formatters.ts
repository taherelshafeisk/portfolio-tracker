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

/** Expand a raw positionBucket/sleeveKey value to a human-readable display name. */
export function sleeveDisplayName(key: string): string {
  const lower = key.toLowerCase().trim();
  if (SLEEVE_ABBREVS[lower]) return SLEEVE_ABBREVS[lower];
  return key.replace(/\b\w/g, c => c.toUpperCase());
}
