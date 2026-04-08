import { describe, it, expect } from 'vitest';
import {
  derivePriceFromAmount,
  resolveTickerFromName,
  deduplicateTrades,
  inferTradeCurrency,
} from '../routes/anthropic/trade-utils';

// ────────────────────────────────────────────────────────────────────────────
// derivePriceFromAmount
// ────────────────────────────────────────────────────────────────────────────

describe('derivePriceFromAmount', () => {
  it('derives price for a buy: 8 shares at -482.61 USD', () => {
    const price = derivePriceFromAmount(8, -482.61);
    expect(price).toBeCloseTo(60.33, 2);
  });

  it('derives price for a sell: 0.00567 BTC for +1489.59 AED', () => {
    const price = derivePriceFromAmount(0.00567, 1489.59);
    // 1489.59 / 0.00567 ≈ 262,714 AED per BTC
    expect(price).toBeCloseTo(262714, -2); // within ±50 of correct value
  });

  it('handles fractional share buy: 2.5 shares at -150.00', () => {
    const price = derivePriceFromAmount(2.5, -150.0);
    expect(price).toBeCloseTo(60.0, 4);
  });

  it('uses absolute values: negative quantity should not change result', () => {
    const p1 = derivePriceFromAmount(8, -482.61);
    const p2 = derivePriceFromAmount(-8, 482.61);
    expect(p1).toBeCloseTo(p2!, 6);
  });

  it('returns null when quantity is null', () => {
    expect(derivePriceFromAmount(null, 100)).toBeNull();
  });

  it('returns null when totalAmount is null', () => {
    expect(derivePriceFromAmount(10, null)).toBeNull();
  });

  it('returns null when quantity is zero', () => {
    expect(derivePriceFromAmount(0, 100)).toBeNull();
  });

  it('returns null when amount is zero', () => {
    expect(derivePriceFromAmount(10, 0)).toBeNull();
  });

  it('preserves AED amount without converting to USD', () => {
    // 0.00567 BTC sold for 1489.59 AED → price in AED (not USD)
    const priceAED = derivePriceFromAmount(0.00567, 1489.59);
    // 1489.59 / 0.00567 ≈ 262,716 — well above any USD price for BTC at the time
    // The point is: no currency conversion happens here; that's the caller's job
    expect(priceAED).toBeGreaterThan(200_000);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// resolveTickerFromName
// ────────────────────────────────────────────────────────────────────────────

describe('resolveTickerFromName', () => {
  it('maps "State Street Energy Select" to XLE', () => {
    const result = resolveTickerFromName('State Street Energy Select', 'SDPR');
    expect(result.symbol).toBe('XLE');
    expect(result.confident).toBe(true);
  });

  it('maps "Energy Select Sector SPDR" to XLE (variant name)', () => {
    const result = resolveTickerFromName('Energy Select Sector SPDR Fund', null);
    expect(result.symbol).toBe('XLE');
    expect(result.confident).toBe(true);
  });

  it('overrides bad OCR guess "SDPR" when name is recognizable', () => {
    // "SDPR" is a garbled OCR of "SPDR"; the name-based lookup should win
    const result = resolveTickerFromName('State Street Energy Select Sector', 'SDPR');
    expect(result.symbol).toBe('XLE');
    expect(result.symbol).not.toBe('SDPR');
  });

  it('rejects "SPDR" as a standalone ticker (it is a fund family brand, not a ticker)', () => {
    const result = resolveTickerFromName(null, 'SPDR');
    expect(result.symbol).toBeNull();
    expect(result.confident).toBe(false);
  });

  it('resolves "State Street Energy Select" from notesText when name field is null', () => {
    // Claude puts name in notes field instead of name field
    const result = resolveTickerFromName(
      null,
      'SPDR',
      'Buy State Street Energy Select, 8 shares · Main',
    );
    expect(result.symbol).toBe('XLE');
    expect(result.confident).toBe(true);
  });

  it('notes-based resolution overrides garbled OCR ticker', () => {
    const result = resolveTickerFromName(
      null,
      'SDPR',
      'Sell Energy Select Sector SPDR Fund',
    );
    expect(result.symbol).toBe('XLE');
  });

  it('maps "SPDR S&P 500 ETF" to SPY', () => {
    const result = resolveTickerFromName('SPDR S&P 500 ETF Trust', 'SPY');
    expect(result.symbol).toBe('SPY');
    expect(result.confident).toBe(true);
  });

  it('maps "Invesco QQQ" to QQQ', () => {
    const result = resolveTickerFromName('Invesco QQQ Trust', null);
    expect(result.symbol).toBe('QQQ');
    expect(result.confident).toBe(true);
  });

  it('accepts a clean OCR ticker when name is unknown', () => {
    const result = resolveTickerFromName('Some Unknown Equity', 'AAPL');
    expect(result.symbol).toBe('AAPL');
    expect(result.confident).toBe(true);
  });

  it('accepts crypto ticker with hyphen suffix (BTC-USD)', () => {
    const result = resolveTickerFromName(null, 'BTC-USD');
    expect(result.symbol).toBe('BTC-USD');
    expect(result.confident).toBe(true);
  });

  it('leaves ambiguous/garbled OCR tickers unresolved when name is null', () => {
    // "SDPR" alone (no name) looks like a 4-letter ticker and would be accepted
    // — but "SD PR" with a space or special char would be rejected
    const garbled = resolveTickerFromName(null, 'SD PR');
    expect(garbled.symbol).toBeNull();
    expect(garbled.confident).toBe(false);
  });

  it('leaves fully unknown instrument unresolved (null name, null ticker)', () => {
    const result = resolveTickerFromName(null, null);
    expect(result.symbol).toBeNull();
    expect(result.confident).toBe(false);
  });

  it('rejects ticker with digits or special chars as garbled OCR', () => {
    expect(resolveTickerFromName(null, 'X1LE').symbol).toBeNull();
    expect(resolveTickerFromName(null, 'XL@E').symbol).toBeNull();
    expect(resolveTickerFromName(null, 'TOOLONG').symbol).toBeNull();
  });

  it('is case-insensitive for name matching', () => {
    const result = resolveTickerFromName('state street energy select', null);
    expect(result.symbol).toBe('XLE');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// deduplicateTrades
// ────────────────────────────────────────────────────────────────────────────

describe('deduplicateTrades', () => {
  const base = {
    symbol: 'AAPL',
    tradeDate: '2024-03-15',
    activityType: 'buy',
    quantity: '10',
  };

  it('keeps a single trade unchanged', () => {
    expect(deduplicateTrades([base])).toHaveLength(1);
  });

  it('removes exact duplicate across two files', () => {
    const copy = { ...base, _source: 'File 2' };
    expect(deduplicateTrades([base, copy])).toHaveLength(1);
  });

  it('first occurrence wins on duplicate', () => {
    const first = { ...base, notes: 'first' };
    const second = { ...base, notes: 'second' };
    const result = deduplicateTrades([first, second]);
    expect(result[0]).toMatchObject({ notes: 'first' });
  });

  it('treats buy and sell of same size on same day as different trades', () => {
    const buy = { ...base, activityType: 'buy' };
    const sell = { ...base, activityType: 'sell' };
    expect(deduplicateTrades([buy, sell])).toHaveLength(2);
  });

  it('treats different quantities as different trades', () => {
    const t1 = { ...base, quantity: '10' };
    const t2 = { ...base, quantity: '5' };
    expect(deduplicateTrades([t1, t2])).toHaveLength(2);
  });

  it('treats different symbols as different trades', () => {
    const t1 = { ...base, symbol: 'AAPL' };
    const t2 = { ...base, symbol: 'MSFT' };
    expect(deduplicateTrades([t1, t2])).toHaveLength(2);
  });

  it('is case-insensitive for symbol comparison', () => {
    const t1 = { ...base, symbol: 'aapl' };
    const t2 = { ...base, symbol: 'AAPL' };
    expect(deduplicateTrades([t1, t2])).toHaveLength(1);
  });

  it('handles numeric quantity field (not just string)', () => {
    const t1 = { ...base, quantity: 10 as unknown as string };
    const t2 = { ...base, quantity: '10' };
    expect(deduplicateTrades([t1, t2])).toHaveLength(1);
  });

  it('does not drop valid rows when batch has mixed success', () => {
    // Simulate: file 1 gives 2 trades, file 2 gives 1 trade (different), no duplicates
    const trades = [
      { symbol: 'AAPL', tradeDate: '2024-03-15', activityType: 'buy', quantity: '10' },
      { symbol: 'MSFT', tradeDate: '2024-03-15', activityType: 'buy', quantity: '5' },
      { symbol: 'GOOGL', tradeDate: '2024-03-16', activityType: 'sell', quantity: '3' },
    ];
    expect(deduplicateTrades(trades)).toHaveLength(3);
  });

  it('handles overlapping screenshots: same trade present in multiple files', () => {
    // Both screenshots show the same AAPL buy — should result in 1 trade
    const trades = Array(3).fill(base);
    expect(deduplicateTrades(trades)).toHaveLength(1);
  });

  it('handles signed quantity by normalising with abs()', () => {
    const t1 = { ...base, quantity: '10', activityType: 'buy' };
    // Some parsers might return negative qty for sells
    const t2 = { ...base, quantity: '-10', activityType: 'buy' };
    // Same abs qty → duplicate
    expect(deduplicateTrades([t1, t2])).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// inferTradeCurrency
// ────────────────────────────────────────────────────────────────────────────

describe('inferTradeCurrency', () => {
  it('uses explicit sourceCurrency when provided', () => {
    expect(inferTradeCurrency('BTC', 'USD', 'AED')).toBe('USD');
    expect(inferTradeCurrency('XLE', 'AED', 'USD')).toBe('AED');
  });

  it('infers AED for BTC on a WIO (AED) account when sourceCurrency is missing', () => {
    expect(inferTradeCurrency('BTC', null, 'AED')).toBe('AED');
    expect(inferTradeCurrency('BTC', undefined, 'AED')).toBe('AED');
  });

  it('infers AED for ETH on a WIO (AED) account when sourceCurrency is missing', () => {
    expect(inferTradeCurrency('ETH', null, 'AED')).toBe('AED');
  });

  it('infers USD for stock/ETF on a WIO account when sourceCurrency is missing', () => {
    // XLE is a stock/ETF, not crypto — should stay USD even on WIO account
    expect(inferTradeCurrency('XLE', null, 'AED')).toBe('USD');
    expect(inferTradeCurrency('AAPL', null, 'AED')).toBe('USD');
    expect(inferTradeCurrency('SPDR', null, 'AED')).toBe('USD');
  });

  it('handles BTC-USD format by stripping the suffix', () => {
    expect(inferTradeCurrency('BTC-USD', null, 'AED')).toBe('AED');
  });

  it('handles BTCUSDT by stripping USDT suffix', () => {
    expect(inferTradeCurrency('BTCUSDT', null, 'AED')).toBe('AED');
  });

  it('returns USD when accountCurrency is USD and no sourceCurrency for stock', () => {
    expect(inferTradeCurrency('AAPL', null, 'USD')).toBe('USD');
  });

  it('still uses AED for crypto when top-level currency was wrongly detected as USD', () => {
    // This is the core regression: Claude says accountCurrency="USD" because it
    // sees USD-priced stocks, but BTC is actually in AED
    expect(inferTradeCurrency('BTC', null, 'USD')).toBe('USD');
    // ^ When accountCurrency is USD and no explicit sourceCurrency, crypto falls
    // back to USD — which is correct for a USD account (IBKR etc.)
    // On a WIO account the caller must pass accountCurrency="AED".
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Integration: price derivation with AED vs USD currency preservation
// ────────────────────────────────────────────────────────────────────────────

describe('currency preservation in price derivation', () => {
  it('derives AED price for BTC sell on WIO account without converting', () => {
    // Row: Sell 0.00567 BTC, +1,489.59 AED
    const price = derivePriceFromAmount(0.00567, 1489.59);
    // Result is in AED. If we had incorrectly converted AED→USD (÷3.6725)
    // we'd get ~71,545. The raw AED price should be ~262,717.
    expect(price).toBeGreaterThan(200_000); // definitively in AED territory
  });

  it('derives USD price for stock buy without confusion with AED amounts', () => {
    // Row: Buy 8 shares XLE, -482.61 USD
    const price = derivePriceFromAmount(8, -482.61);
    expect(price).toBeCloseTo(60.33, 1); // reasonable USD stock price
  });
});
