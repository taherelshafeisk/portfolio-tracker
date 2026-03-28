import React, { createContext, useContext, useState, useMemo, ReactNode, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}/api${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api${path}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(`API error ${res.status}`);
}

export interface Account {
  id: number;
  name: string;
  broker: string;
  accountType: 'long_term' | 'swing' | 'day_trading' | 'savings';
  currency: string;
  initialBalance: number;
  currentBalance: number;
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
  assetType?: string;
  sector?: string;
  notes?: string;
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
  isLoading: boolean;
  refreshAll: () => Promise<void>;
  refreshPositions: (accountId?: number) => Promise<void>;
  refreshActivities: () => Promise<void>;
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [activities, setActivities] = useState<TradeActivity[]>([]);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refreshAll = useCallback(async () => {
    setIsLoading(true);
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
    } catch (e) {
      console.error('Failed to refresh portfolio:', e);
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
      console.error('Failed to refresh positions:', e);
    }
  }, [accounts]);

  const refreshActivities = useCallback(async () => {
    try {
      const acts = await apiGet<TradeActivity[]>('/activities');
      setActivities(acts);
    } catch (e) {
      console.error('Failed to refresh activities:', e);
    }
  }, []);

  const value = useMemo(() => ({
    accounts,
    positions,
    activities,
    summary,
    isLoading,
    refreshAll,
    refreshPositions,
    refreshActivities,
  }), [accounts, positions, activities, summary, isLoading, refreshAll, refreshPositions, refreshActivities]);

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
