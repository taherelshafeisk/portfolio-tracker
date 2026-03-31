/**
 * lib/marketHours.ts
 *
 * Simple US market-open detection + account mode persistence.
 *
 * Market hours: Mon–Fri, 09:30–16:00 Eastern Time.
 *
 * Limitations in v1:
 *   - No holiday calendar (Christmas, Thanksgiving, etc. will show "open")
 *   - No early-close detection (e.g. day before Thanksgiving)
 *   - Uses Intl API for timezone conversion — requires a runtime that supports it
 *
 * Sufficient for defaulting Overview/Intraday mode. User can always override manually.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type AccountMode = 'overview' | 'intraday';

// ─── Market-open detection ────────────────────────────────────────────────────

function nowInET(): Date {
  const now = new Date();
  // Intl.DateTimeFormat gives us a string in ET; parse it back to a Date
  const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  return new Date(etString);
}

/**
 * Returns true during regular US trading hours.
 * Mon–Fri 09:30–16:00 ET. No holiday support in v1.
 */
export function isMarketOpen(): boolean {
  const et = nowInET();
  const day = et.getDay(); // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return false;

  const totalMinutes = et.getHours() * 60 + et.getMinutes();
  return totalMinutes >= 9 * 60 + 30 && totalMinutes < 16 * 60;
}

/**
 * Default mode based on current market status.
 * Use as the initial value of a useState call:
 *   const [mode, setMode] = useState<AccountMode>(defaultMode);
 */
export function defaultMode(): AccountMode {
  return isMarketOpen() ? 'intraday' : 'overview';
}

// ─── Mode persistence ─────────────────────────────────────────────────────────

const modeKey = (accountId: number) => `@account_mode_${accountId}`;

export async function loadAccountMode(accountId: number): Promise<AccountMode | null> {
  try {
    const val = await AsyncStorage.getItem(modeKey(accountId));
    return val === 'overview' || val === 'intraday' ? val : null;
  } catch {
    return null;
  }
}

export async function saveAccountMode(
  accountId: number,
  mode: AccountMode,
): Promise<void> {
  try {
    await AsyncStorage.setItem(modeKey(accountId), mode);
  } catch { /* ignore */ }
}
