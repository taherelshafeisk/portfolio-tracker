import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, FlatList, Platform, Pressable, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useNavigation, router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { colors } from '@/constants/colors';
import { usePortfolio, Position } from '@/context/PortfolioContext';
import { Card } from '@/components/ui/Card';
import { PnlBadge, formatCurrency } from '@/components/ui/PnlBadge';
import { defaultStrategyProfile } from '@workspace/portfolio-policy';
import { TriggerLevelsCard } from '@/components/position/TriggerLevelsCard';
import { CrossAccountExposureCard, ExposureEntry } from '@/components/position/CrossAccountExposureCard';
import { EditPolicyModal } from '@/components/position/EditPolicyModal';
import { apiGet } from '@/context/PortfolioContext';

function bucketColor(bucket: string): string {
  switch (bucket) {
    case 'cut':   return colors.negative;
    case 'spec':  return '#F5A623';
    case 'swing': return colors.primary;
    case 'inc':   return '#2DC5A2';
    default:      return colors.positive; // core, def, anchor
  }
}

function actionColor(action: string): string {
  switch (action) {
    case 'cut':
    case 'exit':    return colors.negative;
    case 'trim':    return '#F5A623';
    case 'monitor': return '#D4A017';
    case 'add':     return '#2DC5A2';
    default:        return colors.textMuted; // hold
  }
}

interface HistoryActivity {
  id: number;
  activityType: string;
  quantity?: number;
  price?: number;
  totalAmount?: number;
  notes?: string;
  tradeDate: string;
}

export default function PositionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const posId = parseInt(id);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { positions, accounts } = usePortfolio();
  const queryClient = useQueryClient();
  const [editPolicyVisible, setEditPolicyVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'history'>('overview');

  const { data: historyData, isLoading: historyLoading, isError: historyError, refetch: refetchHistory } = useQuery<HistoryActivity[]>({
    queryKey: ['position-history', posId],
    queryFn: () => apiGet(`/positions/${posId}/history`),
    enabled: activeTab === 'history',
  });

  useFocusEffect(
    useCallback(() => {
      if (activeTab === 'history') {
        refetchHistory();
      }
    }, [activeTab, refetchHistory]),
  );

  const position = positions.find(p => p.id === posId);
  const account = position ? accounts.find(a => a.id === position.accountId) : null;

  React.useEffect(() => {
    if (position) navigation.setOptions({ title: position.symbol });
  }, [position]);

  // ── Derived metrics ──────────────────────────────────────────────────────────

  // Account NAV = sum of all positions in this account + cash balance
  const accountNAV = React.useMemo(() => {
    if (!position || !account) return 0;
    const positionsValue = positions
      .filter(p => p.accountId === position.accountId)
      .reduce((sum, p) => sum + p.marketValue, 0);
    return positionsValue + account.currentBalance;
  }, [positions, position, account]);

  const concentrationPct = accountNAV > 0 && position
    ? (position.marketValue / accountNAV) * 100
    : 0;

  // Cross-account: same symbol held in multiple accounts
  const crossAccountEntries: ExposureEntry[] = React.useMemo(() => {
    if (!position) return [];
    return positions
      .filter(p => p.symbol === position.symbol)
      .map(p => {
        const acc = accounts.find(a => a.id === p.accountId);
        return {
          accountId: p.accountId,
          accountName: acc?.name ?? `Account ${p.accountId}`,
          quantity: p.quantity,
          marketValue: p.marketValue,
        };
      });
  }, [positions, accounts, position]);

  // TriggerLevelsCard: always show since it provides useful policy context
  const showTriggerLevels = true;

  // Policy thresholds as display percentages
  const { concentrationRule, drawdownRule } = defaultStrategyProfile;
  const concWarnPct  = concentrationRule.warningPct  * 100;   // 20
  const concCritPct  = concentrationRule.criticalPct * 100;   // 30
  const ddWarnPct    = drawdownRule.warningPct  * 100;        // -15
  const ddCritPct    = drawdownRule.criticalPct * 100;        // -25

  if (!position) {
    return (
      <View style={styles.container}>
        <Text style={styles.notFound}>Position not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(['overview', 'history'] as const).map(tab => (
          <Pressable
            key={tab}
            style={[styles.tabItem, activeTab === tab && styles.tabItemActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'overview' ? 'Overview' : 'History'}
            </Text>
          </Pressable>
        ))}
      </View>

      {activeTab === 'overview' ? (
        <ScrollView
          contentContainerStyle={[styles.scroll, {
            paddingBottom: Platform.OS === 'web' ? 40 : (insets.bottom + 24)
          }]}
        >
          {/* 1. Header */}
          <Card style={styles.headerCard}>
            <View style={styles.headerTop}>
              <View style={styles.headerTitles}>
                <Text style={styles.symbol}>{position.symbol}</Text>
                <Text style={styles.name}>{position.name}</Text>
                {account && <Text style={styles.account}>in {account.name}</Text>}
              </View>
              <View style={styles.policyBadges}>
                {position.positionBucket && (
                  <View style={[styles.bucketBadge, { backgroundColor: bucketColor(position.positionBucket) + '22', borderColor: bucketColor(position.positionBucket) + '66' }]}>
                    <Text style={[styles.bucketBadgeText, { color: bucketColor(position.positionBucket) }]}>
                      {position.positionBucket.toUpperCase()}
                    </Text>
                  </View>
                )}
                {position.ipsAction && (
                  <View style={[styles.actionBadge, { backgroundColor: actionColor(position.ipsAction) + '22', borderColor: actionColor(position.ipsAction) + '66' }]}>
                    <Text style={[styles.actionBadgeText, { color: actionColor(position.ipsAction) }]}>
                      {position.ipsAction.toUpperCase()}
                    </Text>
                  </View>
                )}
                {(position.positionBucket || position.ipsAction) ? (
                  <Pressable style={styles.editPolicyIcon} onPress={() => setEditPolicyVisible(true)} hitSlop={8}>
                    <Feather name="edit-2" size={12} color={colors.textMuted} />
                  </Pressable>
                ) : (
                  <Pressable style={styles.addPolicyLink} onPress={() => setEditPolicyVisible(true)}>
                    <Text style={styles.addPolicyText}>+ Add Policy</Text>
                  </Pressable>
                )}
              </View>
            </View>
            <Text style={styles.marketValue}>{formatCurrency(position.marketValue)}</Text>
            <PnlBadge value={position.unrealizedPnl} percentage={position.unrealizedPnlPct} size="md" />
          </Card>

          {/* 2. Trigger Levels */}
          {showTriggerLevels && (
            <TriggerLevelsCard
              concentrationPct={concentrationPct}
              drawdownPct={position.unrealizedPnlPct}
              concWarnPct={concWarnPct}
              concCritPct={concCritPct}
              ddWarnPct={ddWarnPct}
              ddCritPct={ddCritPct}
              currentPrice={position.currentPrice}
              stopPrice={position.stopPrice != null ? Number(position.stopPrice) : undefined}
              ipsAction={position.ipsAction ?? undefined}
              addZoneLow={position.addZoneLow != null ? Number(position.addZoneLow) : undefined}
              addZoneHigh={position.addZoneHigh != null ? Number(position.addZoneHigh) : undefined}
            />
          )}

          {/* 3. Cross-Account Exposure — only when symbol held in 2+ accounts */}
          <CrossAccountExposureCard
            symbol={position.symbol}
            entries={crossAccountEntries}
          />

          {/* 4. Reference stats */}
          <View style={styles.statsGrid}>
            <Card style={styles.statCard}>
              <Text style={styles.statLabel}>Quantity</Text>
              <Text style={styles.statValue}>{position.quantity}</Text>
            </Card>
            <Card style={styles.statCard}>
              <Text style={styles.statLabel}>Avg Cost</Text>
              <Text style={styles.statValue}>${position.avgCost.toFixed(2)}</Text>
            </Card>
            <Card style={styles.statCard}>
              <Text style={styles.statLabel}>Current Price</Text>
              <Text style={styles.statValue}>${position.currentPrice.toFixed(2)}</Text>
            </Card>
            <Card style={styles.statCard}>
              <Text style={styles.statLabel}>Cost Basis</Text>
              <Text style={styles.statValue}>{formatCurrency(position.quantity * position.avgCost)}</Text>
            </Card>
          </View>

          {position.sector && (
            <Card>
              <Text style={styles.statLabel}>Sector</Text>
              <Text style={styles.statValue}>{position.sector}</Text>
            </Card>
          )}

          {position.policyNote && (
            <Card>
              <Text style={styles.statLabel}>Policy Note</Text>
              <Text style={styles.notes}>{position.policyNote}</Text>
            </Card>
          )}

          {position.notes && (
            <Card>
              <Text style={styles.statLabel}>Notes</Text>
              <Text style={styles.notes}>{position.notes}</Text>
            </Card>
          )}

          <Pressable
            style={styles.chartBtn}
            onPress={() => router.push({ pathname: '/chart/[symbol]', params: { symbol: position.symbol, avgCost: String(position.avgCost), accountId: String(position.accountId) } })}
          >
            <Feather name="trending-up" size={18} color={colors.background} />
            <Text style={styles.chartBtnText}>View Chart</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingBottom: Platform.OS === 'web' ? 40 : insets.bottom }}>
          {historyLoading ? (
            <View style={styles.historyEmpty}>
              <ActivityIndicator color={colors.textMuted} />
            </View>
          ) : historyError ? (
            <View style={styles.historyEmpty}>
              <Text style={styles.historyEmptyText}>Could not load history</Text>
            </View>
          ) : !historyData || historyData.length === 0 ? (
            <View style={styles.historyEmpty}>
              <Text style={styles.historyEmptyText}>No transactions recorded</Text>
            </View>
          ) : (
            <FlatList
              data={historyData}
              keyExtractor={item => String(item.id)}
              contentContainerStyle={styles.historyList}
              renderItem={({ item }) => {
                const isBuy = item.activityType === 'buy';
                const isSell = item.activityType === 'sell';
                const typeColor = isBuy ? colors.positive : isSell ? colors.negative : colors.textMuted;
                const date = new Date(item.tradeDate);
                const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                return (
                  <View style={styles.historyRow}>
                    <View style={[styles.historyTypeBadge, { backgroundColor: typeColor + '22', borderColor: typeColor + '55' }]}>
                      <Text style={[styles.historyTypeText, { color: typeColor }]}>
                        {item.activityType.toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.historyRowContent}>
                      <View style={styles.historyRowTop}>
                        {item.quantity != null && item.price != null && (
                          <Text style={styles.historyQtyPrice}>
                            {item.quantity} × {formatCurrency(item.price)}
                          </Text>
                        )}
                        {item.totalAmount != null && (
                          <Text style={[styles.historyTotal, { color: isSell ? colors.positive : colors.textPrimary }]}>
                            {isSell ? '+' : '−'}{formatCurrency(item.totalAmount)}
                          </Text>
                        )}
                      </View>
                      <Text style={styles.historyDate}>{dateStr}</Text>
                      {item.notes ? <Text style={styles.historyNotes}>{item.notes}</Text> : null}
                    </View>
                  </View>
                );
              }}
            />
          )}
        </View>
      )}

      <EditPolicyModal
        position={position}
        visible={editPolicyVisible}
        onClose={() => setEditPolicyVisible(false)}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['positions'] });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
    backgroundColor: colors.background,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabItemActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
  },
  tabText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: colors.textMuted,
  },
  tabTextActive: {
    color: colors.primary,
    fontFamily: 'Inter_600SemiBold',
  },
  scroll: { padding: 16, gap: 12 },
  historyList: { padding: 16, gap: 10 },
  historyEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  historyEmptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textMuted },
  historyRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  historyTypeBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginTop: 2 },
  historyTypeText: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.5 },
  historyRowContent: { flex: 1, gap: 3 },
  historyRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  historyQtyPrice: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textSecondary },
  historyTotal: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  historyDate: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textMuted },
  historyNotes: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textMuted, fontStyle: 'italic' },
  notFound: { fontFamily: 'Inter_400Regular', fontSize: 16, color: colors.textSecondary, textAlign: 'center', marginTop: 60 },
  headerCard: { marginBottom: 4, gap: 4 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerTitles: { flex: 1 },
  policyBadges: { flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginLeft: 8, marginTop: 4 },
  bucketBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  bucketBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.5 },
  actionBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  actionBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.5 },
  editPolicyIcon: { alignSelf: 'flex-end', marginTop: 2 },
  addPolicyLink: { marginTop: 4 },
  addPolicyText: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted },
  symbol: { fontFamily: 'Inter_700Bold', fontSize: 32, color: colors.textPrimary },
  name: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textSecondary },
  account: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textMuted, marginBottom: 8 },
  marketValue: { fontFamily: 'Inter_700Bold', fontSize: 28, color: colors.textPrimary, marginBottom: 4 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { flex: 1, minWidth: '45%' },
  statLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted, marginBottom: 4 },
  statValue: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.textPrimary },
  notes: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  chartBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: 14, padding: 16, marginTop: 8,
  },
  chartBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: colors.background },
});
