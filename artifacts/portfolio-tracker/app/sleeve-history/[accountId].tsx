import React, { useState } from 'react';
import {
  View, Text, StyleSheet, SectionList, Pressable, ActivityIndicator, Platform,
} from 'react-native';
import { useLocalSearchParams, useNavigation, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { colors } from '@/constants/colors';
import { usePortfolio, apiGet } from '@/context/PortfolioContext';
import { Card } from '@/components/ui/Card';
import { formatCurrency } from '@/components/ui/PnlBadge';

interface PositionEntry {
  positionId: number;
  ticker: string;
  status: 'open' | 'closed';
  totalShares: number;
  avgCostBasis: number;
  totalInvested: number;
  realizedPnl: number;
  firstEntryDate: string | null;
  lastActivityDate: string | null;
  holdDurationDays: number;
}

interface SleeveSummary {
  accountId: number;
  accountName: string;
  sleeve: string | null;
  totalRealizedPnl: number;
  totalPositions: number;
  closedPositions: number;
  openPositions: number;
  winRate: number;
  positions: PositionEntry[];
}

interface SectionData {
  title: string;
  data: PositionEntry[];
}

export default function SleeveHistoryScreen() {
  const { accountId: accountIdParam } = useLocalSearchParams<{ accountId: string }>();
  const accountId = parseInt(accountIdParam);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { accounts } = usePortfolio();

  const account = accounts.find(a => a.id === accountId);

  React.useEffect(() => {
    if (account) navigation.setOptions({ title: `${account.name} History` });
  }, [account]);

  const { data: sleeves, isLoading, isError, refetch } = useQuery<SleeveSummary[]>({
    queryKey: ['position-history-sleeve', accountId],
    queryFn: () => apiGet(`/positions/history?accountId=${accountId}`),
  });

  const sleeve = sleeves?.[0];

  const sections: SectionData[] = React.useMemo(() => {
    if (!sleeve) return [];
    const open = sleeve.positions.filter(p => p.status === 'open');
    const closed = sleeve.positions.filter(p => p.status === 'closed');
    const result: SectionData[] = [];
    if (open.length > 0) result.push({ title: 'Open Positions', data: open });
    if (closed.length > 0) result.push({ title: 'Closed Positions', data: closed });
    return result;
  }, [sleeve]);

  if (isLoading) {
    return (
      <View style={[styles.center, { paddingBottom: insets.bottom }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (isError || !sleeve) {
    return (
      <View style={[styles.center, { paddingBottom: insets.bottom }]}>
        <Text style={styles.errorText}>Could not load sleeve history</Text>
        <Pressable style={styles.retryBtn} onPress={() => refetch()}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const renderItem = ({ item }: { item: PositionEntry }) => {
    const isOpen = item.status === 'open';
    const pnlColor = item.realizedPnl >= 0 ? colors.positive : colors.negative;

    return (
      <Pressable
        style={({ pressed }) => [styles.positionRow, { opacity: pressed ? 0.7 : 1 }]}
        onPress={() => router.push({ pathname: '/position/[ticker]', params: { ticker: item.ticker, accountId: String(accountId) } })}
      >
        <View style={styles.positionLeft}>
          <View style={styles.positionTopRow}>
            <Text style={styles.ticker}>{item.ticker}</Text>
            <View style={[styles.statusBadge, isOpen ? styles.statusOpen : styles.statusClosed]}>
              <Text style={[styles.statusText, isOpen ? styles.statusTextOpen : styles.statusTextClosed]}>
                {isOpen ? 'OPEN' : 'CLOSED'}
              </Text>
            </View>
          </View>
          <Text style={styles.positionMeta}>
            {item.totalShares.toFixed(4)} shares · {item.holdDurationDays}d
          </Text>
          <Text style={styles.positionMeta}>
            Avg: {formatCurrency(item.avgCostBasis)} · Invested: {formatCurrency(item.totalInvested)}
          </Text>
        </View>
        <View style={styles.positionRight}>
          {!isOpen && (
            <Text style={[styles.realizedPnl, { color: pnlColor }]}>
              {item.realizedPnl >= 0 ? '+' : ''}{formatCurrency(item.realizedPnl)}
            </Text>
          )}
          <Feather name="chevron-right" size={16} color={colors.textMuted} />
        </View>
      </Pressable>
    );
  };

  return (
    <View style={[styles.container, { paddingBottom: Platform.OS === 'web' ? 40 : insets.bottom }]}>
      {/* Summary bar */}
      <Card style={styles.summaryCard}>
        <Text style={styles.sleeveName}>{sleeve.accountName}</Text>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Total Realized P&L</Text>
            <Text style={[styles.summaryValue, { color: sleeve.totalRealizedPnl >= 0 ? colors.positive : colors.negative }]}>
              {sleeve.totalRealizedPnl >= 0 ? '+' : ''}{formatCurrency(sleeve.totalRealizedPnl)}
            </Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Positions</Text>
            <Text style={styles.summaryValue}>{sleeve.totalPositions}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Win Rate</Text>
            <Text style={[styles.summaryValue, { color: sleeve.winRate >= 50 ? colors.positive : colors.negative }]}>
              {sleeve.closedPositions > 0 ? `${sleeve.winRate.toFixed(0)}%` : '—'}
            </Text>
          </View>
        </View>
        <View style={styles.countRow}>
          <Text style={styles.countChip}>{sleeve.openPositions} open</Text>
          <Text style={styles.countChip}>{sleeve.closedPositions} closed</Text>
        </View>
      </Card>

      {sections.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No position history found</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => String(item.positionId)}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{section.title}</Text>
            </View>
          )}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textMuted },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.surface },
  retryText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: colors.primary },
  summaryCard: { margin: 16, gap: 12 },
  sleeveName: { fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.textPrimary },
  summaryRow: { flexDirection: 'row', gap: 16 },
  summaryItem: { flex: 1 },
  summaryLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted, marginBottom: 2 },
  summaryValue: { fontFamily: 'Inter_700Bold', fontSize: 16, color: colors.textPrimary },
  countRow: { flexDirection: 'row', gap: 8 },
  countChip: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: colors.textSecondary,
    backgroundColor: colors.separator + '66',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 20 },
  sectionHeader: { paddingVertical: 10 },
  sectionHeaderText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: colors.textPrimary },
  positionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 0.5,
    borderColor: colors.separator,
  },
  positionLeft: { flex: 1, gap: 4 },
  positionTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ticker: { fontFamily: 'Inter_700Bold', fontSize: 16, color: colors.textPrimary },
  statusBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, borderWidth: 1 },
  statusOpen: { backgroundColor: colors.positive + '22', borderColor: colors.positive + '66' },
  statusClosed: { backgroundColor: colors.textMuted + '22', borderColor: colors.textMuted + '44' },
  statusText: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.5 },
  statusTextOpen: { color: colors.positive },
  statusTextClosed: { color: colors.textMuted },
  positionMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textMuted },
  positionRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  realizedPnl: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textMuted },
});
