import React, { useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  Pressable, StatusBar, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { colors } from '@/constants/colors';
import { usePortfolio, apiGet, PortfolioSummary } from '@/context/PortfolioContext';
import { Card } from '@/components/ui/Card';
import { PnlBadge, formatCurrency } from '@/components/ui/PnlBadge';
import { AccountTypeBadge } from '@/components/ui/AccountTypeBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { BrokerLogo } from '@/components/ui/BrokerLogo';

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

export default function PortfolioScreen() {
  const insets = useSafeAreaInsets();
  const { summary, accounts, isLoading, refreshAll } = usePortfolio();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const { data: indices, isLoading: indicesLoading } = useQuery({
    queryKey: ['indices'],
    queryFn: () => apiGet<MarketIndex[]>('/market/indices'),
    refetchInterval: 60000,
  });

  useEffect(() => {
    refreshAll();
    // Auto-refresh live prices every 60 seconds
    const interval = setInterval(() => refreshAll(), 60_000);
    return () => clearInterval(interval);
  }, []);

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const isPositive = (summary?.totalUnrealizedPnl ?? 0) >= 0;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
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
        contentContainerStyle={[styles.scroll, {
          paddingBottom: Platform.OS === 'web' ? 100 : (insets.bottom + 90)
        }]}
      >
        {/* NAV Card */}
        {isLoading && !summary ? (
          <View style={styles.navCardSkeleton}>
            <Skeleton height={14} width="35%" />
            <Skeleton height={44} width="65%" style={{ marginTop: 12 }} />
            <Skeleton height={12} width="50%" style={{ marginTop: 10 }} />
          </View>
        ) : (
          <Card style={[styles.navCard, { borderColor: isPositive ? 'rgba(0,230,118,0.2)' : 'rgba(255,71,87,0.2)' }]}>
            <Text style={styles.navLabel}>Total Portfolio Value</Text>
            <Text style={styles.navValue}>
              {formatCurrency(summary?.totalNav ?? 0)}
            </Text>
            <View style={styles.navRow}>
              <PnlBadge
                value={summary?.totalUnrealizedPnl ?? 0}
                percentage={summary?.totalUnrealizedPnlPct ?? 0}
                size="md"
              />
              <Text style={styles.navMeta}>
                {summary?.positionCount ?? 0} positions · {summary?.accountCount ?? 0} accounts
              </Text>
            </View>
            {(summary?.dayChange !== undefined && summary.dayChange !== 0) && (
              <View style={styles.dailyRow}>
                <Text style={styles.dailyLabel}>Today</Text>
                <Text style={[styles.dailyVal, { color: summary.dayChange >= 0 ? colors.positive : colors.negative }]}>
                  {summary.dayChange >= 0 ? '+' : ''}{formatCurrency(summary.dayChange)}
                  {' '}({summary.dayChangePct >= 0 ? '+' : ''}{summary.dayChangePct.toFixed(2)}%)
                </Text>
              </View>
            )}
            {(summary?.topMovers?.length ?? 0) > 0 && (
              <View style={styles.moversRow}>
                {summary!.topMovers.map(m => (
                  <View key={m.symbol} style={[styles.moverChip, { backgroundColor: m.dayChangePct >= 0 ? 'rgba(0,230,118,0.1)' : 'rgba(255,71,87,0.1)' }]}>
                    <Text style={styles.moverSymbol}>{m.symbol}</Text>
                    <Text style={[styles.moverPct, { color: m.dayChangePct >= 0 ? colors.positive : colors.negative }]}>
                      {m.dayChangePct >= 0 ? '+' : ''}{m.dayChangePct.toFixed(2)}%
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </Card>
        )}

        {/* Market Indices */}
        <Text style={styles.sectionTitle}>Markets</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.indicesScroll}>
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
                  <Card key={idx.symbol} style={styles.indexCard}>
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
              })
          }
        </ScrollView>

        {/* Top Positions */}
        {(summary?.topPositions?.length ?? 0) > 0 && (
          <>
            <Text style={styles.sectionTitle}>Top Positions</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.indicesScroll}>
              {summary!.topPositions.map(pos => {
                const isUp = pos.dayChangePct >= 0;
                return (
                  <Card key={pos.symbol} style={styles.indexCard}>
                    <Text style={styles.indexName}>{pos.symbol}</Text>
                    <Text style={styles.indexPrice}>
                      {pos.currentPrice >= 1000
                        ? pos.currentPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })
                        : pos.currentPrice.toFixed(2)}
                    </Text>
                    <Text style={[styles.indexChange, { color: isUp ? colors.positive : colors.negative }]}>
                      {isUp ? '+' : ''}{pos.dayChangePct.toFixed(2)}%
                    </Text>
                  </Card>
                );
              })}
            </ScrollView>
          </>
        )}

        {/* Account Breakdown */}
        <Text style={styles.sectionTitle}>Accounts</Text>
        {accounts.length === 0 && !isLoading ? (
          <Card style={styles.emptyCard}>
            <Feather name="briefcase" size={36} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No accounts yet</Text>
            <Text style={styles.emptyText}>Add your first trading account in the Accounts tab</Text>
          </Card>
        ) : (
          (summary?.accounts ?? []).map(acc => {
            const pos = acc.unrealizedPnl >= 0;
            return (
              <Card key={acc.id} style={styles.accountCard} onPress={() => router.push({ pathname: '/account/[id]', params: { id: acc.id.toString() } })}>
                <View style={styles.accountRow}>
                  <View style={styles.accountLeft}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <BrokerLogo broker={accounts.find(a => a.id === acc.id)?.broker ?? ''} size={32} />
                      <AccountTypeBadge type={acc.accountType as any} size="sm" />
                    </View>
                    <Text style={styles.accountName}>{acc.name}</Text>
                  </View>
                  <View style={styles.accountRight}>
                    <Text style={styles.accountNav}>{formatCurrency(acc.nav)}</Text>
                    <Text style={[styles.accountPnl, { color: pos ? colors.positive : colors.negative }]}>
                      {pos ? '+' : ''}{acc.unrealizedPnl.toFixed(2)} ({pos ? '+' : ''}{acc.unrealizedPnlPct.toFixed(2)}%)
                    </Text>
                  </View>
                </View>
                <View style={styles.accountFooter}>
                  {(acc.dayChange != null && acc.dayChange !== 0) ? (
                    <Text style={[styles.accountDayPnl, { color: acc.dayChange >= 0 ? colors.positive : colors.negative }]}>
                      {acc.dayChange >= 0 ? '+' : ''}{formatCurrency(acc.dayChange)} ({(acc.dayChangePct ?? 0) >= 0 ? '+' : ''}{(acc.dayChangePct ?? 0).toFixed(2)}%) today
                    </Text>
                  ) : null}
                  <Text style={styles.positionCount}>{acc.positionCount} positions</Text>
                </View>
                {(acc.topMovers?.length ?? 0) > 0 && (
                  <View style={styles.moversRow}>
                    {acc.topMovers.map(m => (
                      <View key={m.symbol} style={[styles.moverChip, { backgroundColor: m.dayChangePct >= 0 ? 'rgba(0,230,118,0.1)' : 'rgba(255,71,87,0.1)' }]}>
                        <Text style={styles.moverSymbol}>{m.symbol}</Text>
                        <Text style={[styles.moverPct, { color: m.dayChangePct >= 0 ? colors.positive : colors.negative }]}>
                          {m.dayChangePct >= 0 ? '+' : ''}{m.dayChangePct.toFixed(2)}%
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </Card>
            );
          })
        )}
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
  navCardSkeleton: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: colors.separator,
  },
  navCard: {
    marginBottom: 24,
    padding: 20,
  },
  navLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  navValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 40,
    color: colors.textPrimary,
    marginTop: 6,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 12,
  },
  navMeta: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: 12,
  },
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
  accountCard: {
    marginBottom: 10,
  },
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  accountLeft: {
    flex: 1,
    gap: 6,
  },
  accountName: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: colors.textPrimary,
  },
  accountRight: {
    alignItems: 'flex-end',
  },
  accountNav: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: colors.textPrimary,
  },
  accountPnl: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginTop: 2,
  },
  accountFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  accountDayPnl: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  positionCount: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: colors.textMuted,
  },
  dailyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  dailyLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
  },
  dailyVal: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  moversRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  moverChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  moverSymbol: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    color: colors.textPrimary,
  },
  moverPct: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  emptyCard: {
    alignItems: 'center',
    padding: 32,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: colors.textSecondary,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
