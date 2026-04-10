import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, FlatList, Platform, Pressable, ActivityIndicator, Modal } from 'react-native';
import { useLocalSearchParams, useNavigation, router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { colors } from '@/constants/colors';
import { usePortfolio, Position, apiPut } from '@/context/PortfolioContext';
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

const EXIT_REASONS = [
  { key: 'IPS_RULE',        label: 'IPS Rule'        },
  { key: 'STOP_LOSS',       label: 'Stop Loss'        },
  { key: 'ALERT_TRIGGERED', label: 'Alert Triggered'  },
  { key: 'MANUAL',          label: 'Manual'           },
  { key: 'CUT_LIST',        label: 'Cut List'         },
] as const;

type ExitReason = typeof EXIT_REASONS[number]['key'];

function exitReasonColor(reason: ExitReason): string {
  switch (reason) {
    case 'IPS_RULE':        return '#9B59B6';
    case 'STOP_LOSS':       return colors.negative;
    case 'ALERT_TRIGGERED': return '#F5A623';
    case 'MANUAL':          return colors.textMuted;
    case 'CUT_LIST':        return colors.negative;
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

interface PositionHistoryDetail {
  positionId: number;
  ticker: string;
  accountId: number;
  status: 'open' | 'closed';
  totalShares: number;
  avgCostBasis: number;
  totalInvested: number;
  realizedPnl: number;
  unrealizedPnl: number | null;
  currentPrice: number | null;
  firstEntryDate: string | null;
  lastActivityDate: string | null;
  holdDurationDays: number;
  exitReason: string | null;
  transactions: HistoryActivity[];
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
  const [exitReasonPickerVisible, setExitReasonPickerVisible] = useState(false);
  const [savingExitReason, setSavingExitReason] = useState(false);

  const position = positions.find(p => p.id === posId);
  const account = position ? accounts.find(a => a.id === position.accountId) : null;

  // History detail from aggregation endpoint
  const { data: historyDetail, isLoading: historyDetailLoading, refetch: refetchHistoryDetail } = useQuery<PositionHistoryDetail>({
    queryKey: ['position-history-detail', posId],
    queryFn: () => {
      if (!position) throw new Error('No position');
      return apiGet(`/positions/history/${position.symbol}?accountId=${position.accountId}`);
    },
    enabled: !!position,
  });

  // Transaction list (from the historyDetail or fallback to old endpoint)
  const { data: historyData, isLoading: historyLoading, isError: historyError, refetch: refetchHistory } = useQuery<HistoryActivity[]>({
    queryKey: ['position-history', posId],
    queryFn: () => apiGet(`/positions/${posId}/history`),
    enabled: activeTab === 'history' && !historyDetail,
  });

  useFocusEffect(
    useCallback(() => {
      if (activeTab === 'history') {
        refetchHistory();
      }
    }, [activeTab, refetchHistory]),
  );

  React.useEffect(() => {
    if (position) navigation.setOptions({ title: position.symbol });
  }, [position]);

  // ── Derived metrics ──────────────────────────────────────────────────────────

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

  const showTriggerLevels = true;

  const { concentrationRule, drawdownRule } = defaultStrategyProfile;
  const concWarnPct  = concentrationRule.warningPct  * 100;
  const concCritPct  = concentrationRule.criticalPct * 100;
  const ddWarnPct    = drawdownRule.warningPct  * 100;
  const ddCritPct    = drawdownRule.criticalPct * 100;

  // Status from aggregation
  const positionStatus = historyDetail?.status ?? 'open';
  const isOpen = positionStatus === 'open';

  // Exit reason (from historyDetail, optimistically updated)
  const [localExitReason, setLocalExitReason] = React.useState<string | null>(null);
  const exitReason = localExitReason !== null ? localExitReason : (historyDetail?.exitReason ?? null);

  const handleSaveExitReason = async (reason: ExitReason | null) => {
    if (!position) return;
    setSavingExitReason(true);
    setLocalExitReason(reason);
    setExitReasonPickerVisible(false);
    try {
      await apiPut(`/positions/${position.id}`, { exitReason: reason });
      queryClient.invalidateQueries({ queryKey: ['position-history-detail', posId] });
    } catch {
      setLocalExitReason(null); // revert on failure
    } finally {
      setSavingExitReason(false);
    }
  };

  if (!position) {
    return (
      <View style={styles.container}>
        <Text style={styles.notFound}>Position not found</Text>
      </View>
    );
  }

  // Transactions to display: prefer historyDetail.transactions, fallback to historyData
  const transactions: HistoryActivity[] = historyDetail?.transactions ?? historyData ?? [];

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
                <View style={styles.symbolRow}>
                  <Text style={styles.symbol}>{position.symbol}</Text>
                  {/* Status badge */}
                  <View style={[styles.statusBadge, isOpen ? styles.statusOpen : styles.statusClosed]}>
                    <Text style={[styles.statusText, isOpen ? styles.statusTextOpen : styles.statusTextClosed]}>
                      {isOpen ? 'OPEN' : 'CLOSED'}
                    </Text>
                  </View>
                </View>
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
            {isOpen ? (
              <>
                <Text style={styles.marketValue}>{formatCurrency(position.marketValue)}</Text>
                <PnlBadge value={position.unrealizedPnl} percentage={position.unrealizedPnlPct} size="md" />
              </>
            ) : (
              <Text style={styles.marketValue}>{formatCurrency(0)}</Text>
            )}
          </Card>

          {/* 2. Position Summary Card */}
          <Card style={styles.summaryCard}>
            <Text style={styles.cardSectionLabel}>Position Summary</Text>
            <View style={styles.summaryGrid}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Avg Cost Basis</Text>
                <Text style={styles.summaryValue}>
                  {historyDetailLoading ? '...' : formatCurrency(historyDetail?.avgCostBasis ?? position.avgCost)}
                </Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Total Shares</Text>
                <Text style={styles.summaryValue}>
                  {historyDetail?.totalShares.toFixed(4) ?? position.quantity.toFixed(4)}
                </Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Total Invested</Text>
                <Text style={styles.summaryValue}>
                  {historyDetailLoading ? '...' : formatCurrency(historyDetail?.totalInvested ?? position.quantity * position.avgCost)}
                </Text>
              </View>
              {historyDetail && (
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Realized P&L</Text>
                  <Text style={[styles.summaryValue, { color: historyDetail.realizedPnl >= 0 ? colors.positive : colors.negative }]}>
                    {formatCurrency(historyDetail.realizedPnl)}
                  </Text>
                </View>
              )}
              {isOpen && historyDetail?.unrealizedPnl != null && (
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Unrealized P&L</Text>
                  <Text style={[styles.summaryValue, { color: historyDetail.unrealizedPnl >= 0 ? colors.positive : colors.negative }]}>
                    {formatCurrency(historyDetail.unrealizedPnl)}
                  </Text>
                </View>
              )}
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Hold Duration</Text>
                <Text style={styles.summaryValue}>
                  {historyDetailLoading ? '...' : `${historyDetail?.holdDurationDays ?? 0} days`}
                </Text>
              </View>
              {!isOpen && historyDetail && (
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Result</Text>
                  <Text style={[styles.summaryValue, { color: historyDetail.realizedPnl >= 0 ? colors.positive : colors.negative }]}>
                    {historyDetail.realizedPnl >= 0 ? 'Win' : 'Loss'}
                  </Text>
                </View>
              )}
            </View>
          </Card>

          {/* 3. Exit Reason (if closed) */}
          {!isOpen && (
            <Card style={styles.exitReasonCard}>
              <View style={styles.exitReasonRow}>
                <Text style={styles.exitReasonLabel}>Exit Reason</Text>
                {exitReason ? (
                  <View style={[styles.exitReasonBadge, { backgroundColor: exitReasonColor(exitReason as ExitReason) + '22', borderColor: exitReasonColor(exitReason as ExitReason) + '66' }]}>
                    <Text style={[styles.exitReasonBadgeText, { color: exitReasonColor(exitReason as ExitReason) }]}>
                      {EXIT_REASONS.find(r => r.key === exitReason)?.label ?? exitReason}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.exitReasonEmpty}>Not set</Text>
                )}
                <Pressable
                  style={styles.exitReasonEditBtn}
                  onPress={() => setExitReasonPickerVisible(true)}
                  disabled={savingExitReason}
                  hitSlop={8}
                >
                  {savingExitReason
                    ? <ActivityIndicator size="small" color={colors.textMuted} />
                    : <Feather name="edit-2" size={14} color={colors.textMuted} />
                  }
                </Pressable>
              </View>
            </Card>
          )}

          {/* 4. Trigger Levels */}
          {showTriggerLevels && isOpen && (
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

          {/* 5. Cross-Account Exposure */}
          <CrossAccountExposureCard
            symbol={position.symbol}
            entries={crossAccountEntries}
          />

          {/* 6. Reference stats */}
          <View style={styles.statsGrid}>
            <Card style={styles.statCard}>
              <Text style={styles.statLabel}>Quantity</Text>
              <Text style={styles.statValue}>{position.quantity}</Text>
            </Card>
            <Card style={styles.statCard}>
              <Text style={styles.statLabel}>Avg Cost</Text>
              <Text style={styles.statValue}>{formatCurrency(position.avgCost)}</Text>
            </Card>
            <Card style={styles.statCard}>
              <Text style={styles.statLabel}>Current Price</Text>
              <Text style={styles.statValue}>{formatCurrency(position.currentPrice)}</Text>
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

          {isOpen && (
            <Pressable
              style={styles.chartBtn}
              onPress={() => router.push({ pathname: '/chart/[symbol]', params: { symbol: position.symbol, avgCost: String(position.avgCost), accountId: String(position.accountId) } })}
            >
              <Feather name="trending-up" size={18} color={colors.background} />
              <Text style={styles.chartBtnText}>View Chart</Text>
            </Pressable>
          )}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, paddingBottom: Platform.OS === 'web' ? 40 : insets.bottom }}>
          {(historyLoading && !historyDetail) ? (
            <View style={styles.historyEmpty}>
              <ActivityIndicator color={colors.textMuted} />
            </View>
          ) : historyError && !historyDetail ? (
            <View style={styles.historyEmpty}>
              <Text style={styles.historyEmptyText}>Could not load history</Text>
              <Pressable onPress={() => refetchHistory()} style={styles.retryBtn}>
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : transactions.length === 0 ? (
            <View style={styles.historyEmpty}>
              <Text style={styles.historyEmptyText}>No transactions recorded</Text>
            </View>
          ) : (
            <FlatList
              data={transactions}
              keyExtractor={item => String(item.id)}
              contentContainerStyle={styles.historyList}
              ListHeaderComponent={
                <Text style={styles.historyHeader}>Transactions</Text>
              }
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
                            {isSell ? '+' : '−'}{formatCurrency(Math.abs(item.totalAmount))}
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

      {/* Exit Reason Picker Modal */}
      <Modal visible={exitReasonPickerVisible} animationType="slide" presentationStyle="pageSheet" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Exit Reason</Text>
            <Text style={styles.modalSub}>Why was this position closed?</Text>
            {EXIT_REASONS.map(reason => (
              <Pressable
                key={reason.key}
                style={[styles.reasonRow, exitReason === reason.key && styles.reasonRowSelected]}
                onPress={() => handleSaveExitReason(reason.key)}
              >
                <View style={[styles.reasonDot, { backgroundColor: exitReasonColor(reason.key) }]} />
                <Text style={[styles.reasonText, exitReason === reason.key && styles.reasonTextSelected]}>
                  {reason.label}
                </Text>
                {exitReason === reason.key && <Feather name="check" size={16} color={colors.primary} />}
              </Pressable>
            ))}
            {exitReason && (
              <Pressable style={styles.clearBtn} onPress={() => handleSaveExitReason(null)}>
                <Text style={styles.clearText}>Clear exit reason</Text>
              </Pressable>
            )}
            <Pressable style={styles.cancelBtn} onPress={() => setExitReasonPickerVisible(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  historyEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  historyEmptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textMuted },
  historyHeader: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: 12,
  },
  retryBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.surface },
  retryText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.primary },
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
  symbolRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  statusOpen: { backgroundColor: colors.positive + '22', borderColor: colors.positive + '66' },
  statusClosed: { backgroundColor: colors.textMuted + '22', borderColor: colors.textMuted + '44' },
  statusText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.5 },
  statusTextOpen: { color: colors.positive },
  statusTextClosed: { color: colors.textMuted },
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
  // Summary card
  summaryCard: { gap: 12 },
  cardSectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.textMuted, letterSpacing: 0.3 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  summaryItem: { minWidth: '45%' },
  summaryLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted, marginBottom: 2 },
  summaryValue: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.textPrimary },
  // Exit reason
  exitReasonCard: {},
  exitReasonRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  exitReasonLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.textSecondary, flex: 1 },
  exitReasonBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1 },
  exitReasonBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  exitReasonEmpty: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textMuted, fontStyle: 'italic' },
  exitReasonEditBtn: { padding: 4 },
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
  // Exit reason modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.separator,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  modalSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  reasonRowSelected: {
    backgroundColor: colors.primary + '11',
  },
  reasonDot: { width: 8, height: 8, borderRadius: 4 },
  reasonText: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    color: colors.textPrimary,
  },
  reasonTextSelected: {
    color: colors.primary,
    fontFamily: 'Inter_600SemiBold',
  },
  clearBtn: {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.negative + '44',
    alignItems: 'center',
  },
  clearText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: colors.negative,
  },
  cancelBtn: {
    marginTop: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.separator,
    alignItems: 'center',
  },
  cancelText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: colors.textSecondary,
  },
});
