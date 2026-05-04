import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { usePortfolio, apiGet, type Position } from '@/context/PortfolioContext';
import { formatCurrency } from '@/components/ui/PnlBadge';
import { useAIContext } from '@/hooks/useAIContext';

// ─── Types ────────────────────────────────────────────────────────────────────

type ThresholdType = 'stop_crossed' | 'stop_near' | 'target_hit' | 'target_near' | 'add_zone';

interface ThresholdCrossing {
  position: Position;
  type: ThresholdType;
  thresholdPrice: number;
  distPct: number;
}

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

function computeThresholds(positions: Position[]): ThresholdCrossing[] {
  const out: ThresholdCrossing[] = [];
  for (const p of positions) {
    const cur = p.currentPrice;
    if (p.stopPrice != null) {
      const dist = ((cur - p.stopPrice) / p.stopPrice) * 100;
      if (cur <= p.stopPrice) {
        out.push({ position: p, type: 'stop_crossed', thresholdPrice: p.stopPrice, distPct: dist });
      } else if (dist <= 3) {
        out.push({ position: p, type: 'stop_near', thresholdPrice: p.stopPrice, distPct: dist });
      }
    }
    if (p.targetPrice != null) {
      const dist = ((cur - p.targetPrice) / p.targetPrice) * 100;
      if (cur >= p.targetPrice) {
        out.push({ position: p, type: 'target_hit', thresholdPrice: p.targetPrice, distPct: dist });
      } else if (Math.abs(dist) <= 3) {
        out.push({ position: p, type: 'target_near', thresholdPrice: p.targetPrice, distPct: dist });
      }
    }
    if (p.addZoneLow != null && p.addZoneHigh != null) {
      if (cur >= p.addZoneLow && cur <= p.addZoneHigh) {
        out.push({ position: p, type: 'add_zone', thresholdPrice: p.addZoneLow, distPct: 0 });
      }
    }
  }
  return out;
}

type Tab = 'swings' | 'screener';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DecideScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 20 : insets.top;
  const [activeTab, setActiveTab] = useState<Tab>('swings');

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.eyebrow}>DECIDE</Text>
        <Text style={styles.title}>Pre-trade review</Text>
      </View>

      {/* Sub-tab toggle — serif tabs with underline indicator */}
      <View style={styles.tabRow}>
        {(['swings', 'screener'] as Tab[]).map(tab => (
          <Pressable key={tab} style={styles.tabOption} onPress={() => setActiveTab(tab)}>
            <Text style={[styles.tabLabel, activeTab === tab && styles.tabLabelActive]}>
              {tab === 'swings' ? 'Open Swings' : 'Screener'}
            </Text>
            {activeTab === tab && <View style={styles.tabUnderline} />}
          </Pressable>
        ))}
      </View>

      {activeTab === 'swings' ? <OpenSwingsSection /> : <ScreenerSection />}
    </View>
  );
}

// ─── Threshold Crossing Section ───────────────────────────────────────────────

const THRESHOLD_CONFIG: Record<ThresholdType, { label: string; sublabel: string; dotColor: string }> = {
  stop_crossed: { label: 'Stop crossed', sublabel: 'Price below stop — review exit', dotColor: colors.negative },
  stop_near:    { label: 'Near stop',     sublabel: 'Within 3% of stop loss',          dotColor: colors.negative },
  target_hit:   { label: 'Target hit',    sublabel: 'At or above target price',        dotColor: colors.positive },
  target_near:  { label: 'Near target',   sublabel: 'Within 3% of target',             dotColor: colors.positive },
  add_zone:     { label: 'Add zone',      sublabel: 'Price in defined add range',      dotColor: colors.amber },
};

function ThresholdSection({ crossings }: { crossings: ThresholdCrossing[] }) {
  if (crossings.length === 0) return null;
  return (
    <View style={styles.thresholdCard}>
      <Text style={styles.thresholdEyebrow}>LEVELS IN PLAY</Text>
      {crossings.map((c, i) => {
        const cfg = THRESHOLD_CONFIG[c.type];
        const distLabel = c.type === 'add_zone'
          ? 'in zone'
          : c.distPct >= 0
            ? `+${c.distPct.toFixed(1)}% away`
            : `${c.distPct.toFixed(1)}%`;
        return (
          <Pressable
            key={`${c.position.id}-${c.type}`}
            style={[styles.thresholdRow, i === 0 && styles.thresholdRowFirst]}
            onPress={() => router.push({ pathname: '/position/[ticker]', params: { ticker: c.position.symbol, accountId: String(c.position.accountId) } })}
          >
            <View style={[styles.thresholdDot, { backgroundColor: cfg.dotColor }]} />
            <View style={{ flex: 1 }}>
              <View style={styles.thresholdRowTop}>
                <Text style={styles.thresholdTicker}>{c.position.symbol}</Text>
                <Text style={[styles.thresholdDist, { color: cfg.dotColor }]}>{distLabel}</Text>
              </View>
              <Text style={styles.thresholdSubLabel}>{cfg.label} · {formatCurrency(c.thresholdPrice)}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Open Swings ──────────────────────────────────────────────────────────────

function OpenSwingsSection() {
  const insets = useSafeAreaInsets();
  const { accounts, positions, macroPosture } = usePortfolio();
  const { setAIContext } = useAIContext();

  const swingAccounts = accounts.filter(a => a.name.toLowerCase().includes('swing'));
  const swingAccountIds = new Set(swingAccounts.map(a => a.id));
  const swingPositions = positions.filter(p => swingAccountIds.has(p.accountId));

  const swingNav = swingPositions.reduce((sum, p) => sum + p.marketValue, 0);
  const allocationPct = Math.min((swingNav / SWING_ALLOCATION_TARGET) * 100, 100);
  const thresholds = computeThresholds(swingPositions);

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

  const bottomPad = Platform.OS === 'web' ? 100 : insets.bottom + 80;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
    >
      {/* Allocation summary */}
      <View style={styles.allocationCard}>
        <Text style={styles.allocationEyebrow}>SWING ALLOCATION</Text>
        <Text style={styles.allocationValue}>
          ${swingNav.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          <Text style={styles.allocationTarget}>
            {'  '}of ${SWING_ALLOCATION_TARGET.toLocaleString()} target
          </Text>
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${allocationPct}%` as any }]} />
        </View>
        <Text style={styles.allocationPct}>{allocationPct.toFixed(0)}% deployed</Text>
      </View>

      {swingAccounts.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No swing account</Text>
          <Text style={styles.emptyText}>Create an account with "swing" in its name</Text>
        </View>
      )}

      {swingPositions.length === 0 && swingAccounts.length > 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No open swings</Text>
        </View>
      )}

      {/* Threshold crossings */}
      <ThresholdSection crossings={thresholds} />

      {/* Positions ledger */}
      {swingPositions.length > 0 && (
        <View style={styles.ledgerTable}>
          {swingPositions.map((pos, i) => (
            <SwingRow key={pos.id} position={pos} isFirst={i === 0} />
          ))}
        </View>
      )}

      <Pressable
        style={styles.newTradeBtn}
        onPress={() => Alert.alert('Coming soon', 'New Swing Trade entry coming soon.')}
      >
        <Text style={styles.newTradeBtnText}>+ New Swing Trade</Text>
      </Pressable>
    </ScrollView>
  );
}

function SwingRow({ position: p, isFirst }: { position: Position; isFirst: boolean }) {
  const pnlPos = p.unrealizedPnlPct >= 0;
  const days = daysHeld(p.createdAt);

  return (
    <Pressable
      style={[styles.swingRow, !isFirst && styles.swingRowBorder]}
      onPress={() => router.push({ pathname: '/position/[ticker]', params: { ticker: p.symbol } })}
    >
      {/* Left: ticker + meta */}
      <View style={styles.swingRowLeft}>
        <Text style={styles.swingTicker}>{p.symbol}</Text>
        <Text style={styles.swingMeta}>
          {p.quantity} sh · {days}d held
        </Text>
      </View>

      {/* Right: prices + P&L */}
      <View style={styles.swingRowRight}>
        <Text style={[styles.swingPnl, { color: pnlPos ? colors.positive : colors.negative }]}>
          {pnlPos ? '+' : ''}{p.unrealizedPnlPct.toFixed(2)}%
        </Text>
        <Text style={[styles.swingPnlAbs, { color: pnlPos ? colors.positive : colors.negative }]}>
          {formatCurrency(p.unrealizedPnl)}
        </Text>
      </View>

      <Text style={styles.chevron}>›</Text>
    </Pressable>
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
  const bottomPad = Platform.OS === 'web' ? 100 : insets.bottom + 80;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
    >
      {/* Scan controls */}
      <View style={styles.scanHeader}>
        <Pressable
          style={[styles.scanBtn, isScanning && { opacity: 0.6 }]}
          onPress={scan}
          disabled={isScanning}
        >
          {isScanning
            ? <ActivityIndicator size="small" color={colors.deepInk} />
            : <Text style={styles.scanBtnText}>Scan Market</Text>
          }
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
        <View style={styles.scanningCard}>
          <ActivityIndicator size="large" color={colors.ink3} />
          <Text style={styles.scanningText}>Scanning{results.length > 0 ? ' (refreshing)' : ' market'}…</Text>
          <Text style={styles.scanningSubText}>Can take 30–60 seconds</Text>
        </View>
      )}

      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {results.length === 0 && !isScanning && !error && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No results yet</Text>
          <Text style={styles.emptyText}>Tap "Scan Market" to screen stocks · results cached 1 hour</Text>
        </View>
      )}

      {stage2.length > 0 && (
        <ResultGroup label="Stage 2" status="ok" results={stage2} onResultPress={handleResultPress} />
      )}
      {onWatch.length > 0 && (
        <ResultGroup label="On watch" status="amber" results={onWatch} onResultPress={handleResultPress} />
      )}
      {notReady.length > 0 && (
        <ResultGroup label="Not ready" status="none" results={notReady} onResultPress={handleResultPress} />
      )}

      {results.length > 0 && (
        <Text style={styles.cacheNote}>Results cached for 1 hour</Text>
      )}
    </ScrollView>
  );
}

function ResultGroup({
  label, status, results, onResultPress,
}: { label: string; status: 'ok' | 'amber' | 'none'; results: MinerviniResult[]; onResultPress: (r: MinerviniResult) => void }) {
  const dotColor = status === 'ok' ? colors.positive : status === 'amber' ? colors.amber : colors.ink3;
  return (
    <View style={styles.resultGroup}>
      <View style={styles.groupHeader}>
        <View style={[styles.groupDot, { backgroundColor: dotColor }]} />
        <Text style={styles.groupLabel}>{label}</Text>
        <Text style={styles.groupCount}>{results.length}</Text>
      </View>
      <View style={styles.ledgerTable}>
        {results.map((r, i) => (
          <ScreenerRow key={r.symbol} result={r} isFirst={i === 0} onPress={() => onResultPress(r)} />
        ))}
      </View>
    </View>
  );
}

function ScreenerRow({ result: r, isFirst, onPress }: { result: MinerviniResult; isFirst: boolean; onPress: () => void }) {
  const score = criteriaScore(r.criteria);
  const rsi = r.indicators?.rsi14 ?? null;

  return (
    <Pressable
      style={[styles.screenerRow, !isFirst && styles.screenerRowBorder]}
      onPress={onPress}
    >
      <View style={styles.screenerRowLeft}>
        <Text style={styles.screenerTicker}>{r.symbol}</Text>
        <Text style={styles.screenerMeta}>
          {r.isStage2 ? 'Stage 2' : `${score}/5`}
          {rsi != null ? ` · RSI ${rsi.toFixed(0)}` : ''}
        </Text>
      </View>
      <View style={styles.screenerRowRight}>
        <Text style={styles.screenerPrice}>${r.price.toFixed(2)}</Text>
        <View style={styles.emaChips}>
          {r.criteria.priceAboveEma50 && <View style={[styles.chip, { borderColor: colors.positive }]}><Text style={[styles.chipText, { color: colors.positive }]}>50d↑</Text></View>}
          {r.criteria.priceAbove200 && <View style={[styles.chip, { borderColor: colors.positive }]}><Text style={[styles.chipText, { color: colors.positive }]}>200d↑</Text></View>}
        </View>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 4 },
  eyebrow: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 26,
    letterSpacing: -0.02 * 26,
    color: colors.ink,
    marginTop: 4,
  },

  // Sub-tabs
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: 22,
    gap: 20,
    marginBottom: 16,
    marginTop: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  tabOption: { alignItems: 'center', paddingBottom: 10 },
  tabLabel: {
    fontFamily: fonts.serif,
    fontSize: 14,
    color: colors.ink3,
  },
  tabLabelActive: {
    fontFamily: fonts.serifItalic,
    color: colors.ink,
  },
  tabUnderline: {
    height: 1.5,
    backgroundColor: colors.accent,
    alignSelf: 'stretch',
    position: 'absolute',
    bottom: -1,
    left: 0,
    right: 0,
  },

  scrollContent: { paddingHorizontal: 22, paddingTop: 4 },

  // Allocation
  allocationCard: {
    marginBottom: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  allocationEyebrow: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.ink3,
    marginBottom: 6,
  },
  allocationValue: {
    fontFamily: fonts.mono,
    fontSize: 22,
    fontWeight: '500',
    color: colors.ink,
    marginBottom: 10,
    fontVariant: ['tabular-nums'],
  },
  allocationTarget: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.ink3,
    fontWeight: '400',
  },
  progressTrack: {
    height: 3,
    backgroundColor: colors.hair2,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressFill: {
    height: 3,
    backgroundColor: colors.gold,
    borderRadius: 2,
  },
  allocationPct: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.ink3,
    fontVariant: ['tabular-nums'],
  },

  // Ledger
  ledgerTable: {
    borderTopWidth: 1,
    borderTopColor: colors.ink,
    marginBottom: 16,
  },
  swingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  swingRowBorder: { borderTopWidth: 1, borderTopColor: colors.hair },
  swingRowLeft: { flex: 1 },
  swingTicker: { fontFamily: fonts.monoBold, fontSize: 13, color: colors.ink },
  swingMeta: { fontFamily: fonts.mono, fontSize: 10, color: colors.ink3, marginTop: 2 },
  swingRowRight: { alignItems: 'flex-end' },
  swingPnl: { fontFamily: fonts.mono, fontSize: 13, fontVariant: ['tabular-nums'] },
  swingPnlAbs: { fontFamily: fonts.mono, fontSize: 11, fontVariant: ['tabular-nums'] },
  chevron: { fontSize: 16, color: colors.ink3 },

  // New trade
  newTradeBtn: {
    borderRadius: 2,
    borderWidth: 1,
    borderColor: colors.ink,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  newTradeBtnText: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.ink },

  // Empty
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyTitle: { fontFamily: fonts.serif, fontSize: 18, color: colors.ink },
  emptyText: { fontFamily: fonts.sans, fontSize: 13, color: colors.ink3, textAlign: 'center' },

  // Screener
  scanHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  scanBtn: {
    backgroundColor: colors.ink,
    borderRadius: 2,
    paddingVertical: 10,
    paddingHorizontal: 18,
    minWidth: 120,
    alignItems: 'center',
  },
  scanBtnText: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.card },
  refreshText: { fontFamily: fonts.mono, fontSize: 11, color: colors.ink3 },
  scanningCard: { padding: 32, alignItems: 'center', gap: 10 },
  scanningText: { fontFamily: fonts.serif, fontSize: 15, color: colors.ink },
  scanningSubText: { fontFamily: fonts.sans, fontSize: 12, color: colors.ink3 },
  errorBanner: {
    backgroundColor: colors.negativeLight,
    borderRadius: 2,
    padding: 12,
    marginBottom: 12,
  },
  errorText: { fontFamily: fonts.sans, fontSize: 13, color: colors.negative },

  // Result groups
  resultGroup: { marginBottom: 20 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  groupDot: { width: 6, height: 6, borderRadius: 3 },
  groupLabel: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.ink, flex: 1 },
  groupCount: { fontFamily: fonts.mono, fontSize: 11, color: colors.ink3 },

  screenerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  screenerRowBorder: { borderTopWidth: 1, borderTopColor: colors.hair },
  screenerRowLeft: { flex: 1 },
  screenerTicker: { fontFamily: fonts.monoBold, fontSize: 13, color: colors.ink },
  screenerMeta: { fontFamily: fonts.mono, fontSize: 10, color: colors.ink3, marginTop: 2 },
  screenerRowRight: { alignItems: 'flex-end', gap: 4 },
  screenerPrice: { fontFamily: fonts.mono, fontSize: 13, fontVariant: ['tabular-nums'], color: colors.ink },
  emaChips: { flexDirection: 'row', gap: 4 },
  chip: { borderRadius: 2, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 2 },
  chipText: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 0.5 },

  cacheNote: { fontFamily: fonts.mono, fontSize: 11, color: colors.ink3, textAlign: 'center', marginTop: 8 },

  // Threshold crossings
  thresholdCard: {
    borderWidth: 1,
    borderColor: colors.hair2,
    borderRadius: 3,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
    marginBottom: 16,
    backgroundColor: colors.card,
  },
  thresholdEyebrow: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.ink3,
    marginBottom: 8,
  },
  thresholdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.hair,
  },
  thresholdRowFirst: { borderTopWidth: 0 },
  thresholdDot: { width: 7, height: 7, borderRadius: 4, marginTop: 1 },
  thresholdRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  thresholdTicker: { fontFamily: fonts.monoBold, fontSize: 13, color: colors.ink },
  thresholdDist: { fontFamily: fonts.mono, fontSize: 12, fontVariant: ['tabular-nums'] },
  thresholdSubLabel: { fontFamily: fonts.mono, fontSize: 10, color: colors.ink3, marginTop: 2 },
});
