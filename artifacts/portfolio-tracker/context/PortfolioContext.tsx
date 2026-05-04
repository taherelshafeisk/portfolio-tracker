import React, { createContext, useContext, useState, useMemo, ReactNode, useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { getAuthToken, tryRefreshToken } from './AuthContext';
import { resolveApiBaseUrl } from '@/utils/apiUrl';

const BASE_URL = resolveApiBaseUrl();
console.log('BASE_URL =', BASE_URL);

// ── Session-expired sentinel ───────────────────────────────────────────────────

export class SessionExpiredError extends Error {
  constructor() { super('SESSION_EXPIRED'); }
}

// ── Auth headers ──────────────────────────────────────────────────────────────

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getAuthToken();
  const headers: Record<string, string> = { ...extra };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// ── 401 retry helper ──────────────────────────────────────────────────────────

async function fetchWithRefresh(input: RequestInfo, init?: RequestInit): Promise<Response> {
  let res = await fetch(input, init);
  if (res.status !== 401) return res;
  // Token might be expired — try refreshing once
  const refreshed = await tryRefreshToken();
  if (!refreshed) throw new SessionExpiredError();
  // Retry with new token (authHeaders() now reads the updated token)
  res = await fetch(input, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers as Record<string, string> ?? {}) },
  });
  if (res.status === 401) throw new SessionExpiredError();
  return res;
}

// ── API helpers ───────────────────────────────────────────────────────────────

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetchWithRefresh(`${BASE_URL}/api${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`API error ${res.status} on GET ${path}`);
  return res.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchWithRefresh(`${BASE_URL}/api${path}`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `API error ${res.status}`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchWithRefresh(`${BASE_URL}/api${path}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchWithRefresh(`${BASE_URL}/api${path}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetchWithRefresh(`${BASE_URL}/api${path}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) throw new Error(`API error ${res.status}`);
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetchWithRefresh(`${BASE_URL}/api${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  if (!res.ok) {
    let msg = `API error ${res.status}`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

export interface Account {
  id: number;
  name: string;
  broker: string;
  accountType: 'long_term' | 'swing' | 'day_trading' | 'savings';
  currency: string;
  initialBalance: number;
  currentBalance: number;
  sleeveKey?: string | null;
  maxLeverageRatio?: number | null;
  ipsVersion?: string | null;
  concentrationLimit?: number | null;
  leverageCeiling?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Position {
  id: number;
  accountId: number;
  symbol: string;
  name: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  dayChange: number;
  dayChangePct: number;
  closed?: boolean;
  assetType?: string;
  sector?: string;
  notes?: string;
  notesUpdatedAt?: string | null;
  positionBucket?: string | null;
  ipsAction?: string | null;
  stopPrice?: number | null;
  targetPrice?: number | null;
  addZoneLow?: number | null;
  addZoneHigh?: number | null;
  cutListAddedAt?: string | null;
  policyNote?: string | null;
  ipsVersion?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TradeActivity {
  id: number;
  accountId: number;
  symbol?: string;
  activityType: 'buy' | 'sell' | 'dividend' | 'deposit' | 'withdrawal' | 'note';
  quantity?: number;
  price?: number;
  totalAmount?: number;
  notes?: string;
  tradeDate: string;
  createdAt: string;
}

export type MacroPosture = {
  label: string | null;
  notes: string | null;
  cryptoView: string | null;
  recessionRisk: number | null;
  setAt: string | null;
};

export interface TopMover {
  symbol: string;
  dayChange: number;
  dayChangePct: number;
}

export interface TopPosition {
  symbol: string;
  name: string;
  currentPrice: number;
  marketValue: number;
  dayChangePct: number;
}

export interface PortfolioSummary {
  totalNav: number;
  totalCost: number;
  totalUnrealizedPnl: number;
  totalUnrealizedPnlPct: number;
  dayChange: number;
  dayChangePct: number;
  accountCount: number;
  positionCount: number;
  topMovers: TopMover[];
  topPositions: TopPosition[];
  accounts: {
    id: number;
    name: string;
    accountType: string;
    nav: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number;
    dayChange: number;
    dayChangePct: number;
    positionCount: number;
    topMovers: TopMover[];
  }[];
}

interface PortfolioContextValue {
  accounts: Account[];
  positions: Position[];
  activities: TradeActivity[];
  summary: PortfolioSummary | null;
  macroPosture: MacroPosture | null;
  isLoading: boolean;
  error: string | null;
  sessionExpired: boolean;
  refreshAll: () => Promise<void>;
  refreshPositions: (accountId?: number) => Promise<void>;
  refreshActivities: () => Promise<void>;
  fetchMacroPosture: () => Promise<void>;
  resetState: () => void;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [activities, setActivities] = useState<TradeActivity[]>([]);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [macroPosture, setMacroPosture] = useState<MacroPosture | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const resetState = useCallback(() => {
    setAccounts([]);
    setPositions([]);
    setActivities([]);
    setSummary(null);
    setMacroPosture(null);
    setError(null);
    setSessionExpired(false);
  }, []);

  const fetchMacroPosture = useCallback(async () => {
    try {
      const data = await apiGet<MacroPosture>('/macro-posture');
      setMacroPosture(data.label !== null ? data : null);
    } catch (e) {
      console.warn('Failed to fetch macro posture:', e);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    if (!getAuthToken()) return; // not signed in yet — skip silently
    setIsLoading(true);
    setError(null);
    try {
      const [accs, acts] = await Promise.all([
        apiGet<Account[]>('/accounts'),
        apiGet<TradeActivity[]>('/activities'),
      ]);
      setAccounts(accs);
      setActivities(acts);

      const allPositions: Position[] = [];
      await Promise.all(accs.map(async (acc) => {
        const pos = await apiGet<Position[]>(`/accounts/${acc.id}/positions`);
        allPositions.push(...pos);
      }));
      setPositions(allPositions);

      const summ = await apiGet<PortfolioSummary>('/portfolio/summary');
      setSummary(summ);

      await fetchMacroPosture();
      setSessionExpired(false);
    } catch (e) {
      if (e instanceof SessionExpiredError) {
        setSessionExpired(true);
        setError('Session expired. Please sign in again.');
      } else {
        const isNetwork = e instanceof TypeError && (e as TypeError).message.includes('Network request failed');
        setError(isNetwork ? "Can't reach the server. Check your connection." : "Failed to load portfolio. Pull down to retry.");
      }
      console.warn('Portfolio refresh failed:', e);
    } finally {
      setIsLoading(false);
    }
  }, [fetchMacroPosture]);

  const refreshPositions = useCallback(async (accountId?: number) => {
    try {
      if (accountId) {
        const pos = await apiGet<Position[]>(`/accounts/${accountId}/positions`);
        setPositions(prev => [...prev.filter(p => p.accountId !== accountId), ...pos]);
      } else {
        const allPositions: Position[] = [];
        await Promise.all(accounts.map(async (acc) => {
          const pos = await apiGet<Position[]>(`/accounts/${acc.id}/positions`);
          allPositions.push(...pos);
        }));
        setPositions(allPositions);
      }
    } catch (e) {
      console.warn('Failed to refresh positions:', e);
    }
  }, [accounts]);

  const refreshActivities = useCallback(async () => {
    try {
      const acts = await apiGet<TradeActivity[]>('/activities');
      setActivities(acts);
    } catch (e) {
      console.warn('Failed to refresh activities:', e);
    }
  }, []);

  // ── AppState: refresh data when app returns to foreground ─────────────────────
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      // Only refresh when transitioning from background/inactive → active
      if (nextState === 'active' && prev !== 'active') {
        refreshAll();
      }
    });
    return () => sub.remove();
  }, [refreshAll]);

  const value = useMemo(() => ({
    accounts,
    positions,
    activities,
    summary,
    macroPosture,
    isLoading,
    error,
    sessionExpired,
    refreshAll,
    refreshPositions,
    refreshActivities,
    fetchMacroPosture,
    resetState,
  }), [accounts, positions, activities, summary, macroPosture, isLoading, error, sessionExpired, refreshAll, refreshPositions, refreshActivities, fetchMacroPosture, resetState]);

  return (
    <PortfolioContext.Provider value={value}>
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  const context = useContext(PortfolioContext);
  if (!context) throw new Error('usePortfolio must be used within PortfolioProvider');
  return context;
}
