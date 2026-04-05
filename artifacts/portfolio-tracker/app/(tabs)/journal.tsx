import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, ScrollView,
  Pressable, RefreshControl, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { usePortfolio, apiGet, TradeActivity, Position } from '@/context/PortfolioContext';
import { formatPnl } from '@/components/ui/PnlBadge';

// ── Types ─────────────────────────────────────────────────────────────────────

type Verdict = 'right_decision' | 'wrong_decision' | 'too_early_to_tell';
type FilterKey = 'all' | 'right' | 'wrong' | 'pending' | 'violations';

interface Annotation {
  id: number;
  activityId: number;
  thesis: string | null;
  ipsAligned: boolean | null;
  plannedExit: string | null;
  verdict: Verdict | null;
  verdictNote: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AnnotatedTrade {
  activity: TradeActivity;
  annotation: Annotation;
}

interface SymbolGroup {
  symbol: string;
  positionBucket: string | null;
  allTrades: AnnotatedTrade[];   // unfiltered — used for P&L and verdict counts
  realizedPnl: number;
  unrealizedPnl: number | null;
  hasOpenPosition: boolean;
  latestDate: string;
  verdictCounts: { right: number; wrong: number; pending: number };
  ipsViolationCount: number;
}

// ── P&L helpers ───────────────────────────────────────────────────────────────

interface FifoResult { realizedPnl: number; openQty: number; openCostBasis: number }

function fifoPnlForAccount(trades: TradeActivity[]): FifoResult {
  const sorted = trades
    .filter(t => (t.activityType === 'buy' || t.activityType === 'sell')
      && t.quantity != null && t.price != null && t.quantity > 0 && t.price > 0)
    .sort((a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime());

  const lots: { qty: number; price: number }[] = [];
  let realizedPnl = 0;

  for (const t of sorted) {
    const qty = t.quantity!;
    const price = t.price!;
    if (t.activityType === 'buy') {
      lots.push({ qty, price });
    } else {
      let rem = qty;
      while (rem > 1e-8 && lots.length > 0) {
        const lot = lots[0];
        const matched = Math.min(rem, lot.qty);
        realizedPnl += matched * (price - lot.price);
        lot.qty -= matched;
        rem -= matched;
        if (lot.qty <= 1e-8) lots.shift();
      }
    }
  }

  const openQty = lots.reduce((s, l) => s + l.qty, 0);
  const openCostBasis = lots.reduce((s, l) => s + l.qty * l.price, 0);
  return { realizedPnl, openQty, openCostBasis };
}

function computeSymbolPnl(
  symbol: string,
  allActivities: TradeActivity[],
  positions: Position[],
): { realizedPnl: number; unrealizedPnl: number | null; hasOpenPosition: boolean } {
  const symbolTrades = allActivities.filter(a => a.symbol === symbol);
  const accountIds = [...new Set(symbolTrades.map(t => t.accountId))];

  let totalRealized = 0;
  let totalUnrealized: number | null = 0;
  let hasOpen = false;

  for (const accountId of accountIds) {
    const accountTrades = symbolTrades.filter(t => t.accountId === accountId);
    const { realizedPnl, openQty, openCostBasis } = fifoPnlForAccount(accountTrades);
    totalRealized += realizedPnl;

    if (openQty > 1e-8) {
      hasOpen = true;
      const pos = positions.find(p => p.symbol === symbol && p.accountId === accountId);
      if (pos) {
        totalUnrealized = (totalUnrealized ?? 0) + (openQty * pos.currentPrice - openCostBasis);
      } else {
        totalUnrealized = null; // can't estimate without a live price
      }
    }
  }

  return { realizedPnl: totalRealized, unrealizedPnl: totalUnrealized, hasOpenPosition: hasOpen };
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

const VERDICT_LABEL: Record<Verdict, string> = {
  right_decision:    'Right',
  wrong_decision:    'Wrong',
  too_early_to_tell: 'Early',
};
const VERDICT_COLOR: Record<Verdict, string> = {
  right_decision:    colors.positive,
  wrong_decision:    colors.negative,
  too_early_to_tell: colors.textMuted,
};

const BUCKET_COLOR: Record<string, string> = {
  cut:    colors.negative,
  spec:   '#F5A623',
  swing:  colors.primary,
  inc:    '#2DC5A2',
  core:   colors.positive,
  def:    colors.positive,
  anchor: colors.positive,
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',        label: 'All'           },
  { key: 'right',      label: 'Right'         },
  { key: 'wrong',      label: 'Wrong'         },
  { key: 'pending',    label: 'Pending'       },
  { key: 'violations', label: 'IPS Violations'},
];

function matchesFilter(ann: Annotation, filter: FilterKey): boolean {
  switch (filter) {
    case 'all':        return true;
    case 'right':      return ann.verdict === 'right_decision';
    case 'wrong':      return ann.verdict === 'wrong_decision';
    case 'pending':    return ann.verdict === null || ann.verdict === 'too_early_to_tell';
    case 'violations': return ann.ipsAligned === false;
  }
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function JournalScreen() {
  const insets = useSafeAreaInsets();
  const { activities, positions, isLoading, refreshAll } = usePortfolio();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loadingAnnotations, setLoadingAnnotations] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchAnnotations = useCallback(async () => {
    setLoadingAnnotations(true);
    try {
      const rows = await apiGet<Annotation[]>('/activities/annotations');
      setAnnotations(rows);
    } catch (err) {
      console.error('[Journal] fetch annotations failed:', err);
    } finally {
      setLoadingAnnotations(false);
    }
  }, []);

  useEffect(() => { fetchAnnotations(); }, []);

  const handleRefresh = useCallback(async () => {
    await Promise.all([refreshAll(), fetchAnnotations()]);
  }, [refreshAll, fetchAnnotations]);

  const toggleExpanded = useCallback((symbol: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(symbol) ? next.delete(symbol) : next.add(symbol);
      return next;
    });
  }, []);

  // ── Build symbol groups ────────────────────────────────────────────────────

  const symbolGroups = useMemo((): SymbolGroup[] => {
    if (!annotations.length) return [];

    const annotationMap = new Map<number, Annotation>(
      annotations.map(a => [a.activityId, a]),
    );

    const annotatedTrades: AnnotatedTrade[] = activities
      .filter(a => a.symbol && annotationMap.has(a.id))
      .map(a => ({ activity: a, annotation: annotationMap.get(a.id)! }));

    const groupMap = new Map<string, AnnotatedTrade[]>();
    for (const t of annotatedTrades) {
      const sym = t.activity.symbol!;
      if (!groupMap.has(sym)) groupMap.set(sym, []);
      groupMap.get(sym)!.push(t);
    }

    return Array.from(groupMap.entries())
      .map(([symbol, trades]) => {
        const sorted = [...trades].sort(
          (a, b) => new Date(a.activity.tradeDate).getTime() - new Date(b.activity.tradeDate).getTime(),
        );

        const { realizedPnl, unrealizedPnl, hasOpenPosition } =
          computeSymbolPnl(symbol, activities, positions);

        const positionBucket = positions.find(p => p.symbol === symbol)?.positionBucket ?? null;

        const verdictCounts = { right: 0, wrong: 0, pending: 0 };
        let ipsViolationCount = 0;
        for (const { annotation: ann } of sorted) {
          if (ann.verdict === 'right_decision')    verdictCounts.right++;
          else if (ann.verdict === 'wrong_decision') verdictCounts.wrong++;
          else                                       verdictCounts.pending++;
          if (ann.ipsAligned === false) ipsViolationCount++;
        }

        return {
          symbol,
          positionBucket,
          allTrades: sorted,
          realizedPnl,
          unrealizedPnl,
          hasOpenPosition,
          latestDate: sorted.at(-1)?.activity.tradeDate ?? '',
          verdictCounts,
          ipsViolationCount,
        };
      })
      .sort((a, b) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime());
  }, [annotations, activities, positions]);

  // ── Header summary stats ──────────────────────────────────────────────────

  const stats = useMemo(() => {
    const total = annotations.length;
    const withVerdict = annotations.filter(a => a.verdict !== null);
    const right = withVerdict.filter(a => a.verdict === 'right_decision').length;
    const pctRight = withVerdict.length > 0 ? Math.round(right / withVerdict.length * 100) : null;

    const withIps = annotations.filter(a => a.ipsAligned !== null);
    const aligned = withIps.filter(a => a.ipsAligned === true).length;
    const pctAligned = withIps.length > 0 ? Math.round(aligned / withIps.length * 100) : null;

    return { total, pctRight, pctAligned };
  }, [annotations]);

  // ── Apply filter ──────────────────────────────────────────────────────────

  const filteredGroups = useMemo(() => {
    if (filter === 'all') return symbolGroups;
    return symbolGroups
      .map(g => ({ ...g, allTrades: g.allTrades.filter(t => matchesFilter(t.annotation, filter)) }))
      .filter(g => g.allTrades.length > 0);
  }, [symbolGroups, filter]);

  // ── Render ────────────────────────────────────────────────────────────────

  const isRefreshing = isLoading || loadingAnnotations;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Trade Journal</Text>
      </View>

      {/* Summary row */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryValue}>{stats.total}</Text>
          <Text style={styles.summaryLabel}>Annotated</Text>
        </View>
        <View style={[styles.summaryCard, styles.summaryCardMid]}>
          <Text style={[styles.summaryValue, { color: stats.pctRight != null ? colors.positive : colors.textMuted }]}>
            {stats.pctRight != null ? `${stats.pctRight}%` : '—'}
          </Text>
          <Text style={styles.summaryLabel}>Right decisions</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={[styles.summaryValue, { color: stats.pctAligned != null ? colors.primary : colors.textMuted }]}>
            {stats.pctAligned != null ? `${stats.pctAligned}%` : '—'}
          </Text>
          <Text style={styles.summaryLabel}>IPS aligned</Text>
        </View>
      </View>

      {/* Filter bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterBar}
        style={styles.filterScroll}
      >
        {FILTERS.map(f => (
          <Pressable
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterChipText, filter === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Symbol group list */}
      <FlatList
        data={filteredGroups}
        keyExtractor={g => g.symbol}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
        contentContainerStyle={[
          styles.list,
          { paddingBottom: Platform.OS === 'web' ? 100 : insets.bottom + 90 },
        ]}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Feather name="book-open" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>
              {annotations.length === 0 ? 'No journal entries yet' : 'No trades match this filter'}
            </Text>
            <Text style={styles.emptyText}>
              {annotations.length === 0
                ? 'Tap the journal icon on any trade in the Activity tab to add notes.'
                : 'Try a different filter.'}
            </Text>
          </View>
        }
        renderItem={({ item: group }) => (
          <SymbolGroupCard
            group={group}
            isExpanded={expanded.has(group.symbol)}
            onToggle={() => toggleExpanded(group.symbol)}
          />
        )}
      />
    </View>
  );
}

// ── Symbol group card ─────────────────────────────────────────────────────────

interface SymbolGroupCardProps {
  group: SymbolGroup;
  isExpanded: boolean;
  onToggle: () => void;
}

function SymbolGroupCard({ group, isExpanded, onToggle }: SymbolGroupCardProps) {
  const { right, wrong, pending } = group.verdictCounts;
  const showUnrealized = group.hasOpenPosition && group.unrealizedPnl !== null;
  const bucketColor = group.positionBucket ? (BUCKET_COLOR[group.positionBucket] ?? colors.textMuted) : null;

  return (
    <View style={styles.groupCard}>
      <Pressable style={styles.groupHeader} onPress={onToggle}>
        {/* Left: symbol + bucket badge */}
        <View style={styles.groupLeft}>
          <View style={styles.groupTitleRow}>
            <Text style={styles.groupSymbol}>{group.symbol}</Text>
            {group.positionBucket && bucketColor && (
              <View style={[styles.bucketBadge, { backgroundColor: bucketColor + '22', borderColor: bucketColor + '55' }]}>
                <Text style={[styles.bucketBadgeText, { color: bucketColor }]}>
                  {group.positionBucket.toUpperCase()}
                </Text>
              </View>
            )}
            {group.ipsViolationCount > 0 && (
              <View style={styles.violationBadge}>
                <Text style={styles.violationBadgeText}>IPS ✗</Text>
              </View>
            )}
          </View>
          <Text style={styles.groupMeta}>
            {group.allTrades.length} trade{group.allTrades.length !== 1 ? 's' : ''}
          </Text>
        </View>

        {/* Right: P&L + chevron */}
        <View style={styles.groupRight}>
          <View style={styles.pnlBlock}>
            {showUnrealized ? (
              <>
                <Text style={styles.pnlLabel}>Unrealized</Text>
                <Text style={[styles.pnlValue, { color: (group.unrealizedPnl ?? 0) >= 0 ? colors.positive : colors.negative }]}>
                  {formatPnl(group.unrealizedPnl!)}
                </Text>
                {group.realizedPnl !== 0 && (
                  <Text style={styles.pnlSub}>{formatPnl(group.realizedPnl)} realized</Text>
                )}
              </>
            ) : group.realizedPnl !== 0 ? (
              <>
                <Text style={styles.pnlLabel}>Realized</Text>
                <Text style={[styles.pnlValue, { color: group.realizedPnl >= 0 ? colors.positive : colors.negative }]}>
                  {formatPnl(group.realizedPnl)}
                </Text>
                {group.hasOpenPosition && group.unrealizedPnl === null && (
                  <Text style={styles.pnlSub}>+ open</Text>
                )}
              </>
            ) : (
              <Text style={styles.pnlDash}>—</Text>
            )}
          </View>
          <Feather
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
            style={styles.chevron}
          />
        </View>
      </Pressable>

      {/* Verdict summary chips */}
      <View style={styles.verdictRow}>
        {right > 0 && (
          <View style={[styles.verdictChip, { backgroundColor: colors.positive + '18' }]}>
            <Text style={[styles.verdictChipText, { color: colors.positive }]}>{right} right</Text>
          </View>
        )}
        {wrong > 0 && (
          <View style={[styles.verdictChip, { backgroundColor: colors.negative + '18' }]}>
            <Text style={[styles.verdictChipText, { color: colors.negative }]}>{wrong} wrong</Text>
          </View>
        )}
        {pending > 0 && (
          <View style={[styles.verdictChip, { backgroundColor: colors.separator }]}>
            <Text style={[styles.verdictChipText, { color: colors.textMuted }]}>{pending} pending</Text>
          </View>
        )}
      </View>

      {/* Expanded trade rows */}
      {isExpanded && (
        <View style={styles.tradeList}>
          {group.allTrades.map((t, i) => (
            <TradeRow
              key={t.activity.id}
              trade={t}
              isLast={i === group.allTrades.length - 1}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// ── Individual trade row ──────────────────────────────────────────────────────

function TradeRow({ trade, isLast }: { trade: AnnotatedTrade; isLast: boolean }) {
  const { activity: act, annotation: ann } = trade;
  const isBuy = act.activityType === 'buy';
  const typeColor = isBuy ? colors.positive : colors.negative;

  return (
    <View style={[styles.tradeRow, !isLast && styles.tradeRowBorder]}>
      {/* Top line: date + type + qty @ price */}
      <View style={styles.tradeTopRow}>
        <Text style={styles.tradeDate}>{fmtDate(act.tradeDate)}</Text>
        <View style={[styles.typeBadge, { backgroundColor: typeColor + '20' }]}>
          <Text style={[styles.typeBadgeText, { color: typeColor }]}>
            {act.activityType.toUpperCase()}
          </Text>
        </View>
        {act.quantity != null && act.price != null && (
          <Text style={styles.tradeQtyPrice}>
            {act.quantity} @ ${act.price.toFixed(2)}
          </Text>
        )}
      </View>

      {/* Thesis */}
      {ann.thesis && (
        <Text style={styles.tradethesis} numberOfLines={1} ellipsizeMode="tail">
          {ann.thesis}
        </Text>
      )}

      {/* Bottom: IPS badge + verdict badge */}
      <View style={styles.tradeBadgeRow}>
        {ann.ipsAligned !== null && (
          <View style={[
            styles.ipsBadge,
            ann.ipsAligned
              ? { backgroundColor: colors.positive + '18', borderColor: colors.positive + '44' }
              : { backgroundColor: '#F5A623' + '18', borderColor: '#F5A62344' },
          ]}>
            <Text style={[styles.ipsBadgeText, { color: ann.ipsAligned ? colors.positive : '#F5A623' }]}>
              IPS {ann.ipsAligned ? '✓' : '✗'}
            </Text>
          </View>
        )}
        {ann.verdict && (
          <View style={[styles.verdictBadge, { backgroundColor: VERDICT_COLOR[ann.verdict] + '18', borderColor: VERDICT_COLOR[ann.verdict] + '44' }]}>
            <Text style={[styles.verdictBadgeText, { color: VERDICT_COLOR[ann.verdict] }]}>
              {VERDICT_LABEL[ann.verdict]}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    paddingTop: 4,
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, color: colors.textPrimary },

  // Summary
  summaryRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 12,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.separator,
  },
  summaryCardMid: {},
  summaryValue: { fontFamily: 'Inter_700Bold', fontSize: 20, color: colors.textPrimary },
  summaryLabel: { fontFamily: 'Inter_400Regular', fontSize: 10, color: colors.textMuted, marginTop: 2, textAlign: 'center' },

  // Filter bar
  filterScroll: { maxHeight: 44, marginBottom: 8 },
  filterBar: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
  },
  filterChipActive: { borderColor: colors.primary, backgroundColor: colors.primary + '22' },
  filterChipText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.textSecondary },
  filterChipTextActive: { color: colors.primary },

  // List
  list: { paddingHorizontal: 16, paddingTop: 4 },

  // Group card
  groupCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.separator,
    marginBottom: 10,
    overflow: 'hidden',
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    gap: 8,
  },
  groupLeft: { flex: 1, gap: 4 },
  groupRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  groupTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  groupSymbol: { fontFamily: 'Inter_700Bold', fontSize: 17, color: colors.textPrimary },
  groupMeta: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted },
  bucketBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, borderWidth: 1 },
  bucketBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.4 },
  violationBadge: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5,
    backgroundColor: '#F5A623' + '22', borderWidth: 1, borderColor: '#F5A62355',
  },
  violationBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 9, color: '#F5A623' },
  pnlBlock: { alignItems: 'flex-end', gap: 1 },
  pnlLabel: { fontFamily: 'Inter_400Regular', fontSize: 9, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 },
  pnlValue: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  pnlSub: { fontFamily: 'Inter_400Regular', fontSize: 10, color: colors.textMuted },
  pnlDash: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textMuted },
  chevron: { marginLeft: 4 },

  // Verdict summary row
  verdictRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  verdictChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  verdictChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },

  // Trade list
  tradeList: {
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  tradeRow: { paddingHorizontal: 14, paddingVertical: 10, gap: 5 },
  tradeRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.separator + '80' },
  tradeTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  tradeDate: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  typeBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.4 },
  tradeQtyPrice: { fontFamily: 'Inter_500Medium', fontSize: 12, color: colors.textSecondary },
  tradethesis: {
    fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textSecondary,
    fontStyle: 'italic',
  },
  tradeBadgeRow: { flexDirection: 'row', gap: 6 },
  ipsBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, borderWidth: 1 },
  ipsBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  verdictBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, borderWidth: 1 },
  verdictBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },

  // Empty state
  emptyState: { alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18, color: colors.textSecondary },
  emptyText: {
    fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textMuted,
    textAlign: 'center', paddingHorizontal: 40,
  },
});
