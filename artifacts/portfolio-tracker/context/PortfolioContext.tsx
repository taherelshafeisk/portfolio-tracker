import React, { createContext, useContext, useState, useMemo, ReactNode, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '';

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

export interface PortfolioSummary {
  totalNav: number;
  totalCost: number;
  totalUnrealizedPnl: number;
  totalUnrealizedPnlPct: number;
  dayChange: number;
  dayChangePct: number;
  accountCount: number;
  positionCount: number;
  accounts: {
    id: number;
    name: string;
    accountType: string;
    nav: number;
    unrealizedPnl: number;
    unrealizedPnlPct: number;
    positionCount: number;
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
      const [accs, summ, acts] = await Promise.all([
        apiGet<Account[]>('/accounts'),
        apiGet<PortfolioSummary>('/portfolio/summary'),
        apiGet<TradeActivity[]>('/activities'),
      ]);
      setAccounts(accs);
      setSummary(summ);
      setActivities(acts);
      // Fetch positions for all accounts
      const allPositions: Position[] = [];
      await Promise.all(accs.map(async (acc) => {
        const pos = await apiGet<Position[]>(`/accounts/${acc.id}/positions`);
        allPositions.push(...pos);
      }));
      setPositions(allPositions);
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
