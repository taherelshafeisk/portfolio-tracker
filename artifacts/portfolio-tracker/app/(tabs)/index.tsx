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
import { usePortfolio, apiGet, apiPost, type Position, type Account } from '@/context/PortfolioContext';
import {
  evaluateConcentration, evaluateDrawdown, evaluateLeverage, resolveOverride,
  type StrategyProfile,
} from '@workspace/portfolio-policy';
import { defaultStrategyProfile } from '@workspace/portfolio-policy';
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
//
// All policy-driven thresholds come from a StrategyProfile argument.
// Pass `defaultStrategyProfile` at each call site; swap it out to switch strategies.
//
// Metric computation (e.g. concentrationFraction = marketValue / totalNav) stays here.
// Policy evaluation (is that fraction a warning or critical?) is delegated to the
// pure evaluators imported from lib/portfolioPolicy.

function computeHealthSignal(
  positions: Position[],
  accounts: Account[],
  totalNav: number,
  policy: StrategyProfile,
): HealthSignal {
  const hasCritical =
    positions.some(p => {
      const ov = resolveOverride(policy, { accountId: p.accountId, ticker: p.symbol });
      if (totalNav > 0 && evaluateConcentration(p.marketValue / totalNav, policy.concentrationRule, ov) === 'critical') return true;
      if (evaluateDrawdown(p.unrealizedPnlPct / 100, policy.drawdownRule, ov) === 'critical') return true;
      return false;
    });
  if (hasCritical) return 'red';

  const hasWarning =
    positions.some(p => {
      const ov = resolveOverride(policy, { accountId: p.accountId, ticker: p.symbol });
      if (totalNav > 0 && evaluateConcentration(p.marketValue / totalNav, policy.concentrationRule, ov)) return true;
      if (evaluateDrawdown(p.unrealizedPnlPct / 100, policy.drawdownRule, ov)) return true;
      return false;
    }) ||
    accounts.some(a => {
      const ov = resolveOverride(policy, { accountId: a.id });
      return evaluateLeverage(a.currentBalance, policy.leverageRule, ov) != null;
    });
  if (hasWarning) return 'amber';

  return 'green';
}

function computeRiskIndicators(
  positions: Position[],
  accounts: Account[],
  totalNav: number,
  policy: StrategyProfile,
): RiskIndicator[] {
  const indicators: RiskIndicator[] = [];

  // Concentration — one indicator per position that breaches the policy threshold
  if (totalNav > 0) {
    positions.forEach(p => {
      const fraction = p.marketValue / totalNav;
      const ov = resolveOverride(policy, { accountId: p.accountId, ticker: p.symbol });
      const severity = evaluateConcentration(fraction, policy.concentrationRule, ov);
      // Risk evaluators only return 'warning' or 'critical', never 'info'.
      // Cast to the RiskIndicator severity union which excludes 'info'.
      if (severity) {
        indicators.push({
          id: `conc-${p.id}`,
          label: 'Concentration',
          value: `${(fraction * 100).toFixed(1)}%`,
          severity: severity as RiskIndicator['severity'],
          detail: `${p.symbol} · ${p.name}`,
          onPress: () => router.push({ pathname: '/position/[id]', params: { id: String(p.id) } }),
        });
      }
    });
  }

  // Drawdown — one indicator per position that breaches the policy threshold
  positions.forEach(p => {
    const ov = resolveOverride(policy, { accountId: p.accountId, ticker: p.symbol });
    const severity = evaluateDrawdown(p.unrealizedPnlPct / 100, policy.drawdownRule, ov);
    if (severity) {
      indicators.push({
        id: `dd-${p.id}`,
        label: 'Drawdown',
        value: `${p.unrealizedPnlPct.toFixed(1)}%`,
        severity: severity as RiskIndicator['severity'],
        detail: p.symbol,
        onPress: () => router.push({ pathname: '/position/[id]', params: { id: String(p.id) } }),
      });
    }
  });

  // Leverage — one indicator per account with a negative cash balance
  accounts.forEach(a => {
    const ov = resolveOverride(policy, { accountId: a.id });
    const severity = evaluateLeverage(a.currentBalance, policy.leverageRule, ov);
    if (severity) {
      indicators.push({
        id: `lev-${a.id}`,
        label: 'Leverage',
        value: `$${Math.abs(a.currentBalance).toFixed(0)} borrowed`,
        severity: severity as RiskIndicator['severity'],
        detail: a.name,
        onPress: () => router.push({ pathname: '/account/[id]', params: { id: String(a.id) } }),
      });
    }
  });

  return indicators;
}

function computeAlerts(
  positions: Position[],
  accounts: Account[],
  totalNav: number,
  policy: StrategyProfile,
): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];

  if (totalNav > 0) {
    positions.forEach(p => {
      const fraction = p.marketValue / totalNav;
      const ov = resolveOverride(policy, { accountId: p.accountId, ticker: p.symbol });
      const severity = evaluateConcentration(fraction, policy.concentrationRule, ov);
      if (severity) {
        alerts.push({
          id: `conc-${p.id}`,
          type: 'concentration',
          severity,
          title: `${p.symbol} ${(fraction * 100).toFixed(0)}% of portfolio`,
          symbol: p.symbol,
          positionId: p.id,
          accountId: p.accountId,
          onPress: () => router.push({ pathname: '/position/[id]', params: { id: String(p.id) } }),
        });
      }
    });
  }

  positions.forEach(p => {
    const ov = resolveOverride(policy, { accountId: p.accountId, ticker: p.symbol });
    const severity = evaluateDrawdown(p.unrealizedPnlPct / 100, policy.drawdownRule, ov);
    if (severity) {
      alerts.push({
        id: `dd-${p.id}`,
        type: 'drawdown',
        severity,
        title: `${p.symbol} down ${Math.abs(p.unrealizedPnlPct).toFixed(1)}%`,
        symbol: p.symbol,
        positionId: p.id,
        accountId: p.accountId,
        onPress: () => router.push({ pathname: '/position/[id]', params: { id: String(p.id) } }),
      });
    }
  });

  accounts.forEach(a => {
    const ov = resolveOverride(policy, { accountId: a.id });
    const severity = evaluateLeverage(a.currentBalance, policy.leverageRule, ov);
    if (severity) {
      alerts.push({
        id: `lev-${a.id}`,
        type: 'leverage',
        severity,
        title: `Leverage active · ${a.name}`,
        accountId: a.id,
        onPress: () => router.push({ pathname: '/account/[id]', params: { id: String(a.id) } }),
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
    const onPress = concentrationAlerts.length === 1 && concentrationAlerts[0].positionId != null
      ? () => router.push({ pathname: '/position/[id]', params: { id: String(concentrationAlerts[0].positionId) } })
      : concentrationAlerts[0].accountId != null
        ? () => router.push({ pathname: '/account/[id]', params: { id: String(concentrationAlerts[0].accountId) } })
        : () => router.push('/(tabs)/accounts');
    items.push({
      id: 'action-concentration',
      title: 'Review concentrated positions',
      description: symbols || 'One or more positions exceed 20% of portfolio',
      urgency: concentrationAlerts.some(a => a.severity === 'critical') ? 'high' : 'medium',
      cta: 'Review',
      onPress,
    });
  }

  const drawdownAlerts = alerts.filter(a => a.type === 'drawdown');
  if (drawdownAlerts.length > 0) {
    const symbols = drawdownAlerts.map(a => a.symbol).filter(Boolean).join(', ');
    const onPress = drawdownAlerts.length === 1 && drawdownAlerts[0].positionId != null
      ? () => router.push({ pathname: '/position/[id]', params: { id: String(drawdownAlerts[0].positionId) } })
      : drawdownAlerts[0].accountId != null
        ? () => router.push({ pathname: '/account/[id]', params: { id: String(drawdownAlerts[0].accountId) } })
        : () => router.push('/(tabs)/accounts');
    items.push({
      id: 'action-drawdown',
      title: 'Check drawdown positions',
      description: symbols || 'One or more positions are down significantly',
      urgency: drawdownAlerts.some(a => a.severity === 'critical') ? 'high' : 'medium',
      cta: 'View',
      onPress,
    });
  }

  const leverageAlerts = alerts.filter(a => a.type === 'leverage');
  if (leverageAlerts.length > 0) {
    const onPress = leverageAlerts.length === 1 && leverageAlerts[0].accountId != null
      ? () => router.push({ pathname: '/account/[id]', params: { id: String(leverageAlerts[0].accountId) } })
      : () => router.push('/(tabs)/accounts');
    items.push({
      id: 'action-leverage',
      title: 'Leverage in use',
      description: 'One or more accounts have a negative cash balance',
      urgency: 'medium',
      cta: 'View',
      onPress,
    });
  }

  return items;
}

function truncateSymbols(symbols: string[], max = 3): string {
  if (symbols.length <= max) return symbols.join(', ');
  return `${symbols.slice(0, max).join(', ')} +${symbols.length - max}`;
}

function collapseAlerts(alerts: DashboardAlert[]): DashboardAlert[] {
  const drawdowns = alerts.filter(a => a.type === 'drawdown');
  const others = alerts.filter(a => a.type !== 'drawdown');
  if (drawdowns.length <= 1) return alerts;
  const worstSeverity = drawdowns.some(a => a.severity === 'critical') ? 'critical' : 'warning';
  const symbols = truncateSymbols(drawdowns.map(a => a.symbol).filter(Boolean) as string[]);
  return [
    ...others,
    {
      id: 'dd-summary',
      type: 'drawdown',
      severity: worstSeverity,
      title: `${drawdowns.length} positions down · ${symbols}`,
      onPress: () => router.push('/(tabs)/accounts'),
    },
  ];
}

function computeRiskSummaryIndicators(indicators: RiskIndicator[]): RiskIndicator[] {
  const drawdowns = indicators.filter(i => i.label === 'Drawdown');
  const others = indicators.filter(i => i.label !== 'Drawdown');
  if (drawdowns.length <= 1) return indicators;
  const worstSeverity = drawdowns.some(d => d.severity === 'critical') ? 'critical' : 'warning';
  const symbols = truncateSymbols(drawdowns.map(d => d.detail).filter(Boolean) as string[]);
  return [
    ...others,
    {
      id: 'dd-summary',
      label: 'Drawdown',
      value: `${drawdowns.length} positions`,
      severity: worstSeverity,
      detail: symbols,
      onPress: () => router.push('/(tabs)/accounts'),
    },
  ];
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { summary, accounts, positions, isLoading, error, refreshAll } = usePortfolio();
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
    () => computeHealthSignal(positions, accounts, totalNav, defaultStrategyProfile),
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
    () => computeRiskIndicators(positions, accounts, totalNav, defaultStrategyProfile),
    [positions, accounts, totalNav],
  );

  const alerts = useMemo(
    () => computeAlerts(positions, accounts, totalNav, defaultStrategyProfile),
    [positions, accounts, totalNav],
  );

  const actionItems = useMemo(
    () => computeActionItems(alerts),
    [alerts],
  );

  const collapsedAlerts = useMemo(() => collapseAlerts(alerts), [alerts]);

  const riskSummaryIndicators = useMemo(
    () => computeRiskSummaryIndicators(riskIndicators),
    [riskIndicators],
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

      {error && (
        <Pressable style={styles.errorBanner} onPress={refreshAll}>
          <Feather name="wifi-off" size={13} color={colors.negative} />
          <Text style={styles.errorBannerText}>{error}</Text>
          <Text style={styles.errorBannerRetry}>Retry</Text>
        </Pressable>
      )}

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

        {/* 3. Action items */}
        <ActionSection items={actionItems} />

        {/* 4. Suggested orders — real API data, explicit generation */}
        <OrderSuggestionsPreview
          suggestions={pendingSuggestions}
          isLoading={suggestionsLoading}
          isGenerating={isGenerating}
          onGenerate={() => generateSuggestions()}
          onViewAll={() => router.push('/orders')}
        />

        {/* 5. Risk summary */}
        <RiskSection indicators={riskSummaryIndicators} />

        {/* 6. Alerts summary */}
        <AlertSection alerts={collapsedAlerts} />

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
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,59,48,0.10)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,59,48,0.25)',
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  errorBannerText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.negative,
  },
  errorBannerRetry: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.negative,
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
