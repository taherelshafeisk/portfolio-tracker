import React, { useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  Pressable, StatusBar, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { colors } from '@/constants/colors';
import { usePortfolio, apiGet, apiPost } from '@/context/PortfolioContext';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';

// Home section components
import { PortfolioHealthCard, HealthSignal } from '@/components/home/PortfolioHealthCard';
import { SleeveSection, SleeveData } from '@/components/home/SleeveSection';
import { RiskSection, RiskIndicator } from '@/components/home/RiskSection';
import { AlertSection, DashboardAlert } from '@/components/home/AlertSection';
import { ActionSection, ActionItem } from '@/components/home/ActionSection';
import { OrderSuggestionsPreview, OrderSuggestion } from '@/components/home/OrderSuggestionsPreview';

interface MarketIndex {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

const INDEX_NAMES: Record<string, string> = {
  '^GSPC': 'S&P 500',
  '^DJI': 'DOW',
  '^IXIC': 'NASDAQ',
  '^RUT': 'RUSSELL',
  '^VIX': 'VIX',
};

// ─── Derivation helpers ───────────────────────────────────────────────────────

function computeHealthSignal(
  positions: ReturnType<typeof usePortfolio>['positions'],
  accounts: ReturnType<typeof usePortfolio>['accounts'],
  totalNav: number,
): HealthSignal {
  const hasCritical = positions.some(p => p.unrealizedPnlPct < -25);
  const hasConcentration = totalNav > 0 && positions.some(p => p.marketValue / totalNav > 0.35);
  const hasLeverage = accounts.some(a => a.currentBalance < 0);
  if (hasCritical) return 'red';
  if (
    positions.some(p => p.unrealizedPnlPct < -15) ||
    hasConcentration ||
    hasLeverage
  ) return 'amber';
  return 'green';
}

function computeRiskIndicators(
  positions: ReturnType<typeof usePortfolio>['positions'],
  accounts: ReturnType<typeof usePortfolio>['accounts'],
  totalNav: number,
): RiskIndicator[] {
  const indicators: RiskIndicator[] = [];

  // Concentration — one indicator per position over threshold
  if (totalNav > 0) {
    positions.forEach(p => {
      const pct = (p.marketValue / totalNav) * 100;
      if (pct >= 20) {
        indicators.push({
          id: `conc-${p.symbol}`,
          label: 'Concentration',
          value: `${pct.toFixed(1)}%`,
          severity: pct >= 35 ? 'critical' : 'warning',
          detail: `${p.symbol} · ${p.name}`,
        });
      }
    });
  }

  // Large drawdown — one indicator per position under threshold
  positions.forEach(p => {
    if (p.unrealizedPnlPct <= -15) {
      indicators.push({
        id: `dd-${p.symbol}`,
        label: 'Drawdown',
        value: `${p.unrealizedPnlPct.toFixed(1)}%`,
        severity: p.unrealizedPnlPct <= -30 ? 'critical' : 'warning',
        detail: p.symbol,
      });
    }
  });

  // Leverage — one indicator per account with negative cash balance
  accounts.forEach(a => {
    if (a.currentBalance < 0) {
      indicators.push({
        id: `lev-${a.id}`,
        label: 'Leverage',
        value: `$${Math.abs(a.currentBalance).toFixed(0)} borrowed`,
        severity: 'warning',
        detail: a.name,
      });
    }
  });

  return indicators;
}

function computeAlerts(
  positions: ReturnType<typeof usePortfolio>['positions'],
  accounts: ReturnType<typeof usePortfolio>['accounts'],
  totalNav: number,
): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];

  if (totalNav > 0) {
    positions.forEach(p => {
      const pct = (p.marketValue / totalNav) * 100;
      if (pct >= 20) {
        alerts.push({
          id: `conc-${p.symbol}`,
          type: 'concentration',
          severity: pct >= 30 ? 'critical' : 'warning',
          title: `${p.symbol} ${pct.toFixed(0)}% of portfolio`,
          symbol: p.symbol,
        });
      }
    });
  }

  positions.forEach(p => {
    if (p.unrealizedPnlPct <= -15) {
      alerts.push({
        id: `dd-${p.symbol}`,
        type: 'drawdown',
        severity: p.unrealizedPnlPct <= -25 ? 'critical' : 'warning',
        title: `${p.symbol} down ${Math.abs(p.unrealizedPnlPct).toFixed(1)}%`,
        symbol: p.symbol,
      });
    }
  });

  accounts.forEach(a => {
    if (a.currentBalance < 0) {
      alerts.push({
        id: `lev-${a.id}`,
        type: 'leverage',
        severity: 'warning',
        title: `Leverage active · ${a.name}`,
      });
    }
  });

  return alerts;
}


function computeActionItems(alerts: DashboardAlert[]): ActionItem[] {
  // Derive action items from live alerts.
  // TODO: replace with server-side action_items table once that schema lands.
  const items: ActionItem[] = [];

  const concentrationAlerts = alerts.filter(a => a.type === 'concentration');
  if (concentrationAlerts.length > 0) {
    const symbols = concentrationAlerts.map(a => a.symbol).filter(Boolean).join(', ');
    items.push({
      id: 'action-concentration',
      title: 'Review concentrated positions',
      description: symbols || 'One or more positions exceed 20% of portfolio',
      urgency: concentrationAlerts.some(a => a.severity === 'critical') ? 'high' : 'medium',
      cta: 'Review',
      onPress: () => router.push('/(tabs)/accounts'),
    });
  }

  const drawdownAlerts = alerts.filter(a => a.type === 'drawdown');
  if (drawdownAlerts.length > 0) {
    const symbols = drawdownAlerts.map(a => a.symbol).filter(Boolean).join(', ');
    items.push({
      id: 'action-drawdown',
      title: 'Check drawdown positions',
      description: symbols || 'One or more positions are down significantly',
      urgency: drawdownAlerts.some(a => a.severity === 'critical') ? 'high' : 'medium',
      cta: 'View',
      onPress: () => router.push('/(tabs)/accounts'),
    });
  }

  const leverageAlerts = alerts.filter(a => a.type === 'leverage');
  if (leverageAlerts.length > 0) {
    items.push({
      id: 'action-leverage',
      title: 'Leverage in use',
      description: 'One or more accounts have a negative cash balance',
      urgency: 'medium',
      cta: 'View',
      onPress: () => router.push('/(tabs)/accounts'),
    });
  }

  return items;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { summary, accounts, positions, isLoading, refreshAll } = usePortfolio();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const { data: indices, isLoading: indicesLoading } = useQuery({
    queryKey: ['indices'],
    queryFn: () => apiGet<MarketIndex[]>('/market/indices'),
    refetchInterval: 60000,
  });

  useEffect(() => {
    refreshAll();
    const interval = setInterval(() => refreshAll(), 60_000);
    return () => clearInterval(interval);
  }, []);

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  // ── Derived data (all memoised) ─────────────────────────────────────────────

  const totalNav = summary?.totalNav ?? 0;

  const healthSignal = useMemo(
    () => computeHealthSignal(positions, accounts, totalNav),
    [positions, accounts, totalNav],
  );

  const sleeves = useMemo<SleeveData[]>(
    () =>
      (summary?.accounts ?? []).map(acc => {
        const flatAcc = accounts.find(a => a.id === acc.id);
        return {
          id: acc.id,
          name: acc.name,
          accountType: acc.accountType,
          nav: acc.nav,
          dayChange: acc.dayChange,
          dayChangePct: acc.dayChangePct,
          unrealizedPnl: acc.unrealizedPnl,
          unrealizedPnlPct: acc.unrealizedPnlPct,
          positionCount: acc.positionCount,
          topMover: acc.topMovers[0]
            ? { symbol: acc.topMovers[0].symbol, dayChangePct: acc.topMovers[0].dayChangePct }
            : undefined,
          cashBalance: flatAcc?.currentBalance,
        };
      }),
    [summary, accounts],
  );

  const riskIndicators = useMemo(
    () => computeRiskIndicators(positions, accounts, totalNav),
    [positions, accounts, totalNav],
  );

  const alerts = useMemo(
    () => computeAlerts(positions, accounts, totalNav),
    [positions, accounts, totalNav],
  );

  const actionItems = useMemo(
    () => computeActionItems(alerts),
    [alerts],
  );

  const {
    data: rawSuggestions,
    isLoading: suggestionsLoading,
    refetch: refetchSuggestions,
  } = useQuery({
    queryKey: ['order-suggestions'],
    queryFn: () => apiGet<OrderSuggestion[]>('/order-suggestions'),
    staleTime: Infinity, // user controls refresh explicitly
  });

  const pendingSuggestions = useMemo(
    () => (rawSuggestions ?? []).filter(s => s.status === 'pending'),
    [rawSuggestions],
  );

  const { mutate: generateSuggestions, isPending: isGenerating } = useMutation({
    mutationFn: () => apiPost<OrderSuggestion[]>('/order-suggestions/generate', {}),
    onSuccess: () => refetchSuggestions(),
  });

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Text style={styles.greeting}>{getGreeting()}</Text>
        <Pressable onPress={refreshAll} style={styles.refreshBtn}>
          <Feather name="refresh-cw" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refreshAll}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Platform.OS === 'web' ? 100 : insets.bottom + 90 },
        ]}
      >
        {/* 1. Portfolio health */}
        <PortfolioHealthCard
          totalNav={totalNav}
          totalUnrealizedPnl={summary?.totalUnrealizedPnl ?? 0}
          totalUnrealizedPnlPct={summary?.totalUnrealizedPnlPct ?? 0}
          dayChange={summary?.dayChange ?? 0}
          dayChangePct={summary?.dayChangePct ?? 0}
          positionCount={summary?.positionCount ?? 0}
          sleeveCount={sleeves.length}
          healthSignal={healthSignal}
          isLoading={isLoading && !summary}
        />

        {/* 2. Sleeve summaries */}
        <SleeveSection sleeves={sleeves} />

        {/* 3. Risk indicators */}
        <RiskSection indicators={riskIndicators} />

        {/* 4. Alerts */}
        <AlertSection alerts={alerts} />

        {/* 5. Action items */}
        <ActionSection items={actionItems} />

        {/* 6. Suggested orders — real API data, explicit generation */}
        <OrderSuggestionsPreview
          suggestions={pendingSuggestions}
          isLoading={suggestionsLoading}
          isGenerating={isGenerating}
          onGenerate={() => generateSuggestions()}
        />

        {/* ── Market strip (retained from previous screen) ────────────────── */}
        <Text style={styles.sectionTitle}>Markets</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.indicesScroll}
        >
          {indicesLoading
            ? [1, 2, 3, 4].map(i => (
                <View key={i} style={styles.indexCardSkeleton}>
                  <Skeleton height={10} width={50} />
                  <Skeleton height={18} width={70} style={{ marginTop: 6 }} />
                  <Skeleton height={10} width={45} style={{ marginTop: 4 }} />
                </View>
              ))
            : (indices || []).map(idx => {
                const pos = idx.changePercent >= 0;
                return (
                  <Card
                    key={idx.symbol}
                    style={styles.indexCard}
                    onPress={() =>
                      router.push({
                        pathname: '/chart/[symbol]',
                        params: { symbol: idx.symbol },
                      })
                    }
                  >
                    <Text style={styles.indexName}>{INDEX_NAMES[idx.symbol] || idx.symbol}</Text>
                    <Text style={styles.indexPrice}>
                      {idx.price >= 1000
                        ? idx.price.toLocaleString('en-US', { maximumFractionDigits: 0 })
                        : idx.price.toFixed(2)}
                    </Text>
                    <Text style={[styles.indexChange, { color: pos ? colors.positive : colors.negative }]}>
                      {pos ? '+' : ''}{idx.changePercent.toFixed(2)}%
                    </Text>
                  </Card>
                );
              })}
        </ScrollView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
    paddingTop: 4,
  },
  greeting: {
    fontFamily: 'Inter_700Bold',
    fontSize: 26,
    color: colors.textPrimary,
  },
  refreshBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: 12,
  },
  // Market strip
  indicesScroll: {
    marginBottom: 24,
    marginHorizontal: -4,
  },
  indexCard: {
    marginHorizontal: 4,
    width: 110,
    padding: 12,
  },
  indexCardSkeleton: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 12,
    marginHorizontal: 4,
    width: 110,
    borderWidth: 1,
    borderColor: colors.separator,
  },
  indexName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  indexPrice: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: colors.textPrimary,
    marginTop: 4,
  },
  indexChange: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    marginTop: 2,
  },
});
