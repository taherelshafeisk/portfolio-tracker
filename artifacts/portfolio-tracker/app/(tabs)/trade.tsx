import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/constants/colors';
import { usePortfolio, apiGet, type Position, type Account } from '@/context/PortfolioContext';
import { formatCurrency } from '@/components/ui/PnlBadge';
import { Card } from '@/components/ui/Card';
import { useAIContext } from '@/hooks/useAIContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MinerviniCriteria {
  priceAbove150: boolean;
  priceAbove200: boolean;
  ema150Above200: boolean;
  priceAboveEma50: boolean;
  rsiHealthy: boolean;
}

interface MinerviniResult {
  symbol: string;
  price: number;
  isStage2: boolean;
  criteria: MinerviniCriteria;
  indicators: {
    rsi14: number;
    ema50: number;
    ema150: number;
    ema200: number;
    price: number;
  };
  fetchedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SWING_ALLOCATION_TARGET = 5_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function criteriaScore(c: MinerviniCriteria): number {
  return Object.values(c).filter(Boolean).length;
}

function daysHeld(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
}

function pnlColor(pct: number) {
  return pct >= 0 ? colors.positive : colors.negative;
}

function rsiBarColor(rsi: number) {
  if (rsi >= 50 && rsi <= 70) return colors.positive;
  return colors.negative;
}

// ─── Top-tab toggle ───────────────────────────────────────────────────────────

type Tab = 'swings' | 'screener';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TradeScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [activeTab, setActiveTab] = useState<Tab>('swings');

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Trade</Text>
      </View>

      {/* Top-tab toggle */}
      <View style={styles.topTabRow}>
        <Pressable
          style={[styles.topTab, activeTab === 'swings' && styles.topTabActive]}
          onPress={() => setActiveTab('swings')}
        >
          <Text style={[styles.topTabText, activeTab === 'swings' && styles.topTabTextActive]}>
            Open Swings
          </Text>
        </Pressable>
        <Pressable
          style={[styles.topTab, activeTab === 'screener' && styles.topTabActive]}
          onPress={() => setActiveTab('screener')}
        >
          <Text style={[styles.topTabText, activeTab === 'screener' && styles.topTabTextActive]}>
            Screener
          </Text>
        </Pressable>
      </View>

      {activeTab === 'swings' ? <OpenSwingsSection /> : <ScreenerSection />}
    </View>
  );
}

// ─── Open Swings ──────────────────────────────────────────────────────────────

function OpenSwingsSection() {
  const insets = useSafeAreaInsets();
  const { accounts, positions, macroPosture } = usePortfolio();
  const { setAIContext } = useAIContext();

  const swingAccounts = accounts.filter(a =>
    a.name.toLowerCase().includes('swing')
  );
  const swingAccountIds = new Set(swingAccounts.map(a => a.id));
  const swingPositions = positions.filter(p => swingAccountIds.has(p.accountId));

  const swingNav = swingPositions.reduce((sum, p) => sum + p.marketValue, 0);
  const allocationPct = Math.min((swingNav / SWING_ALLOCATION_TARGET) * 100, 100);

  useEffect(() => {
    setAIContext({
      screen: 'trade_swings',
      total_allocated: swingNav,
      target: SWING_ALLOCATION_TARGET,
      utilization_pct: allocationPct,
      positions: swingPositions.map(p => ({
        ticker: p.symbol,
        pnl_pct: p.unrealizedPnlPct,
        days_held: daysHeld(p.createdAt),
        stop_set: p.stopPrice != null,
      })),
      macro_posture: macroPosture?.label ?? 'Unknown',
    });
  }, [swingPositions.length, swingNav, macroPosture]);

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: Platform.OS === 'web' ? 100 : insets.bottom + 90 },
      ]}
    >
      {/* Allocation summary */}
      <Card style={styles.allocationCard}>
        <Text style={styles.allocationLabel}>Swing allocation</Text>
        <Text style={styles.allocationValue}>
          {formatCurrency(swingNav)}{' '}
          <Text style={styles.allocationTarget}>of {formatCurrency(SWING_ALLOCATION_TARGET)} target</Text>
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${allocationPct}%` as any }]} />
        </View>
        <Text style={styles.allocationPct}>{allocationPct.toFixed(0)}% deployed</Text>
      </Card>

      {swingAccounts.length === 0 && (
        <View style={styles.emptyState}>
          <Feather name="inbox" size={28} color={colors.textMuted} />
          <Text style={styles.emptyText}>No swing account found</Text>
          <Text style={styles.emptySubText}>Create an account with "swing" in its name</Text>
        </View>
      )}

      {swingPositions.length === 0 && swingAccounts.length > 0 && (
        <View style={styles.emptyState}>
          <Feather name="trending-up" size={28} color={colors.textMuted} />
          <Text style={styles.emptyText}>No open swing positions</Text>
        </View>
      )}

      {swingPositions.map(pos => (
        <SwingPositionCard key={pos.id} position={pos} />
      ))}

      <Pressable
        style={styles.newTradeBtn}
        onPress={() => Alert.alert('Coming soon', 'New Swing Trade entry coming soon.')}
      >
        <Feather name="plus" size={18} color={colors.background} />
        <Text style={styles.newTradeBtnText}>New Swing Trade</Text>
      </Pressable>
    </ScrollView>
  );
}

function SwingPositionCard({ position: p }: { position: Position }) {
  const pnlPct = p.unrealizedPnlPct;
  const days = daysHeld(p.createdAt);

  return (
    <Pressable
      style={styles.positionCard}
      onPress={() => router.push({ pathname: '/position/[ticker]', params: { ticker: p.symbol } })}
    >
      <View style={styles.positionHeader}>
        <View>
          <Text style={styles.positionSymbol}>{p.symbol}</Text>
          <Text style={styles.positionQty}>{p.quantity} shares · {days}d held</Text>
        </View>
        <View style={styles.positionPnl}>
          <Text style={[styles.pnlPct, { color: pnlColor(pnlPct) }]}>
            {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
          </Text>
          <Text style={[styles.pnlAbs, { color: pnlColor(p.unrealizedPnl) }]}>
            {formatCurrency(p.unrealizedPnl)}
          </Text>
        </View>
      </View>

      <View style={styles.priceRow}>
        <PriceCell label="Entry" value={formatCurrency(p.avgCost)} />
        <PriceCell label="Current" value={formatCurrency(p.currentPrice)} />
        <PriceCell
          label="Stop"
          value={p.stopPrice != null ? formatCurrency(p.stopPrice) : '⚠️ No stop'}
          warn={p.stopPrice == null}
        />
        <PriceCell
          label="Target"
          value={p.targetPrice != null ? formatCurrency(p.targetPrice) : 'Set target'}
          dim={p.targetPrice == null}
        />
      </View>
    </Pressable>
  );
}

function PriceCell({
  label, value, warn, dim,
}: { label: string; value: string; warn?: boolean; dim?: boolean }) {
  return (
    <View style={styles.priceCell}>
      <Text style={styles.priceCellLabel}>{label}</Text>
      <Text style={[
        styles.priceCellValue,
        warn && { color: '#F59E0B' },
        dim && { color: colors.textMuted },
      ]}>
        {value}
      </Text>
    </View>
  );
}

// ─── Screener ─────────────────────────────────────────────────────────────────

function ScreenerSection() {
  const insets = useSafeAreaInsets();
  const { setAIContext } = useAIContext();
  const [results, setResults] = useState<MinerviniResult[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanned, setLastScanned] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleResultPress = useCallback((r: MinerviniResult) => {
    const price = r.indicators?.price ?? r.price;
    const ema50 = r.indicators?.ema50;
    const ema150 = r.indicators?.ema150;
    const ema200 = r.indicators?.ema200;
    const emaLabels: string[] = [];
    if (ema50 != null) emaLabels.push(price >= ema50 ? '50d↑' : '50d↓');
    if (ema150 != null) emaLabels.push(price >= ema150 ? '150d↑' : '150d↓');
    if (ema200 != null) emaLabels.push(price >= ema200 ? '200d↑' : '200d↓');
    if (ema150 != null && ema200 != null) emaLabels.push(ema150 >= ema200 ? '150>200↑' : '150>200↓');
    setAIContext({
      screen: 'screener_result',
      ticker: r.symbol,
      price: r.price,
      stage: r.isStage2 ? 'Stage 2' : `${criteriaScore(r.criteria)}/5`,
      rsi: r.indicators?.rsi14 ?? 0,
      ema_status: emaLabels,
      ips_headroom: { bucket_available: true, leverage_ok: true },
    });
  }, [setAIContext]);

  const scan = useCallback(async () => {
    setIsScanning(true);
    setError(null);
    try {
      const data = await apiGet<MinerviniResult[]>('/screener/scan');
      setResults(data);
      setLastScanned(new Date());
    } catch (e: any) {
      setError(e?.message || 'Scan failed');
    } finally {
      setIsScanning(false);
    }
  }, []);

  const stage2 = results.filter(r => r.isStage2);
  const onWatch = results.filter(r => !r.isStage2 && criteriaScore(r.criteria) >= 3);
  const notReady = results.filter(r => !r.isStage2 && criteriaScore(r.criteria) < 3);

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        styles.scrollContent,
        { paddingBottom: Platform.OS === 'web' ? 100 : insets.bottom + 90 },
      ]}
    >
      {/* Scan button + cache info */}
      <View style={styles.scanHeader}>
        <Pressable
          style={[styles.scanBtn, isScanning && styles.scanBtnDisabled]}
          onPress={scan}
          disabled={isScanning}
        >
          {isScanning ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <Feather name="zap" size={16} color={colors.background} />
          )}
          <Text style={styles.scanBtnText}>
            {isScanning ? 'Scanning...' : 'Scan Market'}
          </Text>
        </Pressable>

        {lastScanned && (
          <Pressable onPress={scan} disabled={isScanning}>
            <Text style={styles.refreshText}>
              Scanned {lastScanned.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Refresh
            </Text>
          </Pressable>
        )}
      </View>

      {isScanning && (
        <Card style={styles.scanningCard}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.scanningText}>Scanning {results.length > 0 ? '(refreshing)' : 'market'}…</Text>
          <Text style={styles.scanningSubText}>Can take 30–60 seconds</Text>
        </Card>
      )}

      {error && (
        <View style={styles.errorBanner}>
          <Feather name="alert-circle" size={14} color={colors.negative} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {results.length === 0 && !isScanning && !error && (
        <View style={styles.emptyState}>
          <Feather name="search" size={28} color={colors.textMuted} />
          <Text style={styles.emptyText}>Tap "Scan Market" to screen stocks</Text>
          <Text style={styles.emptySubText}>Results cached for 1 hour</Text>
        </View>
      )}

      {stage2.length > 0 && (
        <ResultGroup label="Stage 2 ✅" results={stage2} onResultPress={handleResultPress} />
      )}
      {onWatch.length > 0 && (
        <ResultGroup label="On Watch 👀" results={onWatch} onResultPress={handleResultPress} />
      )}
      {notReady.length > 0 && (
        <ResultGroup label="Not Ready ❌" results={notReady} onResultPress={handleResultPress} />
      )}

      {results.length > 0 && (
        <Text style={styles.cacheNote}>Results cached for 1 hour</Text>
      )}
    </ScrollView>
  );
}

function ResultGroup({ label, results, onResultPress }: { label: string; results: MinerviniResult[]; onResultPress: (r: MinerviniResult) => void }) {
  return (
    <View style={styles.resultGroup}>
      <Text style={styles.groupLabel}>{label}</Text>
      {results.map(r => (
        <ScreenerResultCard key={r.symbol} result={r} onPress={() => onResultPress(r)} />
      ))}
    </View>
  );
}

function ScreenerResultCard({ result: r, onPress }: { result: MinerviniResult; onPress: () => void }) {
  const score = criteriaScore(r.criteria);
  const rsi = r.indicators?.rsi14 ?? null;
  const ema50 = r.indicators?.ema50 ?? null;
  const ema150 = r.indicators?.ema150 ?? null;
  const ema200 = r.indicators?.ema200 ?? null;
  const price = r.indicators?.price ?? r.price;

  return (
    <Pressable onPress={onPress}>
    <Card style={styles.resultCard}>
      <View style={styles.resultHeader}>
        <View>
          <Text style={styles.resultSymbol}>{r.symbol}</Text>
          <Text style={styles.resultPrice}>{formatCurrency(r.price)}</Text>
        </View>
        <View style={styles.resultBadge}>
          {r.isStage2 ? (
            <View style={[styles.badge, styles.badgeGreen]}>
              <Text style={[styles.badgeText, { color: colors.positive }]}>Stage 2</Text>
            </View>
          ) : (
            <View style={[styles.badge, styles.badgeNeutral]}>
              <Text style={[styles.badgeText, { color: colors.textSecondary }]}>{score}/5</Text>
            </View>
          )}
        </View>
      </View>

      {/* RSI bar */}
      {rsi != null ? (
        <View style={styles.rsiRow}>
          <Text style={styles.indicatorLabel}>RSI</Text>
          <View style={styles.rsiTrack}>
            <View style={[
              styles.rsiFill,
              { width: `${Math.min(rsi, 100)}%` as any, backgroundColor: rsiBarColor(rsi) },
            ]} />
          </View>
          <Text style={[styles.rsiValue, { color: rsiBarColor(rsi) }]}>{rsi.toFixed(0)}</Text>
        </View>
      ) : (
        <Text style={styles.naText}>RSI unavailable</Text>
      )}

      {/* EMA status */}
      <View style={styles.emaRow}>
        {ema50 != null && <EmaChip label="50d" above={price >= ema50} />}
        {ema150 != null && <EmaChip label="150d" above={price >= ema150} />}
        {ema200 != null && <EmaChip label="200d" above={price >= ema200} />}
        {ema150 != null && ema200 != null && <EmaChip label="150>200" above={ema150 >= ema200} />}
      </View>

      <Pressable
        style={styles.watchlistBtn}
        onPress={() => Alert.alert('Coming soon', 'Watchlist feature coming soon.')}
      >
        <Feather name="bookmark" size={13} color={colors.textSecondary} />
        <Text style={styles.watchlistBtnText}>Add to watchlist</Text>
      </Pressable>
    </Card>
    </Pressable>
  );
}

function EmaChip({ label, above }: { label: string; above: boolean }) {
  return (
    <View style={[styles.emaChip, above ? styles.emaChipGreen : styles.emaChipRed]}>
      <Text style={[styles.emaChipText, { color: above ? colors.positive : colors.negative }]}>
        {label} {above ? '↑' : '↓'}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 8,
    paddingTop: 4,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 26,
    color: colors.textPrimary,
  },

  // Top-tab toggle
  topTabRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 3,
  },
  topTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  topTabActive: {
    backgroundColor: colors.surfaceElevated,
  },
  topTabText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: colors.textMuted,
  },
  topTabTextActive: {
    color: colors.textPrimary,
  },

  scrollContent: { paddingHorizontal: 16, paddingTop: 4 },

  // Allocation card
  allocationCard: { padding: 16, marginBottom: 12 },
  allocationLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  allocationValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: 10,
  },
  allocationTarget: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.textSecondary,
  },
  progressTrack: {
    height: 6,
    backgroundColor: colors.surfaceBorder,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressFill: {
    height: 6,
    backgroundColor: colors.swing,
    borderRadius: 3,
  },
  allocationPct: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
  },

  // Position card
  positionCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.separator,
  },
  positionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  positionSymbol: {
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    color: colors.textPrimary,
  },
  positionQty: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  positionPnl: { alignItems: 'flex-end' },
  pnlPct: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  pnlAbs: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 2,
  },
  priceRow: { flexDirection: 'row', gap: 8 },
  priceCell: { flex: 1 },
  priceCellLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    color: colors.textMuted,
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  priceCellValue: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: colors.textPrimary,
  },

  // New trade button
  newTradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.swing,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 8,
  },
  newTradeBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: colors.background,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    color: colors.textSecondary,
  },
  emptySubText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textMuted,
  },

  // Screener
  scanHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  scanBtnDisabled: { opacity: 0.6 },
  scanBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: colors.background,
  },
  refreshText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textSecondary,
  },
  scanningCard: {
    padding: 32,
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  scanningText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    color: colors.textPrimary,
  },
  scanningSubText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,71,87,0.1)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.negative,
    flex: 1,
  },

  // Result groups
  resultGroup: { marginBottom: 16 },
  groupLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  resultCard: { padding: 14, marginBottom: 8 },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  resultSymbol: {
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    color: colors.textPrimary,
  },
  resultPrice: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  resultBadge: { alignItems: 'flex-end' },
  badge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  badgeGreen: {
    backgroundColor: 'rgba(0,230,118,0.1)',
    borderColor: 'rgba(0,230,118,0.3)',
  },
  badgeNeutral: {
    backgroundColor: colors.surfaceBorder,
    borderColor: colors.separator,
  },
  badgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },

  // RSI
  rsiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  indicatorLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: colors.textMuted,
    width: 28,
  },
  rsiTrack: {
    flex: 1,
    height: 4,
    backgroundColor: colors.surfaceBorder,
    borderRadius: 2,
    overflow: 'hidden',
  },
  rsiFill: { height: 4, borderRadius: 2 },
  rsiValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    width: 28,
    textAlign: 'right',
  },

  // EMA chips
  emaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  emaChip: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  emaChipGreen: {
    backgroundColor: 'rgba(0,230,118,0.08)',
    borderColor: 'rgba(0,230,118,0.25)',
  },
  emaChipRed: {
    backgroundColor: 'rgba(255,71,87,0.08)',
    borderColor: 'rgba(255,71,87,0.25)',
  },
  emaChipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
  },

  // Watchlist button
  watchlistBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  watchlistBtnText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
  },

  naText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 8,
  },
  cacheNote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
});
