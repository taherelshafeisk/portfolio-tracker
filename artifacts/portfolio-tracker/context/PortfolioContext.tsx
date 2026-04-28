import React, { createContext, useContext, useState, useMemo, ReactNode, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuthToken } from './AuthContext';

function resolveBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) {
    return domain.includes('localhost')
      ? `http://${domain}`
      : `https://${domain}`;
  }
  // On web, fall back to same hostname on port 3001 (API server default)
  if (typeof window !== 'undefined') {
    return `http://${window.location.hostname}:3001`;
  }
  return '';
}

const BASE_URL = resolveBaseUrl();
console.log('BASE_URL =', BASE_URL);

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getAuthToken();
  const headers: Record<string, string> = { ...extra };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}/api${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`API error ${res.status} on GET ${path}`);
  return res.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}/api${path}`, {
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
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method: 'PATCH',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204) throw new Error(`API error ${res.status}`);
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}/api${path}`, {
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
  /** Non-null when the last refresh failed. Cleared on the next successful fetch. */
  error: string | null;
  refreshAll: () => Promise<void>;
  refreshPositions: (accountId?: number) => Promise<void>;
  refreshActivities: () => Promise<void>;
  fetchMacroPosture: () => Promise<void>;
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

  const fetchMacroPosture = useCallback(async () => {
    try {
      const data = await apiGet<MacroPosture>('/macro-posture');
      setMacroPosture(data.label !== null ? data : null);
    } catch (e) {
      console.warn('Failed to fetch macro posture:', e);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Fetch accounts and activities in parallel
      const [accs, acts] = await Promise.all([
        apiGet<Account[]>('/accounts'),
        apiGet<TradeActivity[]>('/activities'),
      ]);
      setAccounts(accs);
      setActivities(acts);

      // 2. Fetch positions (this triggers live price updates in the DB)
      const allPositions: Position[] = [];
      await Promise.all(accs.map(async (acc) => {
        const pos = await apiGet<Position[]>(`/accounts/${acc.id}/positions`);
        allPositions.push(...pos);
      }));
      setPositions(allPositions);

      // 3. Fetch summary AFTER positions so it reads fresh prices from DB
      const summ = await apiGet<PortfolioSummary>('/portfolio/summary');
      setSummary(summ);

      // 4. Fetch macro posture alongside
      await fetchMacroPosture();
    } catch (e) {
      const isNetworkError = e instanceof TypeError && (e as TypeError).message.includes('Network request failed');
      setError(isNetworkError ? "Can't reach the server. Check your connection." : "Failed to load portfolio. Pull down to retry.");
      console.warn('Portfolio refresh failed:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  const value = useMemo(() => ({
    accounts,
    positions,
    activities,
    summary,
    macroPosture,
    isLoading,
    error,
    refreshAll,
    refreshPositions,
    refreshActivities,
    fetchMacroPosture,
  }), [accounts, positions, activities, summary, macroPosture, isLoading, error, refreshAll, refreshPositions, refreshActivities, fetchMacroPosture]);

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
