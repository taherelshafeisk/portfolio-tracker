/**
 * Pure utility functions for the WIO/activity import pipeline.
 * These are intentionally side-effect-free so they can be unit-tested
 * without a database or network connection.
 */

/**
 * Crypto tickers that are priced in the account's local currency on WIO/UAE brokers.
 * Add symbols here as they appear in WIO statements (no exchange suffix).
 */
export const CRYPTO_SYMBOLS = new Set([
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOT', 'MATIC', 'LINK',
  'LTC', 'UNI', 'DOGE', 'SHIB', 'TRX', 'ATOM', 'XLM', 'VET', 'FIL', 'ALGO',
  'SAND', 'MANA', 'AXS', 'CRO', 'FTT', 'NEAR', 'ICP', 'ETC', 'HBAR', 'EGLD',
  'XTZ', 'THETA', 'FLOW', 'KSM', 'AAVE', 'MKR', 'COMP', 'SNX', 'CRV', 'YFI',
  'USDT', 'USDC', 'BUSD', 'DAI', 'TUSD',
]);

/**
 * OCR artifacts / sponsor brand names that are never valid standalone tickers.
 * These strings pass the 1-5 uppercase-letter regex but are not real tickers.
 */
const INVALID_TICKER_STRINGS = new Set([
  'SPDR',  // State Street fund family brand — individual ETFs use XLE, SPY, etc.
  'ISHARES', 'ETFS', 'ETF', 'FUND', 'TRUST',
]);

/**
 * Infer the currency of a single trade when Claude didn't return an explicit
 * sourceCurrency field.
 *
 * Logic for WIO/UAE mixed-currency accounts:
 *   - Crypto symbols → accountCurrency (AED on WIO)
 *   - Everything else (stocks, ETFs) → "USD"
 *
 * When sourceCurrency IS provided, it always takes priority.
 */
export function inferTradeCurrency(
  symbol: string | null | undefined,
  sourceCurrency: string | null | undefined,
  accountCurrency: string,
): string {
  if (sourceCurrency) return sourceCurrency.toUpperCase();
  const cleanSymbol = (symbol || '').toUpperCase().replace(/-USD$/, '').replace(/USDT$/, '');
  if (CRYPTO_SYMBOLS.has(cleanSymbol)) return accountCurrency.toUpperCase();
  return 'USD';
}

/**
 * Well-known instrument name → canonical ticker mappings.
 * Patterns are tested against the instrument's display name (not the ticker
 * field, which may be garbled by OCR). The first match wins.
 */
export const WELL_KNOWN_INSTRUMENTS: Array<{
  patterns: RegExp[];
  ticker: string;
}> = [
  // State Street / SPDR sector ETFs
  { patterns: [/state\s+street\s+energy\s+select/i, /spdr\s+energy\s+select/i, /energy\s+select\s+sector/i], ticker: 'XLE' },
  { patterns: [/state\s+street\s+financial\s+select/i, /spdr\s+financial\s+select/i, /financial\s+select\s+sector/i], ticker: 'XLF' },
  { patterns: [/state\s+street\s+technology\s+select/i, /spdr\s+technology\s+select/i, /technology\s+select\s+sector/i], ticker: 'XLK' },
  { patterns: [/state\s+street\s+health\s+care/i, /spdr\s+health\s+care\s+select/i, /health\s+care\s+select\s+sector/i], ticker: 'XLV' },
  { patterns: [/state\s+street\s+consumer\s+disc/i, /spdr\s+consumer\s+disc/i, /consumer\s+disc.*select\s+sector/i], ticker: 'XLY' },
  { patterns: [/state\s+street\s+consumer\s+staples/i, /spdr\s+consumer\s+staples/i, /consumer\s+staples\s+select/i], ticker: 'XLP' },
  { patterns: [/state\s+street\s+industrial\s+select/i, /spdr\s+industrial\s+select/i, /industrial.*select\s+sector/i], ticker: 'XLI' },
  { patterns: [/state\s+street\s+utilities\s+select/i, /spdr\s+utilities\s+select/i, /utilities\s+select\s+sector/i], ticker: 'XLU' },
  { patterns: [/state\s+street\s+materials\s+select/i, /spdr\s+materials\s+select/i, /materials\s+select\s+sector/i], ticker: 'XLB' },
  { patterns: [/state\s+street\s+real\s+estate/i, /spdr\s+real\s+estate\s+select/i, /real\s+estate\s+select\s+sector/i], ticker: 'XLRE' },
  { patterns: [/state\s+street\s+communication/i, /spdr\s+communication\s+services/i, /communication\s+services\s+select/i], ticker: 'XLC' },
  { patterns: [/state\s+street\s+gold\s+shares/i, /spdr\s+gold\s+shares/i, /spdr\s+gold\s+trust/i], ticker: 'GLD' },
  // State Street / SPDR broad market
  { patterns: [/spdr\s+s&?p\s*500\s+etf/i, /state\s+street\s+s&?p\s*500/i], ticker: 'SPY' },
  { patterns: [/spdr\s+dow\s+jones/i, /state\s+street\s+dow/i], ticker: 'DIA' },
  // Invesco
  { patterns: [/invesco\s+qqq/i, /powershares\s+qqq/i], ticker: 'QQQ' },
  { patterns: [/invesco\s+s&?p\s*500\s+equal/i], ticker: 'RSP' },
  // iShares
  { patterns: [/ishares\s+core\s+s&?p\s*500/i], ticker: 'IVV' },
  { patterns: [/ishares\s+russell\s+2000/i], ticker: 'IWM' },
  { patterns: [/ishares\s+msci\s+emerging/i], ticker: 'EEM' },
  { patterns: [/ishares\s+msci\s+eafe/i], ticker: 'EFA' },
  { patterns: [/ishares\s+bitcoin\s+trust/i, /ishares\s+bitcoin\s+etf/i], ticker: 'IBIT' },
  // Vanguard
  { patterns: [/vanguard\s+s&?p\s*500\s+etf/i], ticker: 'VOO' },
  { patterns: [/vanguard\s+total\s+stock\s+market/i], ticker: 'VTI' },
  { patterns: [/vanguard\s+emerging\s+markets/i], ticker: 'VWO' },
  { patterns: [/vanguard\s+ftse\s+developed/i], ticker: 'VEA' },
  { patterns: [/vanguard\s+real\s+estate/i], ticker: 'VNQ' },
  { patterns: [/vanguard\s+total\s+bond/i], ticker: 'BND' },
  // ProShares
  { patterns: [/proshares\s+ultrashort\s+s&?p/i], ticker: 'SDS' },
  { patterns: [/proshares\s+ultra\s+s&?p/i], ticker: 'SSO' },
  { patterns: [/proshares\s+ultra\s+pro\s+s&?p/i, /direxion.*3x.*bull/i], ticker: 'UPRO' },
];

/**
 * Resolve ticker from instrument name, falling back to OCR-extracted ticker.
 *
 * Priority:
 *   1. Name-based lookup against `name` field (WELL_KNOWN_INSTRUMENTS) — most reliable
 *   2. Name-based lookup against `notesText` (fallback when Claude puts name in notes)
 *   3. OCR ticker, only if it looks like a valid ticker (1-5 uppercase letters,
 *      optionally with a hyphen suffix for crypto like BTC-USD) AND is not a known
 *      brand/sponsor name (e.g. "SPDR" is not a real ticker)
 *   4. null + confident=false → leave for manual review
 */
export function resolveTickerFromName(
  name: string | null | undefined,
  ocrTicker: string | null | undefined,
  notesText?: string | null,
): { symbol: string | null; confident: boolean } {
  // Helper: test text against all well-known instrument patterns
  const tryNameMatch = (text: string): string | null => {
    for (const entry of WELL_KNOWN_INSTRUMENTS) {
      for (const pattern of entry.patterns) {
        if (pattern.test(text)) return entry.ticker;
      }
    }
    return null;
  };

  // 1. Name field resolution (highest priority)
  if (name) {
    const hit = tryNameMatch(name);
    if (hit) return { symbol: hit, confident: true };
  }

  // 2. Notes text as a fallback name source
  //    (Claude sometimes puts the full instrument name in notes instead of name field)
  if (notesText) {
    const hit = tryNameMatch(notesText);
    if (hit) return { symbol: hit, confident: true };
  }

  // 3. OCR ticker — accept only if it looks like a real ticker and isn't a known non-ticker
  if (ocrTicker) {
    const cleaned = ocrTicker.trim().toUpperCase();
    if (INVALID_TICKER_STRINGS.has(cleaned)) {
      // Known brand/sponsor string — not a real ticker
      return { symbol: null, confident: false };
    }
    // Valid format: AAPL, BTC, BTC-USD, XLE, GOOGL  (1-5 letters, optional -XX suffix)
    if (/^[A-Z]{1,5}(-[A-Z]{2,4})?$/.test(cleaned)) {
      return { symbol: cleaned, confident: true };
    }
    // Garbled OCR (numbers, special chars, too long) — reject
    return { symbol: null, confident: false };
  }

  return { symbol: null, confident: false };
}

/**
 * Derive unit price from quantity and totalAmount using absolute values.
 * Safe for crypto, fractional shares, and signed amounts (buys/sells).
 * Returns null if either input is missing or zero.
 */
export function derivePriceFromAmount(
  quantity: number | null | undefined,
  totalAmount: number | null | undefined,
): number | null {
  if (quantity == null || totalAmount == null) return null;
  const absQty = Math.abs(quantity);
  const absAmount = Math.abs(totalAmount);
  if (absQty === 0 || absAmount === 0) return null;
  const derived = absAmount / absQty;
  // Sanity: result must be finite and positive
  if (!isFinite(derived) || derived <= 0) return null;
  return derived;
}

/**
 * Deduplicate a flat list of trades by composite key:
 *   symbol | tradeDate | activityType | |quantity|
 *
 * The first occurrence wins (conservative — later files don't silently
 * overwrite earlier ones if the data is materially different).
 *
 * Works with both numeric and string quantity fields.
 */
export function deduplicateTrades<T extends {
  symbol?: string | null;
  tradeDate?: string | null;
  activityType?: string | null;
  quantity?: string | number | null;
}>(trades: T[]): T[] {
  const seen = new Map<string, T>();
  for (const trade of trades) {
    const rawQty = trade.quantity != null ? Number(trade.quantity) : NaN;
    const absQty = isNaN(rawQty) ? '' : String(Math.abs(rawQty));
    const key = [
      (trade.symbol || '').toUpperCase().trim(),
      (trade.tradeDate || '').split('T')[0].trim(),
      (trade.activityType || '').toLowerCase().trim(),
      absQty,
    ].join('|');
    if (!seen.has(key)) {
      seen.set(key, trade);
    }
    // Duplicate — skip (first occurrence wins)
  }
  return Array.from(seen.values());
}
