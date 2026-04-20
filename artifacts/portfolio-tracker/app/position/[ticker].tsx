import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Platform, Pressable,
  ActivityIndicator, TextInput, Dimensions,
} from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Path, Line, Rect, Defs,
  LinearGradient as SvgLinearGradient,
  Stop as SvgStop,
  Text as SvgText,
} from 'react-native-svg';
import { colors } from '@/constants/colors';
import { usePortfolio, apiPut, apiGet } from '@/context/PortfolioContext';
import { useAIContext } from '@/hooks/useAIContext';
import { Card } from '@/components/ui/Card';
import { formatCurrency } from '@/components/ui/PnlBadge';
import { computeActions, DEFAULT_CONCENTRATION_LIMIT } from '@/lib/actions';
import { suggestLevels } from '@/lib/suggestLevels';

// ─── Constants ────────────────────────────────────────────────────────────────

const { width: SCREEN_W } = Dimensions.get('window');
const CHART_W = SCREEN_W - 32;
const CHART_H = 180;
const VOL_H = 28;
const PAD = { top: 16, right: 10, bottom: 20, left: 50 };

const RANGES = [
  { label: '1D', range: '1d', interval: '5m' },
  { label: '5D', range: '5d', interval: '15m' },
  { label: '1M', range: '1mo', interval: '1d' },
  { label: '3M', range: '3mo', interval: '1d' },
  { label: '6M', range: '6mo', interval: '1d' },
  { label: '1Y', range: '1y', interval: '1wk' },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

interface MarketQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high52w?: number;
  low52w?: number;
  previousClose: number;
}

interface ChartData {
  timestamps: number[];
  closes: number[];
  volumes: number[];
}

interface HistoryTransaction {
  id: number;
  activityType: string;
  quantity: number | null;
  price: number | null;
  totalAmount: number | null;
  tradeDate: string;
  notes: string | null;
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
  holdDurationDays: number;
  transactions: HistoryTransaction[];
}

interface EnrichedTransaction extends HistoryTransaction {
  rowRealizedPnl?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bucketColor(bucket: string): string {
  switch (bucket.toLowerCase()) {
    case 'spec':   return '#F5A623';
    case 'swing':  return colors.primary;
    case 'cut':    return colors.negative;
    case 'inc':    return '#2DC5A2';
    default:       return colors.positive;
  }
}

/** Format share quantities: whole numbers as integers, fractional shares with up to 4 sig decimals. */
function fmtQty(qty: number): string {
  if (qty % 1 === 0) return qty.toFixed(0);
  // strip trailing zeros (e.g. 0.5000 → "0.5")
  return parseFloat(qty.toFixed(4)).toString();
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PositionDetailScreen() {
  const { ticker, accountId: accountIdParam } = useLocalSearchParams<{ ticker: string; accountId: string }>();
  const accountId = parseInt(accountIdParam);
  const insets = useSafeAreaInsets();
  const { positions, accounts, macroPosture } = usePortfolio();
  const { setAIContext } = useAIContext();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'overview' | 'history'>('overview');
  const [selectedRange, setSelectedRange] = useState<typeof RANGES[number]>(RANGES[2]);
  const [crossAccountExpanded, setCrossAccountExpanded] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [expandedTxId, setExpandedTxId] = useState<number | null>(null);
  const [editingStop, setEditingStop] = useState(false);
  const [editingTarget, setEditingTarget] = useState(false);
  const [stopInputVal, setStopInputVal] = useState('');
  const [targetInputVal, setTargetInputVal] = useState('');

  const position = useMemo(
    () => positions.find(p => p.symbol === ticker && p.accountId === accountId),
    [positions, ticker, accountId],
  );
  const account = useMemo(
    () => accounts.find(a => a.id === accountId),
    [accounts, accountId],
  );

  React.useEffect(() => {
    if (position?.notes != null && !editingNote) {
      setNoteText(position.notes);
    }
  }, [position?.notes]);

  // ─── Queries ──────────────────────────────────────────────────────────────

  const { data: quote } = useQuery<MarketQuote>({
    queryKey: ['quote', ticker],
    queryFn: () => apiGet(`/market/quote/${ticker}`),
    refetchInterval: 30_000,
    enabled: !!ticker,
  });

  const { data: chartData, isLoading: chartLoading } = useQuery<ChartData>({
    queryKey: ['chart', ticker, selectedRange.range, selectedRange.interval],
    queryFn: () => apiGet(`/market/chart/${ticker}?interval=${selectedRange.interval}&range=${selectedRange.range}`),
    enabled: !!ticker,
  });

  const { data: historyDetail, isLoading: historyLoading, refetch: refetchHistory } = useQuery<PositionHistoryDetail>({
    queryKey: ['position-history-detail', ticker, accountId],
    queryFn: () => apiGet(`/positions/history/${ticker}?accountId=${accountId}`),
    enabled: !!ticker && !!accountId,
  });

  useFocusEffect(
    useCallback(() => {
      refetchHistory();
    }, [refetchHistory]),
  );

  // ─── Derived ──────────────────────────────────────────────────────────────

  const accountNLV = useMemo(() => {
    if (!account) return 0;
    const posValue = positions.filter(p => p.accountId === accountId).reduce((s, p) => s + p.marketValue, 0);
    return posValue + account.currentBalance;
  }, [positions, accounts, accountId]);

  const totalNW = useMemo(() => {
    const posValue = positions.reduce((s, p) => s + p.marketValue, 0);
    const cash = accounts.reduce((s, a) => s + a.currentBalance, 0);
    return posValue + cash;
  }, [positions, accounts]);

  const concentrationLimit = account?.concentrationLimit ?? DEFAULT_CONCENTRATION_LIMIT;
  const concentrationPct = accountNLV > 0 && position ? (position.marketValue / accountNLV) * 100 : 0;
  const isConcentrationViolated = position ? (position.marketValue / accountNLV) > concentrationLimit : false;
  const nwPct = totalNW > 0 && position ? (position.marketValue / totalNW) * 100 : 0;

  const crossAccountPositions = useMemo(
    () => positions.filter(p => p.symbol === ticker),
    [positions, ticker],
  );
  const crossAccountTotal = crossAccountPositions.reduce((s, p) => s + p.marketValue, 0);

  const otherAccountPositions = useMemo(
    () => crossAccountPositions.filter(p => p.accountId !== accountId),
    [crossAccountPositions, accountId],
  );

  const sleeveNavMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const a of accounts) {
      const posVal = positions.filter(p => p.accountId === a.id).reduce((s, p) => s + p.marketValue, 0);
      map.set(a.id, posVal + a.currentBalance);
    }
    return map;
  }, [accounts, positions]);

  const concentrationAction = useMemo(() => {
    if (!position) return null;
    const actions = computeActions(accounts, positions, sleeveNavMap);
    return actions.find(a => a.type === 'concentration' && a.positionId === position.id) ?? null;
  }, [accounts, positions, sleeveNavMap, position]);

  const currentPrice = quote?.price ?? position?.currentPrice ?? 0;
  const avgCost = position?.avgCost ?? historyDetail?.avgCostBasis ?? 0;
  const stopPrice = position?.stopPrice != null ? Number(position.stopPrice) : null;
  const targetPrice = position?.targetPrice != null ? Number(position.targetPrice) : null;
  const drawdownPct = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;

  React.useEffect(() => {
    if (!position || !account) return;
    const flags: { rule: string; detail: string }[] = [];
    if (isConcentrationViolated) {
      flags.push({ rule: 'Concentration', detail: `${concentrationPct.toFixed(1)}% vs ${(concentrationLimit * 100).toFixed(0)}% limit` });
    }
    setAIContext({
      screen: 'position_detail',
      ticker: position.symbol,
      name: position.name ?? position.symbol,
      sleeve: account.name,
      qty: position.quantity,
      avg_cost: position.avgCost,
      current_price: currentPrice,
      pnl_pct: position.unrealizedPnlPct,
      stop: stopPrice ?? undefined,
      target: targetPrice ?? undefined,
      ips_flags: flags,
      macro_tag: macroPosture?.label ?? undefined,
      thesis: position.notes ?? undefined,
    });
  }, [position?.id, currentPrice, isConcentrationViolated, macroPosture]);

  const suggestedLevels = useMemo(
    () => currentPrice > 0 ? suggestLevels(currentPrice, avgCost, quote?.low52w ?? null) : null,
    [currentPrice, avgCost, quote?.low52w],
  );

  const sharesToTrim = useMemo(() => {
    if (!position || accountNLV <= 0 || currentPrice <= 0) return 0;
    const targetMktValue = accountNLV * concentrationLimit;
    return Math.max(0, (position.marketValue - targetMktValue) / currentPrice);
  }, [position, accountNLV, concentrationLimit, currentPrice]);

  // Per-row realized P&L (computed from running avg cost)
  const enrichedTransactions = useMemo<EnrichedTransaction[]>(() => {
    if (!historyDetail?.transactions) return [];
    const sorted = [...historyDetail.transactions].sort(
      (a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime(),
    );
    // Bootstrap from position data when no buy activities exist (seeded position)
    const hasBuyTransactions = sorted.some(t => t.activityType === 'buy' && (t.quantity ?? 0) > 0);
    const totalSellQty = hasBuyTransactions ? 0 : sorted
      .filter(t => t.activityType === 'sell')
      .reduce((s, t) => s + (t.quantity ?? 0), 0);
    let runningAvg = hasBuyTransactions ? 0 : avgCost;
    let runningQty = hasBuyTransactions ? 0 : ((historyDetail.totalShares ?? 0) + totalSellQty);
    const result = sorted.map(t => {
      const qty = t.quantity ?? 0;
      const price = t.price ?? (t.totalAmount != null && qty > 0 ? Math.abs(t.totalAmount) / qty : 0);
      let rowRealizedPnl: number | undefined;
      if (t.activityType === 'buy' && qty > 0) {
        runningAvg = runningQty > 0 ? (runningAvg * runningQty + price * qty) / (runningQty + qty) : price;
        runningQty += qty;
      } else if (t.activityType === 'sell' && qty > 0) {
        rowRealizedPnl = (price - runningAvg) * qty;
        runningQty = Math.max(0, runningQty - qty);
      }
      return { ...t, rowRealizedPnl };
    });
    return result.reverse();
  }, [historyDetail?.transactions, avgCost, historyDetail?.totalShares]);

  const historySummary = useMemo(() => {
    if (!historyDetail) return null;
    const txns = historyDetail.transactions;
    const totalBought = txns.filter(t => t.activityType === 'buy').reduce((s, t) => {
      const qty = t.quantity ?? 0;
      const p = t.price ?? (t.totalAmount != null && qty > 0 ? Math.abs(t.totalAmount) / qty : 0);
      return s + qty * p;
    }, 0);
    const totalSold = txns.filter(t => t.activityType === 'sell').reduce((s, t) => {
      const qty = t.quantity ?? 0;
      const p = t.price ?? (t.totalAmount != null && qty > 0 ? Math.abs(t.totalAmount) / qty : 0);
      return s + qty * p;
    }, 0);
    // Use enrichedTransactions P&L so seeded positions use the correct avg cost from context.
    const realizedPnl = enrichedTransactions.reduce((s, t) => s + (t.rowRealizedPnl ?? 0), 0);
    return { totalBought, totalSold, realizedPnl, holdDays: historyDetail.holdDurationDays };
  }, [historyDetail, enrichedTransactions]);

  // ─── Chart ────────────────────────────────────────────────────────────────

  const renderChart = () => {
    if (chartLoading) {
      return (
        <View style={{ height: CHART_H + VOL_H, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    const closes = (chartData?.closes ?? []).filter((v): v is number => v != null && !isNaN(v));
    const volumes = (chartData?.volumes ?? []).filter((v): v is number => v != null && !isNaN(v));
    if (closes.length < 2) {
      return (
        <View style={{ height: CHART_H + VOL_H, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textMuted }}>No chart data</Text>
        </View>
      );
    }

    const refs = [avgCost, ...(stopPrice != null ? [stopPrice] : [])].filter(v => v > 0);
    const min = Math.min(...closes, ...refs);
    const max = Math.max(...closes, ...refs);
    const range = max - min || 1;
    const iW = CHART_W - PAD.left - PAD.right;
    const iH = CHART_H - PAD.top - PAD.bottom;

    const pts = closes.map((v, i) => ({
      x: PAD.left + (i / (closes.length - 1)) * iW,
      y: PAD.top + iH - ((v - min) / range) * iH,
    }));

    const linePath = pts.reduce((acc, p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`;
      const prev = pts[i - 1];
      const cpx = (prev.x + p.x) / 2;
      return `${acc} C ${cpx} ${prev.y} ${cpx} ${p.y} ${p.x} ${p.y}`;
    }, '');
    const fillPath = `${linePath} L ${pts[pts.length - 1].x} ${PAD.top + iH} L ${pts[0].x} ${PAD.top + iH} Z`;
    const isPos = closes[closes.length - 1] >= closes[0];
    const lineColor = isPos ? colors.positive : colors.negative;

    const yLabels = [min, min + range * 0.5, max];
    const avgY = avgCost > 0 ? PAD.top + iH - ((avgCost - min) / range) * iH : null;
    const stopY = stopPrice != null && stopPrice > 0 ? PAD.top + iH - ((stopPrice - min) / range) * iH : null;

    const maxVol = Math.max(...volumes, 1);
    const volBarW = volumes.length > 1 ? Math.max(1, iW / volumes.length - 1) : 6;

    return (
      <Svg width={CHART_W} height={CHART_H + VOL_H}>
        <Defs>
          <SvgLinearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <SvgStop offset="0%" stopColor={lineColor} stopOpacity={0.22} />
            <SvgStop offset="100%" stopColor={lineColor} stopOpacity={0} />
          </SvgLinearGradient>
        </Defs>

        {yLabels.map((v, i) => {
          const y = PAD.top + iH - (i / (yLabels.length - 1)) * iH;
          return (
            <React.Fragment key={i}>
              <Line x1={PAD.left} y1={y} x2={CHART_W - PAD.right} y2={y} stroke={colors.separator} strokeWidth={0.5} />
              <SvgText x={PAD.left - 4} y={y + 4} fill={colors.textMuted} fontSize={9} textAnchor="end">
                {v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v.toFixed(0)}
              </SvgText>
            </React.Fragment>
          );
        })}

        <Path d={fillPath} fill="url(#chartFill)" />
        <Path d={linePath} stroke={lineColor} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />

        {avgY != null && avgY >= PAD.top && avgY <= PAD.top + iH && (
          <>
            <Line x1={PAD.left} y1={avgY} x2={CHART_W - PAD.right} y2={avgY} stroke="#F5A623" strokeWidth={1} strokeDasharray="4 3" />
            <SvgText x={PAD.left - 4} y={avgY - 3} fill="#F5A623" fontSize={9} textAnchor="end">avg</SvgText>
          </>
        )}

        {stopY != null && stopY >= PAD.top && stopY <= PAD.top + iH && (
          <>
            <Line x1={PAD.left} y1={stopY} x2={CHART_W - PAD.right} y2={stopY} stroke={colors.primary} strokeWidth={1} strokeDasharray="4 3" />
            <SvgText x={PAD.left - 4} y={stopY - 3} fill={colors.primary} fontSize={9} textAnchor="end">stop</SvgText>
          </>
        )}

        {volumes.map((v, i) => {
          const barH = Math.max(1, (v / maxVol) * (VOL_H - 4));
          const x = PAD.left + (i / Math.max(volumes.length - 1, 1)) * iW - volBarW / 2;
          return (
            <Rect key={i} x={x} y={CHART_H + (VOL_H - 4 - barH)} width={Math.max(1, volBarW)} height={barH} fill={colors.textMuted} opacity={0.35} />
          );
        })}
      </Svg>
    );
  };

  // ─── Derived (position optional) ─────────────────────────────────────────

  const bucket = position?.positionBucket ?? null;
  const isOpen = (position?.quantity ?? 0) > 0;

  const saveNote = async () => {
    if (!position) return;
    setEditingNote(false);
    try {
      await apiPut(`/positions/${position.id}`, { notes: noteText });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
    } catch { /* silently fail — text remains visible */ }
  };

  const saveStop = async () => {
    if (!position) return;
    const price = parseFloat(stopInputVal);
    if (isNaN(price) || price <= 0) { setEditingStop(false); return; }
    setEditingStop(false);
    try {
      await apiPut(`/positions/${position.id}`, { stopPrice: price });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
    } catch {}
  };

  const saveTarget = async () => {
    if (!position) return;
    const price = parseFloat(targetInputVal);
    if (isNaN(price) || price <= 0) { setEditingTarget(false); return; }
    setEditingTarget(false);
    try {
      await apiPut(`/positions/${position.id}`, { targetPrice: price });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
    } catch {}
  };

  // ─── Price Card ───────────────────────────────────────────────────────────

  const priceCard = (
    <Card style={styles.priceCard} noPadding>
      <View style={{ padding: 16, paddingBottom: 4 }}>
        <Text style={styles.companyName} numberOfLines={1}>
          {quote?.name ?? position?.name ?? ticker}
        </Text>
        {account && <Text style={styles.accountContext}>{account.name}</Text>}

        <Text style={styles.priceText}>{formatCurrency(currentPrice)}</Text>
        {quote && (
          <View style={styles.changeRow}>
            <Feather
              name={quote.changePercent >= 0 ? 'trending-up' : 'trending-down'}
              size={14}
              color={quote.changePercent >= 0 ? colors.positive : colors.negative}
            />
            <Text style={[styles.changeText, { color: quote.changePercent >= 0 ? colors.positive : colors.negative }]}>
              {quote.changePercent >= 0 ? '+' : ''}{formatCurrency(quote.change)} ({quote.changePercent >= 0 ? '+' : ''}{quote.changePercent.toFixed(2)}%)
            </Text>
          </View>
        )}

        {/* 52W range bar */}
        {quote?.high52w != null && quote?.low52w != null && quote.high52w > quote.low52w && (() => {
          const lo = quote.low52w!;
          const hi = quote.high52w!;
          const dotPct = Math.max(0, Math.min(1, (currentPrice - lo) / (hi - lo)));
          const offHighPct = ((hi - currentPrice) / hi) * 100;
          return (
            <View style={styles.rangeSection}>
              <View style={styles.rangeLabels}>
                <Text style={[styles.rangeLabelEdge, { color: colors.negative }]}>{formatCurrency(lo, 'compact')}</Text>
                <Text style={styles.rangeLabelCenter}>52W Range</Text>
                <Text style={[styles.rangeLabelEdge, { color: colors.positive }]}>{formatCurrency(hi, 'compact')}</Text>
              </View>
              <View style={styles.rangeBarWrap}>
                <LinearGradient
                  colors={[colors.negative, '#F5A623', colors.positive]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.rangeBarGradient}
                />
                <View style={[styles.rangeDot, { left: `${dotPct * 100}%` as any }]} />
              </View>
              <Text style={styles.offHighLabel}>{offHighPct.toFixed(1)}% off high</Text>
            </View>
          );
        })()}
      </View>

      {/* Timeframe tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rangeTabs}>
        {RANGES.map(r => (
          <Pressable
            key={r.label}
            style={[styles.rangeTab, selectedRange.label === r.label && styles.rangeTabActive]}
            onPress={() => setSelectedRange(r)}
          >
            <Text style={[styles.rangeTabText, selectedRange.label === r.label && styles.rangeTabTextActive]}>{r.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Chart */}
      <View style={styles.chartWrap}>{renderChart()}</View>

      {/* IPS status strip */}
      {position && (
        <View style={styles.ipsStrip}>
          <View style={[
            styles.ipsPill,
            isConcentrationViolated
              ? { backgroundColor: colors.negative + '20', borderColor: colors.negative + '55' }
              : { backgroundColor: colors.surface, borderColor: colors.separator },
          ]}>
            <View style={[styles.ipsDot, { backgroundColor: isConcentrationViolated ? colors.negative : colors.textMuted }]} />
            <Text style={[styles.ipsPillText, { color: isConcentrationViolated ? colors.negative : colors.textSecondary }]}>
              Conc {concentrationPct.toFixed(1)}%{isConcentrationViolated ? ' · over limit' : ''}
            </Text>
          </View>
          <View style={[styles.ipsPill, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
            <View style={[styles.ipsDot, { backgroundColor: colors.textMuted }]} />
            <Text style={styles.ipsPillText}>
              {drawdownPct >= 0 ? '+' : ''}{drawdownPct.toFixed(1)}% vs cost
            </Text>
          </View>
        </View>
      )}
    </Card>
  );

  // ─── Guard (show price card + chart for unowned tickers) ─────────────────

  if (!position) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.topbar}>
          <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
            <Feather name="arrow-left" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.topbarTicker}>{ticker}</Text>
        </View>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === 'web' ? 40 : insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {priceCard}
        </ScrollView>
      </View>
    );
  }

  // ─── Overview content ─────────────────────────────────────────────────────

  const overviewContent = (
    <>
      {/* Trim action card */}
      {concentrationAction && (
        <Pressable
          style={styles.trimCard}
          onPress={() => router.push({ pathname: '/action-detail', params: { actionId: concentrationAction.id } })}
        >
          <View style={styles.trimCardHeader}>
            <Feather name="scissors" size={14} color="#F5A623" />
            <Text style={styles.trimCardTitle}>Concentration Trim</Text>
            <Feather name="chevron-right" size={14} color="#F5A623" />
          </View>
          <Text style={styles.trimCardMain}>
            Trim ~{sharesToTrim.toFixed(0)} shares to reach {(concentrationLimit * 100).toFixed(0)}% limit
          </Text>
          <Text style={styles.trimCardSub}>
            New value: {formatCurrency(position.marketValue - sharesToTrim * currentPrice)} · New conc: {(concentrationLimit * 100).toFixed(0)}%
          </Text>
        </Pressable>
      )}

      {/* Your position card */}
      <Card style={styles.positionCard}>
        <Text style={styles.cardLabel}>Your Position</Text>
        <View style={styles.posGrid}>
          <StatCell
            label="Shares"
            value={position.quantity % 1 === 0 ? position.quantity.toFixed(0) : position.quantity.toFixed(4)}
          />
          <StatCell label="Avg Cost" value={formatCurrency(avgCost)} />
          <StatCell label="Cost Basis" value={formatCurrency(position.quantity * avgCost)} />
          <StatCell label="Mkt Value" value={formatCurrency(position.marketValue)} />
          <StatCell
            label="Unrealized P&L"
            value={`${position.unrealizedPnl >= 0 ? '+' : ''}${formatCurrency(position.unrealizedPnl)}`}
            valueColor={position.unrealizedPnl >= 0 ? colors.positive : colors.negative}
          />
          <StatCell
            label="Hold Duration"
            value={historyDetail ? `${historyDetail.holdDurationDays}d` : (historyLoading ? '…' : '—')}
          />
          <StatCell
            label="Today"
            value={`${(position.dayChangePct ?? 0) >= 0 ? '+' : ''}${formatCurrency(position.dayChange ?? 0)} (${(position.dayChangePct ?? 0) >= 0 ? '+' : ''}${(position.dayChangePct ?? 0).toFixed(2)}%)`}
            valueColor={(position.dayChangePct ?? 0) >= 0 ? colors.positive : colors.negative}
          />
        </View>

        {/* Entry note */}
        <View style={styles.noteRow}>
          {editingNote ? (
            <TextInput
              style={styles.noteInput}
              value={noteText}
              onChangeText={setNoteText}
              onBlur={saveNote}
              autoFocus
              placeholder="Add entry note…"
              placeholderTextColor={colors.textMuted}
            />
          ) : (
            <Text style={styles.noteText} numberOfLines={1}>
              {noteText || <Text style={{ color: colors.textMuted, fontStyle: 'italic' }}>No entry note</Text>}
            </Text>
          )}
          <Pressable hitSlop={8} onPress={() => editingNote ? saveNote() : setEditingNote(true)}>
            <Feather name="edit-2" size={13} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* Realized P&L */}
        <View style={styles.realizedRow}>
          <Text style={styles.realizedLabel}>Realized P&L on {ticker} (all time)</Text>
          <Text style={[
            styles.realizedValue,
            { color: historyDetail ? (historyDetail.realizedPnl >= 0 ? colors.positive : colors.negative) : colors.textMuted },
          ]}>
            {historyDetail
              ? `${historyDetail.realizedPnl >= 0 ? '+' : ''}${formatCurrency(historyDetail.realizedPnl)}`
              : (historyLoading ? '…' : '—')}
          </Text>
        </View>
      </Card>

      {/* Size in portfolio */}
      <Card>
        <Text style={styles.cardLabel}>Size in Portfolio</Text>
        <SizeRow
          label={`This account (${account?.name ?? '—'})`}
          pct={concentrationPct}
          highlight={isConcentrationViolated ? colors.negative : undefined}
        />
        <SizeRow label="Total net worth" pct={nwPct} />
        <View style={styles.sizeLastRow}>
          <Text style={styles.sizeLabelText}>All accounts ({ticker} total)</Text>
          <Text style={styles.sizeValueText}>{formatCurrency(crossAccountTotal)}</Text>
        </View>
      </Card>

      {/* Also held in other accounts */}
      {otherAccountPositions.length > 0 && (
        <Card>
          <Text style={styles.cardLabel}>Also held in other accounts</Text>
          {otherAccountPositions.map(p => {
            const acct = accounts.find(a => a.id === p.accountId);
            const acctNLV = sleeveNavMap.get(p.accountId) ?? 0;
            const pct = acctNLV > 0 ? (p.marketValue / acctNLV) * 100 : 0;
            const isOpPos = p.unrealizedPnl >= 0;
            return (
              <View key={p.id} style={styles.alsoHeldRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.alsoHeldAcct}>{acct?.name ?? `Account ${p.accountId}`}</Text>
                  <Text style={styles.alsoHeldMeta}>
                    {fmtQty(p.quantity)} sh · avg {formatCurrency(p.avgCost)} · {pct.toFixed(1)}% of account
                  </Text>
                </View>
                <Text style={[styles.alsoHeldReturn, { color: isOpPos ? colors.positive : colors.negative }]}>
                  {isOpPos ? '+' : ''}{p.unrealizedPnlPct.toFixed(1)}%
                </Text>
              </View>
            );
          })}
        </Card>
      )}

      {/* Levels */}
      <Card>
        <Text style={styles.cardLabel}>Levels</Text>

        {/* Stop row */}
        {editingStop ? (
          <View style={styles.levelEditRow}>
            <View style={[styles.levelDot, { backgroundColor: colors.negative }]} />
            <Text style={styles.levelLabel}>Stop</Text>
            <TextInput
              style={styles.levelInput}
              value={stopInputVal}
              onChangeText={setStopInputVal}
              keyboardType="decimal-pad"
              autoFocus
              selectTextOnFocus
            />
            <Pressable style={styles.levelSaveBtn} onPress={saveStop}>
              <Text style={styles.levelSaveBtnText}>Set</Text>
            </Pressable>
            <Pressable onPress={() => setEditingStop(false)} hitSlop={8}>
              <Feather name="x" size={14} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : stopPrice != null ? (
          <View style={styles.levelRow}>
            <View style={[styles.levelDot, { backgroundColor: colors.negative }]} />
            <Text style={styles.levelLabel}>Stop</Text>
            <Text style={styles.levelPrice}>{formatCurrency(stopPrice)}</Text>
            <Text style={[styles.levelDist, { color: currentPrice < stopPrice ? colors.negative : colors.textMuted }]}>
              {(((currentPrice - stopPrice) / currentPrice) * 100).toFixed(1)}% away
            </Text>
            <Pressable
              hitSlop={8}
              onPress={() => { setStopInputVal(stopPrice.toFixed(2)); setEditingStop(true); }}
              style={{ marginLeft: 'auto' }}
            >
              <Feather name="edit-2" size={12} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : (
          <View>
            <View style={styles.levelNudgeRow}>
              <Feather name="alert-triangle" size={12} color="#F5A623" />
              <Text style={styles.levelNudgeText}>
                No stop set
                {suggestedLevels ? ` · Suggested: ${formatCurrency(suggestedLevels.stop)}` : ''}
              </Text>
              {suggestedLevels && (
                <Pressable
                  style={styles.levelSetBtn}
                  onPress={() => { setStopInputVal(suggestedLevels.stop.toFixed(2)); setEditingStop(true); }}
                >
                  <Text style={styles.levelSetBtnText}>Set</Text>
                </Pressable>
              )}
            </View>
            {suggestedLevels && (
              <Text style={styles.levelBasisText}>{suggestedLevels.basis}</Text>
            )}
          </View>
        )}

        {/* Target row */}
        {editingTarget ? (
          <View style={styles.levelEditRow}>
            <View style={[styles.levelDot, { backgroundColor: colors.positive }]} />
            <Text style={styles.levelLabel}>Target</Text>
            <TextInput
              style={styles.levelInput}
              value={targetInputVal}
              onChangeText={setTargetInputVal}
              keyboardType="decimal-pad"
              autoFocus
              selectTextOnFocus
            />
            <Pressable style={styles.levelSaveBtn} onPress={saveTarget}>
              <Text style={styles.levelSaveBtnText}>Set</Text>
            </Pressable>
            <Pressable onPress={() => setEditingTarget(false)} hitSlop={8}>
              <Feather name="x" size={14} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : targetPrice != null ? (
          <View style={styles.levelRow}>
            <View style={[styles.levelDot, { backgroundColor: colors.positive }]} />
            <Text style={styles.levelLabel}>Target</Text>
            <Text style={styles.levelPrice}>{formatCurrency(targetPrice)}</Text>
            <Text style={[styles.levelDist, { color: currentPrice >= targetPrice ? colors.positive : colors.textMuted }]}>
              {(((targetPrice - currentPrice) / currentPrice) * 100).toFixed(1)}% away
            </Text>
            <Pressable
              hitSlop={8}
              onPress={() => { setTargetInputVal(targetPrice.toFixed(2)); setEditingTarget(true); }}
              style={{ marginLeft: 'auto' }}
            >
              <Feather name="edit-2" size={12} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : (
          <View>
            <View style={styles.levelNudgeRow}>
              <View style={[styles.levelNudgeDot]} />
              <Text style={styles.levelNudgeTextNeutral}>
                No target set
                {suggestedLevels ? ` · Suggested: ${formatCurrency(suggestedLevels.target)}` : ''}
              </Text>
              {suggestedLevels && (
                <Pressable
                  style={styles.levelSetBtn}
                  onPress={() => { setTargetInputVal(suggestedLevels.target.toFixed(2)); setEditingTarget(true); }}
                >
                  <Text style={styles.levelSetBtnText}>Set</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
      </Card>

      {/* Catalysts */}
      <Card>
        <Text style={styles.cardLabel}>Catalysts</Text>
        <View style={styles.catalystRow}>
          <Feather name="calendar" size={13} color={colors.textMuted} />
          <Text style={styles.catalystLabel}>Earnings</Text>
          <Text style={styles.catalystValue}>Not found</Text>
        </View>
        <View style={styles.catalystRow}>
          <Feather name="dollar-sign" size={13} color={colors.textMuted} />
          <Text style={styles.catalystLabel}>Ex-dividend</Text>
          <Text style={styles.catalystValue}>None</Text>
        </View>
      </Card>

      {/* Cross-account breakdown */}
      {crossAccountPositions.length > 1 && (
        <Card noPadding>
          <Pressable style={styles.crossHeader} onPress={() => setCrossAccountExpanded(e => !e)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.crossHeaderText}>Cross-account breakdown</Text>
              <Text style={styles.crossHeaderSub}>
                {crossAccountPositions.length} accounts · {formatCurrency(crossAccountTotal)}
              </Text>
            </View>
            <Feather name={crossAccountExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
          </Pressable>
          {crossAccountExpanded && (
            <View style={styles.crossBody}>
              <View style={[styles.crossRow, styles.crossTotalRow]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.crossAcctName}>Total</Text>
                </View>
                <View style={styles.crossRight}>
                  <Text style={styles.crossShares}>
                    {fmtQty(crossAccountPositions.reduce((s, p) => s + p.quantity, 0))} sh
                  </Text>
                  <Text style={styles.crossValue}>{formatCurrency(crossAccountTotal)}</Text>
                </View>
              </View>
              {crossAccountPositions.map(p => {
                const acct = accounts.find(a => a.id === p.accountId);
                const isThis = p.accountId === accountId;
                return (
                  <View key={p.id} style={styles.crossRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.crossAcctName}>{acct?.name ?? `Account ${p.accountId}`}</Text>
                      {isThis && <Text style={styles.crossThisTag}>this account</Text>}
                    </View>
                    <View style={styles.crossRight}>
                      <Text style={styles.crossMeta}>{formatCurrency(p.avgCost)}</Text>
                      <Text style={styles.crossShares}>{fmtQty(p.quantity)} sh</Text>
                      <Text style={styles.crossValue}>{formatCurrency(p.marketValue)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </Card>
      )}
    </>
  );

  // ─── History content ──────────────────────────────────────────────────────

  const historyContent = (
    <>
      {historySummary && (
        <Card>
          <Text style={styles.cardLabel}>Summary</Text>
          <View style={styles.posGrid}>
            <StatCell label="Total Bought" value={formatCurrency(historySummary.totalBought)} />
            <StatCell label="Total Sold" value={formatCurrency(historySummary.totalSold)} />
            <StatCell
              label="Realized P&L"
              value={`${historySummary.realizedPnl >= 0 ? '+' : ''}${formatCurrency(historySummary.realizedPnl)}`}
              valueColor={historySummary.realizedPnl >= 0 ? colors.positive : colors.negative}
            />
            <StatCell label="Hold Duration" value={`${historySummary.holdDays}d`} />
          </View>
        </Card>
      )}

      {historyLoading && enrichedTransactions.length === 0 ? (
        <View style={styles.historyEmpty}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : enrichedTransactions.length === 0 ? (
        <View style={styles.historyEmpty}>
          <Text style={styles.historyEmptyText}>No activity yet on {ticker} in {account?.name ?? 'this account'}</Text>
        </View>
      ) : (
        <View style={styles.txnList}>
          {enrichedTransactions.map(item => {
            const isBuy = item.activityType === 'buy';
            const isSell = item.activityType === 'sell';
            const typeColor = isBuy ? colors.positive : isSell ? colors.negative : '#F5A623';
            const date = new Date(item.tradeDate);
            const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const total = item.totalAmount != null
              ? Math.abs(item.totalAmount)
              : (item.quantity != null && item.price != null ? item.quantity * item.price : null);
            const isExpanded = expandedTxId === item.id;

            return (
              <Pressable key={item.id} onPress={() => setExpandedTxId(isExpanded ? null : item.id)}>
                <View style={styles.txnRow}>
                  <View style={[styles.txnBadge, { backgroundColor: typeColor + '22', borderColor: typeColor + '55' }]}>
                    <Text style={[styles.txnBadgeText, { color: typeColor }]}>
                      {item.activityType.toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.txnContent}>
                    <View style={styles.txnTopRow}>
                      <Text style={styles.txnDate}>{dateStr}</Text>
                      {total != null && (
                        <Text style={[styles.txnTotal, { color: isSell ? colors.positive : colors.textPrimary }]}>
                          {isSell ? '+' : '−'}{formatCurrency(total)}
                        </Text>
                      )}
                    </View>
                    {item.quantity != null && item.price != null && (
                      <Text style={styles.txnQtyPrice}>
                        {item.quantity % 1 === 0 ? item.quantity.toFixed(0) : item.quantity.toFixed(4)} sh @ {formatCurrency(item.price)}
                      </Text>
                    )}
                    {isSell && item.rowRealizedPnl != null && (
                      <Text style={[styles.txnPnl, { color: item.rowRealizedPnl >= 0 ? colors.positive : colors.negative }]}>
                        Realized: {item.rowRealizedPnl >= 0 ? '+' : ''}{formatCurrency(item.rowRealizedPnl)}
                      </Text>
                    )}
                    {isExpanded && item.notes && (
                      <Text style={styles.txnNotes}>{item.notes}</Text>
                    )}
                  </View>
                  <Feather name={isExpanded ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textMuted} />
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </>
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Topbar */}
      <View style={styles.topbar}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={20} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.topbarTicker}>{ticker}</Text>
        {bucket && (
          <View style={[styles.badge, { backgroundColor: bucketColor(bucket) + '22', borderColor: bucketColor(bucket) + '55' }]}>
            <Text style={[styles.badgeText, { color: bucketColor(bucket) }]}>{bucket.toUpperCase()}</Text>
          </View>
        )}
        <View style={[styles.badge, {
          backgroundColor: isOpen ? colors.positive + '22' : colors.textMuted + '22',
          borderColor: isOpen ? colors.positive + '55' : colors.separator,
        }]}>
          <Text style={[styles.badgeText, { color: isOpen ? colors.positive : colors.textMuted }]}>
            {isOpen ? 'OPEN' : 'CLOSED'}
          </Text>
        </View>
        <View style={styles.topbarTabs}>
          {(['overview', 'history'] as const).map(tab => (
            <Pressable
              key={tab}
              style={[styles.topbarTab, activeTab === tab && styles.topbarTabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.topbarTabText, activeTab === tab && styles.topbarTabTextActive]}>
                {tab === 'overview' ? 'Overview' : 'History'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === 'web' ? 40 : insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {priceCard}
        {activeTab === 'overview' ? overviewContent : historyContent}
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCell({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={scStyles.cell}>
      <Text style={scStyles.label}>{label}</Text>
      <Text style={[scStyles.value, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
    </View>
  );
}

const scStyles = StyleSheet.create({
  cell: { width: '50%', paddingRight: 8, marginBottom: 12 },
  label: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted, marginBottom: 2 },
  value: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: colors.textPrimary },
});

function SizeRow({ label, pct, highlight }: { label: string; pct: number; highlight?: string }) {
  const barFill = Math.min(100, pct);
  return (
    <View style={srStyles.row}>
      <Text style={srStyles.label} numberOfLines={1}>{label}</Text>
      <View style={srStyles.track}>
        <View style={[srStyles.fill, { width: `${barFill}%` as any, backgroundColor: highlight ?? colors.primary }]} />
      </View>
      <Text style={[srStyles.value, highlight ? { color: highlight } : undefined]}>{pct.toFixed(1)}%</Text>
    </View>
  );
}

const srStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  label: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textSecondary, width: 155 },
  track: { flex: 1, height: 4, backgroundColor: colors.surfaceBorder, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  value: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: colors.textPrimary, width: 42, textAlign: 'right' },
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 16, gap: 12 },
  notFound: { fontFamily: 'Inter_400Regular', fontSize: 16, color: colors.textSecondary, textAlign: 'center', marginTop: 80 },

  // Topbar
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  backBtn: { padding: 4 },
  topbarTicker: { fontFamily: 'Inter_700Bold', fontSize: 17, color: colors.textPrimary },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.5 },
  topbarTabs: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 2 },
  topbarTab: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 8 },
  topbarTabActive: { backgroundColor: colors.primary + '1A' },
  topbarTabText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.textMuted },
  topbarTabTextActive: { color: colors.primary, fontFamily: 'Inter_600SemiBold' },

  // Price card
  priceCard: { overflow: 'hidden' },
  companyName: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textSecondary, marginBottom: 1 },
  accountContext: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted, marginBottom: 8 },
  priceText: { fontFamily: 'Inter_700Bold', fontSize: 36, color: colors.textPrimary, marginBottom: 4 },
  changeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 },
  changeText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  // 52W range
  rangeSection: { marginBottom: 8 },
  rangeLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  rangeLabelCenter: { fontFamily: 'Inter_400Regular', fontSize: 10, color: colors.textMuted },
  rangeLabelEdge: { fontFamily: 'Inter_500Medium', fontSize: 10 },
  rangeBarWrap: { height: 6, borderRadius: 3, position: 'relative', overflow: 'visible', marginBottom: 4 },
  rangeBarGradient: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 3 },
  rangeDot: {
    position: 'absolute', width: 10, height: 10, borderRadius: 5,
    backgroundColor: colors.white, top: -2, marginLeft: -5,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 2,
  },
  offHighLabel: { fontFamily: 'Inter_400Regular', fontSize: 10, color: colors.textMuted },

  // Range tabs
  rangeTabs: { paddingHorizontal: 16, gap: 6, paddingVertical: 8 },
  rangeTab: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.separator },
  rangeTabActive: { borderColor: colors.primary, backgroundColor: colors.primary + '18' },
  rangeTabText: { fontFamily: 'Inter_500Medium', fontSize: 12, color: colors.textSecondary },
  rangeTabTextActive: { color: colors.primary },
  chartWrap: {},

  // IPS strip
  ipsStrip: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  ipsPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, borderWidth: 1 },
  ipsDot: { width: 6, height: 6, borderRadius: 3 },
  ipsPillText: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textSecondary },

  // Trim card
  trimCard: {
    backgroundColor: '#F5A62315',
    borderWidth: 1,
    borderColor: '#F5A62344',
    borderRadius: 16,
    padding: 14,
  },
  trimCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  trimCardTitle: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#F5A623' },
  trimCardMain: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.textPrimary, marginBottom: 3 },
  trimCardSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textSecondary },

  // Position card
  positionCard: {},
  cardLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 12 },
  posGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.separator, marginTop: 4 },
  noteText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textSecondary },
  noteInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textPrimary, padding: 0 },
  realizedRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, marginTop: 8, borderTopWidth: 1, borderTopColor: colors.separator },
  realizedLabel: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textMuted, flex: 1, marginRight: 8 },
  realizedValue: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  // Size in portfolio
  sizeLastRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  sizeLabelText: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textSecondary },
  sizeValueText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.textPrimary },

  // Levels
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.separator },
  levelEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.separator },
  levelDot: { width: 8, height: 8, borderRadius: 4 },
  levelLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.textSecondary, width: 50 },
  levelPrice: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: colors.textPrimary, flex: 1 },
  levelDist: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  levelAdd: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.primary, flex: 1 },
  levelInput: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 14, color: colors.textPrimary, borderBottomWidth: 1, borderBottomColor: colors.primary, paddingVertical: 2 },
  levelSaveBtn: { backgroundColor: colors.primary + '22', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  levelSaveBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: colors.primary },
  levelNudgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.separator },
  levelNudgeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textMuted },
  levelNudgeText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 12, color: '#F5A623' },
  levelNudgeTextNeutral: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textSecondary },
  levelSetBtn: { backgroundColor: colors.primary + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  levelSetBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: colors.primary },
  levelBasisText: { fontFamily: 'Inter_400Regular', fontSize: 10, color: colors.textMuted, paddingLeft: 18, paddingBottom: 4 },

  // Catalysts
  catalystRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.separator },
  catalystLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.textSecondary, flex: 1 },
  catalystValue: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textMuted },

  // Cross-account
  crossHeader: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  crossHeaderText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: colors.textPrimary },
  crossHeaderSub: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 2 },
  crossBody: { borderTopWidth: 1, borderTopColor: colors.separator },
  crossRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.separator },
  crossTotalRow: { backgroundColor: colors.surfaceElevated },
  crossAcctName: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.textPrimary },
  crossThisTag: { fontFamily: 'Inter_400Regular', fontSize: 10, color: colors.primary, marginTop: 1 },
  crossRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  crossMeta: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted },
  crossShares: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textSecondary },
  crossValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.textPrimary, minWidth: 90, textAlign: 'right' },

  // Also held in other accounts
  alsoHeldRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.separator },
  alsoHeldAcct: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.textPrimary },
  alsoHeldMeta: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 2 },
  alsoHeldReturn: { fontFamily: 'Inter_700Bold', fontSize: 13 },

  // History
  historyEmpty: { alignItems: 'center', paddingVertical: 40 },
  historyEmptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  txnList: { gap: 8 },
  txnRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.separator },
  txnBadge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginTop: 1 },
  txnBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.5 },
  txnContent: { flex: 1, gap: 3 },
  txnTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  txnDate: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textMuted },
  txnTotal: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  txnQtyPrice: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textSecondary },
  txnPnl: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  txnNotes: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textMuted, fontStyle: 'italic', marginTop: 3 },
});
