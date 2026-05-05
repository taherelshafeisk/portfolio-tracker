import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  Pressable, StatusBar, Platform, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { usePortfolio, apiGet, apiPost, apiPatch, type Position, type Account } from '@/context/PortfolioContext';
import { useAuth } from '@/context/AuthContext';
import { useAIContext } from '@/hooks/useAIContext';
import { formatCurrency } from '@/components/ui/PnlBadge';
import {
  computeActions, reconcileActions, computeOpportunities,
  DEFAULT_CONCENTRATION_LIMIT, DEFAULT_LEVERAGE_CEILING,
  type Action, type ActionCategory, type Opportunity, type OpportunityType,
} from '@/lib/actions';

// ─── Constants ────────────────────────────────────────────────────────────────

const DISMISS_REASONS = [
  'Reviewed and accepted',
  'Will act within 5 days',
  'No longer relevant',
] as const;

type DismissReason = typeof DISMISS_REASONS[number];

function addTradingDays(date: Date, days: number): Date {
  const d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

function tradingDaysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.round(Math.abs(ms / 86400000) * (5 / 7));
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const FLAG_TYPE_LABEL: Record<string, string> = {
  cut: 'Cut position',
  trim: 'Trim position',
  review: 'Review thesis',
  stop: 'Stop triggered',
  reduce_leverage: 'Reduce leverage',
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiAlert {
  id: number;
  fingerprint: string;
  status: string;
  dismissReason: string | null;
}

interface PositionFlag {
  id: number;
  positionId: number | null;
  accountId: number;
  flagType: string;
  source: string;
  dueAt: string | null;
  resolvedAt: string | null;
  resolutionType: string | null;
  appGeneratedReasonSnapshot: string | null;
}

interface EnrichedFlag extends PositionFlag {
  symbol: string | null;
  accountName: string;
  daysOverdue: number;
}

interface PulseContribution {
  id: number;
  ticker: string;
  name: string;
  accountId: number;
  accountName: string;
  positionBucket: string | null;
  qty: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  dayChangeDollars: number;
  dayChangePct: number;
  unrealizedPnlPct: number;
}

interface PulseData {
  totalDayChange: number;
  contributions: PulseContribution[];
  leaders: PulseContribution[];
  laggards: PulseContribution[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtSigned(n: number): string {
  const abs = Math.abs(n);
  const s = abs >= 1000 ? Math.round(abs).toLocaleString() : abs.toFixed(0);
  return (n >= 0 ? '+$' : '−$') + s;
}

function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function getTodayLabel(): string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

const POSTURE_LABEL_DISPLAY: Record<string, string> = {
  bull: 'Bull market',
  'late-cycle': 'Late cycle',
  distribution: 'Distribution',
  stagflation: 'Stagflation',
  'war-escalation': 'War escalation',
  recession: 'Recession',
  neutral: 'Neutral',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function PostureStrip({
  label,
  notes,
  recessionRisk,
  topPad,
}: {
  label: string;
  notes: string | null;
  recessionRisk: number | null;
  topPad: number;
}) {
  return (
    <View style={[postureStyles.panel, { paddingTop: topPad + 14 }]}>
      <View style={postureStyles.row}>
        <Text style={postureStyles.label}>{POSTURE_LABEL_DISPLAY[label] ?? label}</Text>
        {recessionRisk != null && (
          <View style={postureStyles.badge}>
            <Text style={postureStyles.badgeText}>RECESSION {recessionRisk}%</Text>
          </View>
        )}
      </View>
      {notes ? (
        <Text style={postureStyles.notes} numberOfLines={2}>{notes}</Text>
      ) : null}
    </View>
  );
}

const postureStyles = StyleSheet.create({
  panel: {
    backgroundColor: colors.deep,
    paddingHorizontal: 22,
    paddingBottom: 18,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: {
    fontFamily: fonts.serifItalic,
    fontSize: 17,
    color: colors.deepInk,
    letterSpacing: -0.01 * 17,
    flex: 1,
  },
  badge: {
    backgroundColor: 'rgba(216,155,63,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(216,155,63,0.45)',
    borderRadius: 2,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  badgeText: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.deepAccent,
  },
  notes: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.deepInk2,
    marginTop: 8,
    lineHeight: 17,
  },
});

function IpsHealthStrip({
  actions,
  onActionPress,
  onDismiss,
}: {
  actions: Action[];
  onActionPress: (a: Action) => void;
  onDismiss: (a: Action) => void;
}) {
  const hardRules = actions.filter(a => a.category === 'hard_rule');
  const others = actions.filter(a => a.category !== 'hard_rule');
  const total = actions.length;

  if (total === 0) {
    return (
      <View style={ipsStyles.strip}>
        <View style={ipsStyles.cleanRow}>
          <View style={[ipsStyles.dot, { backgroundColor: colors.positive }]} />
          <Text style={ipsStyles.cleanText}>IPS clean — no violations</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={ipsStyles.strip}>
      <View style={ipsStyles.countsRow}>
        {hardRules.length > 0 && (
          <View style={[ipsStyles.countChip, { backgroundColor: colors.negativeLight }]}>
            <Text style={[ipsStyles.countNum, { color: colors.negative }]}>{hardRules.length}</Text>
            <Text style={[ipsStyles.countLabel, { color: colors.negative }]}>BREACH</Text>
          </View>
        )}
        {others.length > 0 && (
          <View style={[ipsStyles.countChip, { backgroundColor: colors.amberSoft }]}>
            <Text style={[ipsStyles.countNum, { color: colors.amber }]}>{others.length}</Text>
            <Text style={[ipsStyles.countLabel, { color: colors.amber }]}>PENDING</Text>
          </View>
        )}
      </View>
      {actions.slice(0, 3).map((action, i) => {
        const isBreach = action.category === 'hard_rule';
        const barColor = isBreach ? colors.negative : colors.amber;
        return (
          <Pressable
            key={action.id}
            style={[ipsStyles.ruleRow, i > 0 && ipsStyles.ruleRowBorder]}
            onPress={() => onActionPress(action)}
          >
            <View style={[ipsStyles.ruleBar, { backgroundColor: barColor }]} />
            <View style={ipsStyles.ruleBody}>
              <Text style={[ipsStyles.ruleCat, { color: barColor }]}>
                {isBreach ? 'RULE BROKEN' : action.category === 'commitment' ? 'COMMITMENT' : 'THRESHOLD'}
              </Text>
              <Text style={ipsStyles.ruleLabel} numberOfLines={1}>{action.label}</Text>
            </View>
            {(action.dbIds?.length ?? 0) > 0 && (
              <Pressable hitSlop={8} onPress={() => onDismiss(action)} style={ipsStyles.ruleDismiss}>
                <Text style={ipsStyles.ruleDismissText}>×</Text>
              </Pressable>
            )}
          </Pressable>
        );
      })}
      {actions.length > 3 && (
        <Pressable onPress={() => router.push('/daily-review')}>
          <Text style={ipsStyles.seeAll}>See all {actions.length} violations →</Text>
        </Pressable>
      )}
    </View>
  );
}

const ipsStyles = StyleSheet.create({
  strip: {
    marginHorizontal: 22,
    marginTop: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.hair2,
    borderRadius: 2,
    overflow: 'hidden',
  },
  cleanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  cleanText: { fontFamily: fonts.sans, fontSize: 12, color: colors.ink2 },
  countsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
  },
  countChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 2,
  },
  countNum: { fontFamily: fonts.monoBold, fontSize: 13, fontVariant: ['tabular-nums'] },
  countLabel: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1.2 },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  ruleRowBorder: { borderTopWidth: 1, borderTopColor: colors.hair },
  ruleBar: { width: 3, borderRadius: 2, alignSelf: 'stretch', minHeight: 28, marginRight: 10 },
  ruleBody: { flex: 1 },
  ruleCat: {
    fontFamily: fonts.mono,
    fontSize: 8,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  ruleLabel: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.ink, lineHeight: 16 },
  ruleDismiss: { paddingHorizontal: 8, justifyContent: 'center', paddingVertical: 4 },
  ruleDismissText: { fontSize: 16, color: colors.ink3 },
  seeAll: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.accent,
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 12,
    textDecorationLine: 'underline',
  },
});

const OPPORTUNITY_BADGE: Record<OpportunityType, string> = {
  approaching_concentration: 'APPROACHING LIMIT',
  cash_available: 'POSITIVE BALANCE',
  policy_missing: 'POLICY NOT SET',
};

function OpportunitiesStrip({ opportunities }: { opportunities: Opportunity[] }) {
  const visible = opportunities.slice(0, 3);
  if (visible.length === 0) return null;

  return (
    <View style={oppStyles.strip}>
      <View style={oppStyles.headerRow}>
        <View style={[oppStyles.dot, { backgroundColor: colors.accent }]} />
        <Text style={oppStyles.headerLabel}>WATCH</Text>
      </View>
      {visible.map((opp, i) => (
        <View key={opp.id} style={[oppStyles.row, i > 0 && oppStyles.rowBorder]}>
          <View style={[oppStyles.bar, { backgroundColor: colors.accent }]} />
          <View style={oppStyles.body}>
            <Text style={[oppStyles.badge, { color: colors.accent }]}>
              {OPPORTUNITY_BADGE[opp.type]}
            </Text>
            <Text style={oppStyles.label} numberOfLines={1}>{opp.label}</Text>
            <Text style={oppStyles.suggestion} numberOfLines={1}>{opp.suggestedAction}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const oppStyles = StyleSheet.create({
  strip: {
    marginHorizontal: 22,
    marginTop: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.hair2,
    borderRadius: 2,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  headerLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.hair },
  bar: { width: 3, borderRadius: 2, alignSelf: 'stretch', minHeight: 28, marginRight: 10 },
  body: { flex: 1 },
  badge: {
    fontFamily: fonts.mono,
    fontSize: 8,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.ink,
    lineHeight: 16,
  },
  suggestion: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.ink3,
    marginTop: 1,
  },
});

/** Expand raw positionBucket/sleeveKey values to human-readable names. */
function sleeveDisplayName(key: string): string {
  const ABBREVS: Record<string, string> = {
    def: 'Defensive',
    inc: 'Income',
    spec: 'Speculative',
    mkt: 'Market',
    idx: 'Index',
    div: 'Dividend',
    grw: 'Growth',
    alt: 'Alternative',
  };
  const lower = key.toLowerCase().trim();
  if (ABBREVS[lower]) return ABBREVS[lower];
  // Title-case multi-word keys; leave single-word capitalised keys as-is
  return key.replace(/\b\w/g, c => c.toUpperCase());
}

function ContributionBars({
  pulse,
}: {
  pulse: PulseData;
  totalNav?: number;
}) {
  const sleeves = useMemo(() => {
    const map = new Map<string, { name: string; change: number }>();
    for (const c of pulse.contributions) {
      const key = c.positionBucket ?? c.accountName;
      const existing = map.get(key);
      if (existing) {
        existing.change += c.dayChangeDollars;
      } else {
        map.set(key, { name: sleeveDisplayName(key), change: c.dayChangeDollars });
      }
    }
    return Array.from(map.values()).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  }, [pulse.contributions]);

  const maxAbs = Math.max(...sleeves.map(s => Math.abs(s.change)), 1);

  return (
    <View style={barsStyles.card}>
      <View style={barsStyles.header}>
        <Text style={barsStyles.eyebrow}>CONTRIBUTION BY SLEEVE</Text>
        <Text style={barsStyles.headerRight}>$ TODAY</Text>
      </View>
      {sleeves.map((sleeve, i) => {
        const isZero = sleeve.change === 0;
        const isPos = sleeve.change > 0;
        const frac = Math.abs(sleeve.change) / maxAbs;
        const barColor = isPos ? colors.positive : colors.negative;
        const barBg = isPos ? colors.positiveLight : colors.negativeLight;
        return (
          <View key={sleeve.name} style={[barsStyles.row, i > 0 && barsStyles.rowBorder]}>
            <Text style={barsStyles.sleeveLabel} numberOfLines={1}>{sleeve.name}</Text>
            <View style={barsStyles.barTrack}>
              {/* Left half — negative bars fill rightward from right edge */}
              <View style={barsStyles.halfLeft}>
                {!isPos && !isZero && (
                  <View style={[barsStyles.barNeg, { width: `${Math.round(frac * 100)}%` as any }]} />
                )}
              </View>
              <View style={barsStyles.centerTick} />
              {/* Right half — positive bars fill leftward from left edge */}
              <View style={barsStyles.halfRight}>
                {isPos && (
                  <View style={[barsStyles.barPos, { width: `${Math.round(frac * 100)}%` as any }]} />
                )}
              </View>
            </View>
            <Text style={[barsStyles.changeVal, isZero ? barsStyles.changeZero : { color: barColor }]}>
              {isZero ? '—' : fmtSigned(sleeve.change)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const barsStyles = StyleSheet.create({
  card: {
    marginHorizontal: 22,
    marginTop: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.hair2,
    borderRadius: 2,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  eyebrow: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  headerRight: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.hair },
  sleeveLabel: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.ink2,
    width: 90,
  },
  barTrack: {
    flex: 1,
    height: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  halfLeft: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  halfRight: { flex: 1, flexDirection: 'row', justifyContent: 'flex-start' },
  centerTick: { width: 1, height: 12, backgroundColor: colors.hair2 },
  barNeg: {
    height: 12,
    backgroundColor: colors.negativeLight,
    borderLeftWidth: 2,
    borderLeftColor: colors.negative,
    borderRadius: 1,
  },
  barPos: {
    height: 12,
    backgroundColor: colors.positiveLight,
    borderRightWidth: 2,
    borderRightColor: colors.positive,
    borderRadius: 1,
  },
  changeVal: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    width: 60,
    textAlign: 'right',
  },
  changeZero: { color: colors.ink3 },
});

function MoversGrid({ leaders, laggards }: { leaders: PulseContribution[]; laggards: PulseContribution[] }) {
  const top3Lead = leaders.slice(0, 3);
  const top3Lag = laggards.slice(0, 3);

  return (
    <Pressable style={moversStyles.card} onPress={() => router.push('/(tabs)/pulse')}>
      <View style={moversStyles.cols}>
        <View style={moversStyles.col}>
          <Text style={[moversStyles.colLabel, { color: colors.positive }]}>LEADERS</Text>
          {top3Lead.map(p => (
            <View key={`${p.ticker}-${p.accountId}`} style={moversStyles.moverRow}>
              <Text style={moversStyles.ticker}>{p.ticker}</Text>
              <Text style={[moversStyles.val, { color: colors.positive }]}>{fmtPct(p.dayChangePct)}</Text>
            </View>
          ))}
          {top3Lead.length === 0 && <Text style={moversStyles.empty}>—</Text>}
        </View>
        <View style={moversStyles.divider} />
        <View style={moversStyles.col}>
          <Text style={[moversStyles.colLabel, { color: colors.negative }]}>LAGGARDS</Text>
          {top3Lag.map(p => (
            <View key={`${p.ticker}-${p.accountId}`} style={moversStyles.moverRow}>
              <Text style={moversStyles.ticker}>{p.ticker}</Text>
              <Text style={[moversStyles.val, { color: colors.negative }]}>{fmtPct(p.dayChangePct)}</Text>
            </View>
          ))}
          {top3Lag.length === 0 && <Text style={moversStyles.empty}>—</Text>}
        </View>
      </View>
      <Text style={moversStyles.link}>Full pulse →</Text>
    </Pressable>
  );
}

const moversStyles = StyleSheet.create({
  card: {
    marginHorizontal: 22,
    marginTop: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.hair2,
    borderRadius: 2,
    padding: 14,
  },
  cols: { flexDirection: 'row', gap: 0 },
  col: { flex: 1, paddingHorizontal: 4 },
  divider: { width: 1, backgroundColor: colors.hair, marginVertical: 2 },
  colLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  moverRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: colors.hair,
  },
  ticker: { fontFamily: fonts.monoMedium, fontSize: 11, color: colors.ink },
  val: { fontFamily: fonts.mono, fontSize: 11, fontVariant: ['tabular-nums'] },
  empty: { fontFamily: fonts.mono, fontSize: 11, color: colors.ink3 },
  link: {
    marginTop: 10,
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.accent,
    textDecorationLine: 'underline',
  },
});

function WatchlistSection({ positions }: { positions: Position[] }) {
  // Positions with add zone set and price within ±10% of the zone
  const ripening = useMemo(() => {
    return positions
      .filter(p => p.addZoneLow != null || p.addZoneHigh != null)
      .map(p => {
        const low = p.addZoneLow ?? p.addZoneHigh!;
        const high = p.addZoneHigh ?? p.addZoneLow!;
        const mid = (low + high) / 2;
        const dist = ((p.currentPrice - mid) / mid) * 100;
        const inZone = p.currentPrice >= low && p.currentPrice <= high;
        const nearZone = Math.abs(dist) <= 10;
        return { ...p, dist, inZone, nearZone };
      })
      .filter(p => p.inZone || p.nearZone)
      .sort((a, b) => Math.abs(a.dist) - Math.abs(b.dist))
      .slice(0, 5);
  }, [positions]);

  if (ripening.length === 0) return null;

  return (
    <View style={watchStyles.section}>
      <Text style={watchStyles.sectionTitle}>Ripening</Text>
      <View style={watchStyles.card}>
        {ripening.map((p, i) => {
          const distStr = p.inZone
            ? 'IN ZONE'
            : (p.dist > 0 ? '+' : '') + p.dist.toFixed(1) + '% to zone';
          const distColor = p.inZone ? colors.positive : colors.ink3;
          return (
            <Pressable
              key={p.id}
              style={[watchStyles.row, i > 0 && watchStyles.rowBorder]}
              onPress={() => router.push({ pathname: '/position/[ticker]', params: { ticker: p.symbol, accountId: String(p.accountId) } })}
            >
              <View style={watchStyles.left}>
                <Text style={watchStyles.ticker}>{p.symbol}</Text>
                <Text style={watchStyles.name} numberOfLines={1}>{p.name}</Text>
              </View>
              <View style={watchStyles.right}>
                <Text style={watchStyles.price}>
                  {formatCurrency(p.currentPrice)}
                </Text>
                <Text style={[watchStyles.dist, { color: distColor }]}>{distStr}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const watchStyles = StyleSheet.create({
  section: { paddingHorizontal: 22, marginTop: 22 },
  sectionTitle: {
    fontFamily: fonts.serif,
    fontSize: 15,
    color: colors.ink,
    letterSpacing: -0.01 * 15,
    marginBottom: 8,
  },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.hair2,
    borderRadius: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.hair },
  left: { flex: 1 },
  ticker: { fontFamily: fonts.monoMedium, fontSize: 12, color: colors.ink },
  name: { fontFamily: fonts.sans, fontSize: 11, color: colors.ink3, marginTop: 1 },
  right: { alignItems: 'flex-end', gap: 2 },
  price: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink, fontVariant: ['tabular-nums'] },
  dist: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.5 },
});

function CommitmentCard({
  flag,
  onDone,
  onView,
}: {
  flag: EnrichedFlag;
  onDone: () => void;
  onView: () => void;
}) {
  const isOverdue = flag.daysOverdue > 0;
  const badgeColor = isOverdue ? colors.negative : colors.amber;
  const badgeText = isOverdue
    ? `OVERDUE · ${flag.daysOverdue}d`
    : 'DUE TODAY';
  const subject = flag.symbol
    ? `${flag.symbol} · ${flag.accountName}`
    : flag.accountName;

  return (
    <View style={commitStyles.card}>
      <View style={[commitStyles.bar, { backgroundColor: badgeColor }]} />
      <View style={commitStyles.body}>
        <View style={commitStyles.top}>
          <Text style={[commitStyles.badge, { color: badgeColor }]}>{badgeText}</Text>
          <Text style={commitStyles.type}>{FLAG_TYPE_LABEL[flag.flagType] ?? flag.flagType}</Text>
        </View>
        <Text style={commitStyles.subject}>{subject}</Text>
        {flag.appGeneratedReasonSnapshot ? (
          <Text style={commitStyles.reason} numberOfLines={2}>{flag.appGeneratedReasonSnapshot}</Text>
        ) : null}
        <View style={commitStyles.btns}>
          <Pressable style={commitStyles.doneBtn} onPress={onDone}>
            <Text style={commitStyles.doneText}>✓ Done</Text>
          </Pressable>
          <Pressable style={commitStyles.viewBtn} onPress={onView}>
            <Text style={commitStyles.viewText}>View →</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const commitStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: 1,
    borderTopColor: colors.hair,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  bar: { width: 3, borderRadius: 2, marginRight: 12, minHeight: 36 },
  body: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  badge: { fontFamily: fonts.mono, fontSize: 8, letterSpacing: 1.4, textTransform: 'uppercase' },
  type: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.ink },
  subject: { fontFamily: fonts.sans, fontSize: 12, color: colors.ink2, marginBottom: 4 },
  reason: { fontFamily: fonts.sans, fontSize: 11, color: colors.ink3, lineHeight: 16, marginBottom: 8 },
  btns: { flexDirection: 'row', gap: 8 },
  doneBtn: {
    backgroundColor: colors.positiveLight,
    borderRadius: 2,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  doneText: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.positive },
  viewBtn: {
    borderWidth: 1,
    borderColor: colors.hair2,
    borderRadius: 2,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  viewText: { fontFamily: fonts.sans, fontSize: 12, color: colors.ink2 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { summary, accounts, positions, isLoading, error, sessionExpired, refreshAll, macroPosture, resetState } = usePortfolio();
  const { token, signOut } = useAuth();
  const isDemo = token === 'demo-token';
  const { setAIContext } = useAIContext();
  const topPad = Platform.OS === 'web' ? 20 : insets.top;

  const [dismissModal, setDismissModal] = useState<{ action: Action } | null>(null);

  useEffect(() => {
    refreshAll();
  }, []);

  // ── Auto sign-out on session expiry ───────────────────────────────────────────
  useEffect(() => {
    if (sessionExpired) {
      resetState();
      signOut().then(() => router.replace('/auth/signin'));
    }
  }, [sessionExpired]);

  // ── Pulse data ────────────────────────────────────────────────────────────────

  const { data: pulseData, refetch: refetchPulse } = useQuery({
    queryKey: ['portfolio-pulse'],
    queryFn: () => apiGet<PulseData>('/portfolio/pulse'),
    staleTime: 60_000,
  });

  // ── DB alerts ────────────────────────────────────────────────────────────────

  const sleeveNavMap = useMemo<Map<number, number>>(
    () => new Map((summary?.accounts ?? []).map(a => [a.id, a.nav])),
    [summary],
  );

  const computedActions = useMemo(
    () => computeActions(accounts, positions, sleeveNavMap),
    [accounts, positions, sleeveNavMap],
  );

  const computedOpportunities = useMemo(
    () => computeOpportunities(accounts, positions, sleeveNavMap),
    [accounts, positions, sleeveNavMap],
  );

  const { data: dbAlerts, refetch: refetchAlerts } = useQuery({
    queryKey: ['alerts', 'all-active'],
    queryFn: () => apiGet<ApiAlert[]>('/alerts?status=active,acknowledged'),
    staleTime: Infinity,
  });

  const { mutate: generateAlerts } = useMutation({
    mutationFn: () => apiPost<ApiAlert[]>('/alerts/generate', {}),
    onSuccess: () => refetchAlerts(),
  });

  const { mutate: patchAlert } = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      apiPatch<ApiAlert>(`/alerts/${id}`, { status: 'acknowledged', ...(reason ? { dismissReason: reason } : {}) }),
    onSuccess: () => refetchAlerts(),
  });

  // ── Position flags ────────────────────────────────────────────────────────────

  const { data: openFlags, refetch: refetchFlags } = useQuery({
    queryKey: ['flags', 'open'],
    queryFn: () => apiGet<PositionFlag[]>('/flags?resolved=false'),
    staleTime: Infinity,
  });

  const { mutate: createFlag } = useMutation({
    mutationFn: (body: {
      positionId?: number;
      accountId: number;
      flagType: string;
      source: string;
      dueAt?: string;
      appGeneratedReasonSnapshot?: string;
    }) => apiPost<PositionFlag>('/flags', body),
    onSuccess: () => refetchFlags(),
  });

  const { mutate: resolveFlag } = useMutation({
    mutationFn: ({ id, resolutionType }: { id: number; resolutionType: string }) =>
      apiPatch<PositionFlag>(`/flags/${id}/resolve`, { resolutionType }),
    onSuccess: () => refetchFlags(),
  });

  // ── Triggered price alerts ────────────────────────────────────────────────────

  interface PriceAlert { id: number; symbol: string; triggerPrice: string; direction: string; note: string | null; status: string; triggeredAt: string | null }

  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString();
  }, []);

  const { data: triggeredAlerts = [], refetch: refetchTriggered } = useQuery({
    queryKey: ['price-alerts-triggered'],
    queryFn: () => apiGet<PriceAlert[]>(`/price-alerts?status=triggered&since=${todayStart}`),
    staleTime: 30_000,
  });

  // ── Overdue / due-today flags ─────────────────────────────────────────────────

  const overdueAndToday = useMemo<EnrichedFlag[]>(() => {
    if (!openFlags) return [];
    const now = new Date();
    return openFlags
      .filter(f => f.dueAt != null && f.resolvedAt == null)
      .map(f => {
        const due = new Date(f.dueAt!);
        const isPast = due < now && !isSameCalendarDay(due, now);
        const isToday = isSameCalendarDay(due, now);
        if (!isPast && !isToday) return null;
        const pos = f.positionId != null ? positions.find(p => p.id === f.positionId) : undefined;
        const acc = accounts.find(a => a.id === f.accountId);
        return {
          ...f,
          symbol: pos?.symbol ?? null,
          accountName: acc?.name ?? `Account ${f.accountId}`,
          daysOverdue: isPast ? tradingDaysBetween(due, now) : 0,
        } satisfies EnrichedFlag;
      })
      .filter((f): f is EnrichedFlag => f !== null)
      .sort((a, b) => b.daysOverdue - a.daysOverdue);
  }, [openFlags, positions, accounts]);

  // ── Actions ───────────────────────────────────────────────────────────────────

  const allActions = useMemo(
    () => reconcileActions(computedActions, dbAlerts ?? []),
    [computedActions, dbAlerts],
  );

  // ── Refresh ───────────────────────────────────────────────────────────────────

  const handleRefresh = useCallback(async () => {
    await refreshAll();
    generateAlerts();
    refetchFlags();
    refetchPulse();
  }, [refreshAll, generateAlerts, refetchFlags, refetchPulse]);

  // ── Dismiss ───────────────────────────────────────────────────────────────────

  const handleDismiss = useCallback((action: Action) => {
    if (action.severity === 'red') {
      setDismissModal({ action });
    } else {
      action.dbIds?.forEach(id => patchAlert({ id }));
    }
  }, [patchAlert]);

  const confirmDismiss = useCallback((reason: DismissReason) => {
    if (!dismissModal) return;
    const { action } = dismissModal;
    action.dbIds?.forEach(id => patchAlert({ id, reason }));
    if (reason === 'Will act within 5 days') {
      const dueAt = addTradingDays(new Date(), 5).toISOString();
      const flagType = action.type === 'concentration' ? 'trim' :
        action.type === 'leverage' ? 'reduce_leverage' : 'review';
      createFlag({
        positionId: action.positionId ?? undefined,
        accountId: action.accountId,
        flagType,
        source: 'user',
        dueAt,
        appGeneratedReasonSnapshot: action.explanation,
      });
    }
    setDismissModal(null);
  }, [dismissModal, patchAlert, createFlag]);

  // ── AI context ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!summary) return;
    setAIContext({
      screen: 'home',
      violations: allActions.map(a => ({
        type: a.type,
        category: a.category,
        severity: a.severity,
        detail: a.label,
        explanation: a.explanation,
      })),
      macro_posture: macroPosture?.label ?? 'Unknown',
      sleeves_summary: (summary.accounts ?? []).map(s => ({
        name: s.name,
        value: s.nav,
        change_pct: s.dayChangePct ?? 0,
      })),
    });
  }, [allActions, summary, macroPosture]);

  // ── Render ────────────────────────────────────────────────────────────────────

  const bottomPad = Platform.OS === 'web' ? 100 : insets.bottom + 80;
  const dayChange = summary?.dayChange ?? 0;
  const dayChangePct = summary?.dayChangePct ?? 0;
  const totalNav = summary?.totalNav ?? 0;

  const navigateToAction = useCallback((action: Action) => {
    if (action.positionId != null) {
      router.push({ pathname: '/action-detail', params: { actionId: action.id } });
    } else {
      router.push({ pathname: '/account/[id]', params: { id: String(action.accountId) } });
    }
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.deep} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={handleRefresh} tintColor={colors.ink3} />
        }
        contentContainerStyle={{ paddingBottom: bottomPad }}
      >

        {/* ── Posture strip (dark header) ── */}
        {macroPosture?.label ? (
          <PostureStrip
            label={macroPosture.label}
            notes={macroPosture.notes}
            recessionRisk={(macroPosture as any).recessionRisk ?? null}
            topPad={topPad}
          />
        ) : (
          <View style={[styles.postureEmpty, { paddingTop: topPad + 14 }]} />
        )}

        {/* ── Hero ── */}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.dateLabel}>{getTodayLabel()}</Text>
              <Text style={styles.greeting}>
                Good {getGreeting()},{' '}
                <Text style={styles.greetingItalic}>Taher.</Text>
              </Text>
            </View>
            <Pressable
              onPress={async () => {
                resetState();
                await signOut();
                router.replace('/auth/signin');
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ paddingTop: 4 }}
            >
              <Text style={styles.signOutLabel}>{isDemo ? 'EXIT DEMO' : 'SIGN OUT'}</Text>
            </Pressable>
          </View>

          <Text style={styles.navEyebrow}>NET LIQUID VALUE</Text>
          <Text style={styles.navFigure}>
            ${totalNav.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </Text>
          <View style={styles.pnlRow}>
            <Text style={[styles.pnlNum, { color: dayChange >= 0 ? colors.positive : colors.negative }]}>
              {fmtSigned(dayChange)}
            </Text>
            <Text style={[styles.pnlNum, { color: dayChange >= 0 ? colors.positive : colors.negative }]}>
              {fmtPct(dayChangePct)}
            </Text>
            <Text style={styles.pnlSep}>·</Text>
            <Text style={styles.pnlMeta}>today</Text>
          </View>
        </View>

        {/* ── IPS health strip ── */}
        <IpsHealthStrip
          actions={allActions}
          onActionPress={navigateToAction}
          onDismiss={handleDismiss}
        />

        {/* ── Opportunities strip ── */}
        <OpportunitiesStrip opportunities={computedOpportunities} />

        {/* ── Contribution bars (from pulse) ── */}
        {pulseData && pulseData.contributions.length > 0 && (
          <ContributionBars pulse={pulseData} totalNav={totalNav} />
        )}

        {/* ── Movers grid ── */}
        {pulseData && (pulseData.leaders.length > 0 || pulseData.laggards.length > 0) && (
          <MoversGrid leaders={pulseData.leaders} laggards={pulseData.laggards} />
        )}

        {/* ── Commitments (due/overdue) ── */}
        {overdueAndToday.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Commitments</Text>
              <View style={[styles.countBadge, { backgroundColor: colors.amberSoft }]}>
                <Text style={[styles.countBadgeText, { color: colors.amber }]}>{overdueAndToday.length}</Text>
              </View>
            </View>
            <View style={styles.sectionCard}>
              {overdueAndToday.map(flag => (
                <CommitmentCard
                  key={flag.id}
                  flag={flag}
                  onDone={() => resolveFlag({ id: flag.id, resolutionType: 'manual_complete' })}
                  onView={() => {
                    if (flag.symbol) {
                      router.push({ pathname: '/position/[ticker]', params: { ticker: flag.symbol, accountId: String(flag.accountId) } });
                    } else {
                      router.push({ pathname: '/account/[id]', params: { id: String(flag.accountId) } });
                    }
                  }}
                />
              ))}
            </View>
          </View>
        )}

        {/* ── Triggered price alerts ── */}
        {triggeredAlerts.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Price alerts triggered</Text>
              <View style={[styles.countBadge, { backgroundColor: colors.amberSoft }]}>
                <Text style={[styles.countBadgeText, { color: colors.amber }]}>{triggeredAlerts.length}</Text>
              </View>
            </View>
            <View style={styles.sectionCard}>
              {triggeredAlerts.map((a, i) => {
                const dir = a.direction === 'above' ? '↑' : '↓';
                return (
                  <View key={a.id} style={[styles.triggeredRow, i > 0 && styles.triggeredBorder]}>
                    <View style={[styles.triggeredBar, { backgroundColor: colors.amber }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.triggeredLabel}>
                        {a.symbol} hit {dir} ${parseFloat(a.triggerPrice).toFixed(2)}
                      </Text>
                      {a.note ? <Text style={styles.triggeredNote}>{a.note}</Text> : null}
                    </View>
                    <Pressable
                      hitSlop={8}
                      onPress={() => apiPatch(`/price-alerts/${a.id}`, { status: 'dismissed' }).then(() => refetchTriggered())}
                    >
                      <Text style={styles.triggeredDone}>Done</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* ── Watchlist (ripening) ── */}
        <WatchlistSection positions={positions} />

        {/* ── Daily review entry ── */}
        <Pressable style={styles.reviewRow} onPress={() => router.push('/daily-review')}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.reviewLabel}>DAILY REVIEW</Text>
            <Text style={styles.reviewSub}>
              {allActions.length > 0
                ? `${allActions.length} violation${allActions.length === 1 ? '' : 's'}`
                : 'No violations'}
              {overdueAndToday.length > 0
                ? `  ·  ${overdueAndToday.length} overdue`
                : ''}
            </Text>
          </View>
          <Text style={styles.reviewChevron}>›</Text>
        </Pressable>

        {/* ── Error banner ── */}
        {error && (
          <Pressable style={styles.errorBanner} onPress={handleRefresh}>
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.errorRetry}>Retry</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* ── Dismiss modal ── */}
      <Modal visible={!!dismissModal} animationType="slide" presentationStyle="pageSheet" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Why are you dismissing this?</Text>
            <Text style={styles.modalSub} numberOfLines={3}>{dismissModal?.action.label}</Text>
            {DISMISS_REASONS.map(reason => (
              <Pressable key={reason} style={styles.reasonRow} onPress={() => confirmDismiss(reason)}>
                <Text style={styles.reasonText}>{reason}</Text>
                <Text style={styles.reasonChevron}>›</Text>
              </Pressable>
            ))}
            <Pressable style={styles.cancelBtn} onPress={() => setDismissModal(null)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  postureEmpty: {
    backgroundColor: colors.deep,
    paddingHorizontal: 22,
    paddingBottom: 18,
    minHeight: 20,
  },

  // Hero
  hero: {
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 10,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  dateLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  greeting: {
    fontFamily: fonts.serif,
    fontSize: 24,
    letterSpacing: -0.01 * 24,
    color: colors.ink,
    marginTop: 5,
    lineHeight: 28,
  },
  greetingItalic: { fontFamily: fonts.serifItalic },
  signOutLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  navEyebrow: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  navFigure: {
    fontFamily: fonts.mono,
    fontSize: 38,
    letterSpacing: -0.02 * 38,
    color: colors.ink,
    marginTop: 4,
    lineHeight: 44,
    fontVariant: ['tabular-nums'],
  },
  pnlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  pnlNum: {
    fontFamily: fonts.mono,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  pnlSep: { color: colors.hair2, fontSize: 13 },
  pnlMeta: { fontFamily: fonts.sans, fontSize: 12, color: colors.ink3 },

  // Sections
  section: { paddingHorizontal: 22, marginTop: 22 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  sectionTitle: {
    fontFamily: fonts.serif,
    fontSize: 15,
    letterSpacing: -0.01 * 15,
    color: colors.ink,
  },
  sectionCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.hair2,
    borderRadius: 2,
  },
  countBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countBadgeText: { fontFamily: fonts.mono, fontSize: 11 },

  // Triggered alerts
  triggeredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  triggeredBorder: { borderTopWidth: 1, borderTopColor: colors.hair },
  triggeredBar: { width: 3, height: 28, borderRadius: 2 },
  triggeredLabel: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.ink },
  triggeredNote: { fontFamily: fonts.sans, fontSize: 11, color: colors.ink3, marginTop: 2 },
  triggeredDone: { fontFamily: fonts.sansMedium, fontSize: 11, color: colors.amber },

  // Daily review
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 22,
    marginTop: 22,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.hair2,
    borderRadius: 2,
    backgroundColor: colors.card,
  },
  reviewLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  reviewSub: { fontFamily: fonts.sans, fontSize: 12, color: colors.ink2 },
  reviewChevron: { fontSize: 18, color: colors.ink3 },

  // Error
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 22,
    marginTop: 14,
    padding: 12,
    backgroundColor: colors.negativeLight,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: colors.negative,
  },
  errorText: { fontFamily: fonts.sans, fontSize: 12, color: colors.negative, flex: 1 },
  errorRetry: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.negative },

  // Dismiss modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    padding: 24,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.hair2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.ink,
    marginBottom: 6,
    letterSpacing: -0.01 * 18,
  },
  modalSub: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.ink3,
    lineHeight: 18,
    marginBottom: 20,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.hair,
  },
  reasonText: { fontFamily: fonts.sans, fontSize: 14, color: colors.ink },
  reasonChevron: { fontSize: 18, color: colors.ink3 },
  cancelBtn: {
    marginTop: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.hair,
  },
  cancelText: { fontFamily: fonts.sansMedium, fontSize: 14, color: colors.ink3 },
});
