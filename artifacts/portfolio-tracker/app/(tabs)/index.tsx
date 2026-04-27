import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  Pressable, StatusBar, Platform, Modal,
} from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { usePortfolio, apiGet, apiPost, apiPatch, type Position, type Account } from '@/context/PortfolioContext';
import { useAIContext } from '@/hooks/useAIContext';
import { formatCurrency } from '@/components/ui/PnlBadge';
import {
  computeActions, reconcileActions,
  DEFAULT_CONCENTRATION_LIMIT, DEFAULT_LEVERAGE_CEILING, DRAWDOWN_THRESHOLD_AMBER,
  type Action, type ActionCategory,
} from '@/lib/actions';

// ─── Constants ────────────────────────────────────────────────────────────────

const DISMISS_REASONS = [
  'Reviewed and accepted',
  'Will act within 5 days',
  'No longer relevant',
] as const;

type DismissReason = typeof DISMISS_REASONS[number];

// Trading days: Mon–Fri. Adds N trading days to a date.
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

// Approximate trading days between two dates (calendar × 5/7).
function tradingDaysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  const calDays = ms / 86400000;
  return Math.round(Math.abs(calDays) * (5 / 7));
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
  daysOverdue: number; // 0 = due today, >0 = overdue by N trading days
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

// ─── Grade ────────────────────────────────────────────────────────────────────

function computeGrade(actions: Action[], overdueCount: number): 'A' | 'B' | 'C' | 'D' {
  const hardRules = actions.filter(a => a.category === 'hard_rule');
  const reds = actions.filter(a => a.severity === 'red').length;
  const total = actions.length;
  if (hardRules.length >= 3 || reds >= 3 || total >= 5 || overdueCount >= 3) return 'D';
  if (hardRules.length >= 2 || reds >= 2 || total >= 3 || overdueCount >= 1) return 'C';
  if (hardRules.length >= 1 || reds >= 1 || total >= 1) return 'B';
  return 'A';
}

const GRADE_COLOR: Record<string, string> = {
  A: colors.positive,
  B: colors.gold,
  C: colors.amber,
  D: colors.negative,
};

// ─── Sparkline ────────────────────────────────────────────────────────────────

function seededRand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function Sparkline({ w = 336, h = 44, seed = 1 }: { w?: number; h?: number; seed?: number }) {
  const rand = seededRand(seed);
  const pts: number[] = [];
  let v = 0.5;
  for (let i = 0; i < 60; i++) {
    v = Math.max(0.05, Math.min(0.95, v + (rand() - 0.48) * 0.08));
    pts.push(v);
  }
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = (max - min) || 1;
  const xs = pts.map((_, i) => (i / (pts.length - 1)) * w);
  const ys = pts.map(p => h - ((p - min) / range) * (h - 4) - 2);

  let d = `M ${xs[0]} ${ys[0]}`;
  for (let i = 1; i < xs.length; i++) {
    d += ` L ${xs[i]} ${ys[i]}`;
  }
  const fillD = `${d} L ${xs[xs.length - 1]} ${h} L ${xs[0]} ${h} Z`;

  return (
    <Svg width={w} height={h}>
      <Defs>
        <LinearGradient id="spfill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.ink2} stopOpacity="0.12" />
          <Stop offset="1" stopColor={colors.ink2} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Path d={fillD} fill="url(#spfill)" />
      <Path d={d} stroke={colors.ink2} strokeWidth={1} fill="none" />
    </Svg>
  );
}

// ─── Grade circle ─────────────────────────────────────────────────────────────

function GradeCircle({ grade, size = 22 }: { grade: string; size?: number }) {
  const c = GRADE_COLOR[grade] ?? colors.ink3;
  const dim = size * 1.6;
  return (
    <View style={[gradeStyles.circle, { width: dim, height: dim, borderRadius: dim, borderColor: c }]}>
      <Text style={[gradeStyles.label, { fontSize: size, color: c }]}>{grade}</Text>
    </View>
  );
}

const gradeStyles = StyleSheet.create({
  circle: { borderWidth: 1.2, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: fonts.serifItalic, lineHeight: undefined },
});

// ─── Category label ───────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<ActionCategory, string> = {
  hard_rule: 'RULE BROKEN',
  commitment: 'COMMITMENT',
  threshold: 'THRESHOLD',
  informational: 'FYI',
};

const CATEGORY_COLOR: Record<ActionCategory, string> = {
  hard_rule: colors.negative,
  commitment: colors.amber,
  threshold: colors.gold,
  informational: colors.ink3,
};

// ─── Action card ─────────────────────────────────────────────────────────────

function ActionCard({
  action,
  onPress,
  onDismiss,
  showCategory,
}: {
  action: Action;
  onPress: () => void;
  onDismiss?: () => void;
  showCategory?: boolean;
}) {
  const catColor = CATEGORY_COLOR[action.category];
  const severityColor = action.severity === 'red' ? colors.negative : colors.amber;

  return (
    <Pressable style={styles.actionCard} onPress={onPress}>
      <View style={[styles.actionCardBar, { backgroundColor: severityColor }]} />
      <View style={styles.actionCardBody}>
        {showCategory && (
          <Text style={[styles.actionCatLabel, { color: catColor }]}>
            {CATEGORY_LABEL[action.category]}
          </Text>
        )}
        <Text style={styles.actionCardTitle}>{action.label}</Text>
        <Text style={styles.actionCardExplanation}>{action.explanation}</Text>
      </View>
      {onDismiss && (
        <Pressable hitSlop={8} onPress={onDismiss} style={styles.actionCardDismiss}>
          <Text style={styles.actionCardDismissText}>×</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

// ─── Commitment card ──────────────────────────────────────────────────────────

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
    ? `OVERDUE · ${flag.daysOverdue} ${flag.daysOverdue === 1 ? 'day' : 'days'}`
    : 'DUE TODAY';

  const subject = flag.symbol
    ? `${flag.symbol} · ${flag.accountName}`
    : flag.accountName;

  return (
    <View style={styles.commitCard}>
      <View style={[styles.commitBar, { backgroundColor: badgeColor }]} />
      <View style={styles.commitBody}>
        <View style={styles.commitTop}>
          <Text style={[styles.commitBadge, { color: badgeColor }]}>{badgeText}</Text>
          <Text style={styles.commitType}>{FLAG_TYPE_LABEL[flag.flagType] ?? flag.flagType}</Text>
        </View>
        <Text style={styles.commitSubject}>{subject}</Text>
        {flag.appGeneratedReasonSnapshot ? (
          <Text style={styles.commitReason} numberOfLines={2}>
            {flag.appGeneratedReasonSnapshot}
          </Text>
        ) : null}
        <View style={styles.commitActions}>
          <Pressable style={styles.commitDoneBtn} onPress={onDone}>
            <Text style={styles.commitDoneText}>✓ Done</Text>
          </Pressable>
          <Pressable style={styles.commitViewBtn} onPress={onView}>
            <Text style={styles.commitViewText}>View →</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { summary, accounts, positions, isLoading, error, refreshAll } = usePortfolio();
  const { setAIContext } = useAIContext();
  const topPad = Platform.OS === 'web' ? 20 : insets.top;

  const [dismissModal, setDismissModal] = useState<{ action: Action } | null>(null);

  useEffect(() => {
    refreshAll();
    const interval = setInterval(() => refreshAll(), 60_000);
    return () => clearInterval(interval);
  }, []);

  // ── Derived data ─────────────────────────────────────────────────────────────

  const sleeveNavMap = useMemo<Map<number, number>>(
    () => new Map((summary?.accounts ?? []).map(a => [a.id, a.nav])),
    [summary],
  );

  const sleeves = useMemo(
    () =>
      (summary?.accounts ?? []).map(acc => ({
        id: acc.id,
        name: acc.name,
        nav: acc.nav,
        dayChangePct: acc.dayChangePct,
        positionCount: acc.positionCount,
        unrealizedPnlPct: acc.unrealizedPnlPct,
      })),
    [summary, accounts],
  );

  const computedActions = useMemo(
    () => computeActions(accounts, positions, sleeveNavMap),
    [accounts, positions, sleeveNavMap],
  );

  // ── DB alerts ────────────────────────────────────────────────────────────────

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

  // ── Position flags (commitment ledger) ───────────────────────────────────────

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

  // ── Triggered price alerts (today) ───────────────────────────────────────────

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

  // ── Actions split ────────────────────────────────────────────────────────────

  const allActions = useMemo(
    () => reconcileActions(computedActions, dbAlerts ?? []),
    [computedActions, dbAlerts],
  );

  // Hard-rule and commitment items → "Rules broken" section
  const rulesBroken = useMemo(
    () => allActions.filter(a => a.category === 'hard_rule' || a.category === 'commitment'),
    [allActions],
  );

  // Threshold and informational → "Worth a look" section
  const worthALook = useMemo(
    () => allActions.filter(a => a.category === 'threshold' || a.category === 'informational'),
    [allActions],
  );

  const grade = useMemo(
    () => computeGrade(allActions, overdueAndToday.filter(f => f.daysOverdue > 0).length),
    [allActions, overdueAndToday],
  );

  // ── Pulse snapshot ────────────────────────────────────────────────────────────

  const [pulseBest, pulseWorst] = useMemo(() => {
    const sorted = [...positions].sort((a, b) => b.dayChangePct - a.dayChangePct);
    const worst = sorted.slice(-2).reverse();
    return [sorted.slice(0, 2), worst];
  }, [positions]);

  // ── Refresh ──────────────────────────────────────────────────────────────────

  const handleRefresh = useCallback(async () => {
    await refreshAll();
    generateAlerts();
    refetchFlags();
  }, [refreshAll, generateAlerts, refetchFlags]);

  // ── Dismiss ──────────────────────────────────────────────────────────────────

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

    // Acknowledge the DB alert
    action.dbIds?.forEach(id => patchAlert({ id, reason }));

    // If user committed to acting within 5 days, create a position flag
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

  // ── AI context ───────────────────────────────────────────────────────────────

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
      macro_posture: 'Unknown',
      sleeves_summary: sleeves.map(s => ({
        name: s.name,
        value: s.nav,
        change_pct: s.dayChangePct ?? 0,
      })),
    });
  }, [allActions, sleeves, summary]);

  // ── Top action (hard rules only for "The One Thing") ─────────────────────────

  const topAction = rulesBroken[0] ?? null;

  // ── Render ───────────────────────────────────────────────────────────────────

  const bottomPad = Platform.OS === 'web' ? 100 : insets.bottom + 80;

  const navigateToAction = useCallback((action: Action) => {
    if (action.positionId != null) {
      router.push({ pathname: '/action-detail', params: { actionId: action.id } });
    } else {
      router.push({ pathname: '/account/[id]', params: { id: String(action.accountId) } });
    }
  }, []);

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.bg} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={handleRefresh} tintColor={colors.ink3} />
        }
        contentContainerStyle={{ paddingBottom: bottomPad }}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>{getTodayLabel()}</Text>
            <Text style={styles.greeting}>
              Good {getGreeting()},{'\n'}
              <Text style={styles.greetingItalic}>Taher.</Text>
            </Text>
          </View>
          <GradeCircle grade={grade} size={22} />
        </View>

        {/* ── NAV block ── */}
        <View style={styles.navBlock}>
          <Text style={styles.navEyebrow}>NET LIQUID VALUE</Text>
          <Text style={styles.navFigure}>
            ${(summary?.totalNav ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </Text>
          <View style={styles.navMeta}>
            <Text style={styles.navMetaLabel}>Today</Text>
            <Text style={[styles.navMetaNum, { color: (summary?.dayChange ?? 0) >= 0 ? colors.positive : colors.negative }]}>
              {fmtSigned(summary?.dayChange ?? 0)}
            </Text>
            <Text style={[styles.navMetaNum, { color: (summary?.dayChange ?? 0) >= 0 ? colors.positive : colors.negative }]}>
              {fmtPct(summary?.dayChangePct ?? 0)}
            </Text>
            <Text style={styles.navDot}>·</Text>
            <Text style={styles.navMetaLabel}>All-time</Text>
            <Text style={[styles.navMetaNum, { color: (summary?.totalUnrealizedPnlPct ?? 0) >= 0 ? colors.positive : colors.negative }]}>
              {fmtPct(summary?.totalUnrealizedPnlPct ?? 0)}
            </Text>
          </View>
          <View style={styles.sparkContainer}>
            <Sparkline w={336} h={44} seed={Math.floor(Date.now() / 86400000)} />
          </View>
        </View>

        {/* ── Pulse teaser ── */}
        {positions.length > 0 && (
          <Pressable style={styles.pulseCard} onPress={() => router.push('/(tabs)/pulse')}>
            <View style={styles.pulseCardTop}>
              <View>
                <Text style={styles.pulseEyebrow}>TODAY'S PULSE</Text>
                <Text style={styles.pulseHeadline}>
                  <Text style={styles.pulseItalic}>
                    {pulseBest[0] ? `${pulseBest[0].symbol} leading,` : 'Markets moving,'}
                  </Text>
                  {pulseWorst[0] ? ` ${pulseWorst[0].symbol} slipping.` : ' mixed signals.'}
                </Text>
              </View>
              <Text style={[styles.navMetaNum, { fontSize: 15, color: (summary?.dayChangePct ?? 0) >= 0 ? colors.positive : colors.negative, fontFamily: fonts.monoMedium }]}>
                {fmtPct(summary?.dayChangePct ?? 0)}
              </Text>
            </View>
            <View style={styles.pulseGrid}>
              <View style={styles.pulseCol}>
                <Text style={[styles.pulseColLabel, { color: colors.positive }]}>LEADERS</Text>
                {pulseBest.map(p => (
                  <View key={p.symbol} style={styles.pulseRow}>
                    <Text style={styles.pulseTicker}>{p.symbol}</Text>
                    <Text style={[styles.pulsePct, { color: colors.positive }]}>{fmtPct(p.dayChangePct)}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.pulseCol}>
                <Text style={[styles.pulseColLabel, { color: colors.negative }]}>LAGGARDS</Text>
                {pulseWorst.map(p => (
                  <View key={p.symbol} style={styles.pulseRow}>
                    <Text style={styles.pulseTicker}>{p.symbol}</Text>
                    <Text style={[styles.pulsePct, { color: colors.negative }]}>{fmtPct(p.dayChangePct)}</Text>
                  </View>
                ))}
              </View>
            </View>
            <Text style={styles.pulseLink}>Open the full Pulse →</Text>
          </Pressable>
        )}

        {/* ── Daily review entry ── */}
        <Pressable style={styles.reviewRow} onPress={() => router.push('/daily-review')}>
          <View style={styles.reviewLeft}>
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

        {/* ── The One Thing (top hard-rule only) ── */}
        {topAction && (
          <View style={styles.oneThing}>
            <Text style={styles.oneThingEyebrow}>THE ONE THING TODAY</Text>
            <View style={styles.oneThingPanel}>
              <Text style={[styles.oneThingCat, { color: CATEGORY_COLOR[topAction.category] }]}>
                {CATEGORY_LABEL[topAction.category]}
              </Text>
              <Text style={styles.oneThingHeadline}>{topAction.label}</Text>
              <Text style={styles.oneThingExplanation}>{topAction.explanation}</Text>
              <View style={styles.oneThingBtns}>
                <Pressable style={styles.primaryBtn} onPress={() => navigateToAction(topAction)}>
                  <Text style={styles.primaryBtnText}>Review</Text>
                </Pressable>
                {(topAction.dbIds?.length ?? 0) > 0 && (
                  <Pressable style={styles.secondaryBtn} onPress={() => handleDismiss(topAction)}>
                    <Text style={styles.secondaryBtnText}>Not today</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        )}

        {/* ── Sleeves ledger ── */}
        <View style={styles.ledgerSection}>
          <View style={styles.ledgerHeader}>
            <Text style={styles.ledgerTitle}>Sleeves</Text>
            <Text style={styles.ledgerMeta}>{sleeves.length} accounts</Text>
          </View>
          <View style={styles.ledgerTable}>
            {sleeves.map((sleeve, i) => (
              <Pressable
                key={sleeve.id}
                style={[styles.ledgerRow, i > 0 && styles.ledgerRowBorder]}
                onPress={() => router.push({ pathname: '/account/[id]', params: { id: String(sleeve.id) } })}
              >
                <View style={styles.ledgerRowLeft}>
                  <Text style={styles.ledgerRowName}>{sleeve.name}</Text>
                  <Text style={styles.ledgerRowMeta}>{sleeve.positionCount} pos</Text>
                </View>
                <View style={styles.ledgerRowRight}>
                  <Text style={styles.ledgerNav}>
                    ${sleeve.nav.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </Text>
                  <Text style={[styles.ledgerDayPct, {
                    color: (sleeve.dayChangePct ?? 0) >= 0 ? colors.positive : colors.negative,
                  }]}>
                    {fmtPct(sleeve.dayChangePct ?? 0)}
                  </Text>
                  <Text style={styles.ledgerChevron}>›</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>

        {/* ── Commitments (overdue + due today) ── */}
        {overdueAndToday.length > 0 && (
          <View style={styles.actionsSection}>
            <View style={styles.actionsSectionHeader}>
              <Text style={styles.ledgerTitle}>Commitments</Text>
              <View style={[styles.actionCountBadge, { backgroundColor: `${colors.amber}25` }]}>
                <Text style={[styles.actionCountText, { color: colors.amber }]}>
                  {overdueAndToday.length}
                </Text>
              </View>
            </View>
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
        )}

        {/* ── Triggered price alerts ── */}
        {triggeredAlerts.length > 0 && (
          <View style={styles.actionsSection}>
            <View style={styles.actionsSectionHeader}>
              <Text style={styles.ledgerTitle}>Price alerts triggered</Text>
              <View style={[styles.actionCountBadge, { backgroundColor: `${colors.amber}20` }]}>
                <Text style={[styles.actionCountText, { color: colors.amber }]}>{triggeredAlerts.length}</Text>
              </View>
            </View>
            {triggeredAlerts.map(a => {
              const dir = a.direction === 'above' ? '↑' : '↓';
              return (
                <View key={a.id} style={styles.triggeredAlertRow}>
                  <View style={[styles.triggeredAlertBar, { backgroundColor: colors.amber }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.triggeredAlertLabel}>
                      {a.symbol} hit {dir} ${parseFloat(a.triggerPrice).toFixed(2)}
                    </Text>
                    {a.note ? <Text style={styles.triggeredAlertNote}>{a.note}</Text> : null}
                  </View>
                  <Pressable
                    hitSlop={8}
                    onPress={() => apiPatch(`/price-alerts/${a.id}`, { status: 'dismissed' }).then(() => refetchTriggered())}
                  >
                    <Text style={styles.triggeredAlertDismiss}>Done</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}

        {/* ── Rules broken ── */}
        {rulesBroken.length > 0 && (
          <View style={styles.actionsSection}>
            <View style={styles.actionsSectionHeader}>
              <Text style={styles.ledgerTitle}>Rules broken</Text>
              <View style={[styles.actionCountBadge, { backgroundColor: `${colors.negative}20` }]}>
                <Text style={[styles.actionCountText, { color: colors.negative }]}>{rulesBroken.length}</Text>
              </View>
            </View>
            {rulesBroken.map(action => (
              <ActionCard
                key={action.id}
                action={action}
                showCategory={rulesBroken.some(a => a.category !== rulesBroken[0].category)}
                onPress={() => navigateToAction(action)}
                onDismiss={(action.dbIds?.length ?? 0) > 0 ? () => handleDismiss(action) : undefined}
              />
            ))}
          </View>
        )}

        {/* ── Worth a look ── */}
        {worthALook.length > 0 && (
          <View style={styles.actionsSection}>
            <View style={styles.actionsSectionHeader}>
              <Text style={[styles.ledgerTitle, styles.worthALookTitle]}>Worth a look</Text>
              <View style={[styles.actionCountBadge, { backgroundColor: `${colors.ink3}15` }]}>
                <Text style={[styles.actionCountText, { color: colors.ink3 }]}>{worthALook.length}</Text>
              </View>
            </View>
            {worthALook.map(action => (
              <ActionCard
                key={action.id}
                action={action}
                showCategory
                onPress={() => navigateToAction(action)}
                onDismiss={(action.dbIds?.length ?? 0) > 0 ? () => handleDismiss(action) : undefined}
              />
            ))}
          </View>
        )}

        {/* ── Clean state ── */}
        {allActions.length === 0 && overdueAndToday.length === 0 && !isLoading && (
          <View style={styles.cleanState}>
            <Text style={styles.cleanStateGrade}>A</Text>
            <Text style={styles.cleanStateText}>No rule violations today.</Text>
          </View>
        )}

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

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 4,
  },
  eyebrow: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  greeting: {
    fontFamily: fonts.serif,
    fontSize: 26,
    lineHeight: 28,
    letterSpacing: -0.02 * 26,
    color: colors.ink,
    marginTop: 6,
  },
  greetingItalic: { fontFamily: fonts.serifItalic },

  // NAV block
  navBlock: { paddingHorizontal: 22, paddingTop: 22, paddingBottom: 4 },
  navEyebrow: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  navFigure: {
    fontFamily: fonts.mono,
    fontSize: 40,
    fontWeight: '500',
    letterSpacing: -0.02 * 40,
    color: colors.ink,
    marginTop: 6,
    lineHeight: 44,
  },
  navMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  navMetaLabel: { fontFamily: fonts.sans, fontSize: 12, color: colors.ink2 },
  navMetaNum: { fontFamily: fonts.mono, fontSize: 12, fontVariant: ['tabular-nums'] },
  navDot: { color: colors.hair2, fontSize: 12 },
  sparkContainer: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.hair,
    paddingTop: 14,
  },

  // Pulse teaser
  pulseCard: {
    marginHorizontal: 22,
    marginTop: 18,
    marginBottom: 16,
    padding: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.hair2,
    borderRadius: 2,
  },
  pulseCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  pulseEyebrow: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: colors.accent,
  },
  pulseHeadline: {
    fontFamily: fonts.serif,
    fontSize: 15,
    color: colors.ink,
    marginTop: 3,
    letterSpacing: -0.005 * 15,
  },
  pulseItalic: { fontFamily: fonts.serifItalic },
  pulseGrid: { flexDirection: 'row', gap: 10, marginTop: 4 },
  pulseCol: { flex: 1 },
  pulseColLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  pulseRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  pulseTicker: { fontFamily: fonts.mono, fontSize: 11, fontWeight: '600', color: colors.ink },
  pulsePct: { fontFamily: fonts.mono, fontSize: 11, fontVariant: ['tabular-nums'] },
  pulseLink: {
    marginTop: 10,
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.accent,
    textDecorationLine: 'underline',
  },

  // Daily review entry
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 22,
    marginBottom: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.hair2,
    borderRadius: 2,
    backgroundColor: colors.card,
  },
  reviewLeft: { flex: 1, gap: 2 },
  reviewLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  reviewSub: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.ink2,
  },
  reviewChevron: {
    fontSize: 18,
    color: colors.ink3,
  },

  // One thing
  oneThing: { paddingHorizontal: 22, marginBottom: 16 },
  oneThingEyebrow: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: colors.gold,
    marginBottom: 8,
  },
  oneThingPanel: {
    backgroundColor: colors.deep,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: 2,
    padding: 16,
  },
  oneThingCat: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  oneThingHeadline: {
    fontFamily: fonts.serif,
    fontSize: 17,
    lineHeight: 23,
    letterSpacing: -0.01 * 17,
    color: colors.deepInk,
    marginBottom: 8,
  },
  oneThingExplanation: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    color: colors.deepInk2,
    marginBottom: 14,
  },
  oneThingBtns: { flexDirection: 'row', gap: 10 },
  primaryBtn: {
    flex: 1,
    backgroundColor: colors.gold,
    borderRadius: 2,
    paddingVertical: 10,
    alignItems: 'center',
  },
  primaryBtnText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.deep },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.deepHair,
    borderRadius: 2,
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryBtnText: { fontFamily: fonts.sans, fontSize: 13, color: colors.deepInk2 },

  // Sleeves ledger
  ledgerSection: { paddingHorizontal: 22, marginBottom: 20 },
  ledgerHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  ledgerTitle: {
    fontFamily: fonts.serif,
    fontSize: 17,
    letterSpacing: -0.01 * 17,
    color: colors.ink,
  },
  ledgerMeta: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  ledgerTable: { borderTopWidth: 1, borderTopColor: colors.ink },
  ledgerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  ledgerRowBorder: { borderTopWidth: 1, borderTopColor: colors.hair },
  ledgerRowLeft: { flex: 1 },
  ledgerRowName: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.ink },
  ledgerRowMeta: { fontFamily: fonts.mono, fontSize: 10, color: colors.ink3, marginTop: 2 },
  ledgerRowRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ledgerNav: { fontFamily: fonts.mono, fontSize: 13, fontVariant: ['tabular-nums'], color: colors.ink },
  ledgerDayPct: { fontFamily: fonts.mono, fontSize: 12, fontVariant: ['tabular-nums'] },
  ledgerChevron: { fontSize: 16, color: colors.ink3 },

  // Actions sections
  actionsSection: { paddingHorizontal: 22, marginBottom: 20 },
  actionsSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  worthALookTitle: { color: colors.ink2 },
  actionCountBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  actionCountText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: '600',
  },

  // Triggered alert row
  triggeredAlertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.hair,
  },
  triggeredAlertBar: { width: 3, height: 28, borderRadius: 2 },
  triggeredAlertLabel: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.ink },
  triggeredAlertNote: { fontFamily: fonts.sans, fontSize: 11, color: colors.ink3, marginTop: 2 },
  triggeredAlertDismiss: { fontFamily: fonts.sansMedium, fontSize: 12, color: colors.amber },

  // Action card
  actionCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: 1,
    borderTopColor: colors.hair,
    paddingVertical: 12,
  },
  actionCardBar: {
    width: 3,
    borderRadius: 2,
    marginRight: 12,
    minHeight: 36,
  },
  actionCardBody: { flex: 1 },
  actionCatLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  actionCardTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.ink,
    lineHeight: 18,
    marginBottom: 3,
  },
  actionCardExplanation: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.ink2,
    lineHeight: 17,
  },
  actionCardDismiss: { paddingHorizontal: 8, justifyContent: 'center' },
  actionCardDismissText: { fontSize: 18, color: colors.ink3, lineHeight: 20 },

  // Commitment card
  commitCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: 1,
    borderTopColor: colors.hair,
    paddingVertical: 12,
  },
  commitBar: {
    width: 3,
    borderRadius: 2,
    marginRight: 12,
    minHeight: 36,
  },
  commitBody: { flex: 1 },
  commitTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
  },
  commitBadge: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  commitType: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  commitSubject: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.ink,
    lineHeight: 18,
  },
  commitReason: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.ink2,
    lineHeight: 17,
    marginTop: 2,
  },
  commitActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  commitDoneBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 2,
    backgroundColor: `${colors.positive}18`,
    borderWidth: 1,
    borderColor: `${colors.positive}40`,
  },
  commitDoneText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.positive,
  },
  commitViewBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: colors.hair2,
  },
  commitViewText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.ink2,
  },

  // Clean state
  cleanState: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 22,
  },
  cleanStateGrade: {
    fontFamily: fonts.serifItalic,
    fontSize: 48,
    color: colors.positive,
    marginBottom: 8,
  },
  cleanStateText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.ink3,
  },

  // Error
  errorBanner: {
    marginHorizontal: 22,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: colors.negativeLight,
    borderRadius: 2,
  },
  errorText: { flex: 1, fontFamily: fonts.sans, fontSize: 13, color: colors.negative },
  errorRetry: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: colors.negative },

  // Dismiss modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(21,18,12,0.5)',
  },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    padding: 20,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.hair2,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: { fontFamily: fonts.serif, fontSize: 18, color: colors.ink, marginBottom: 8 },
  modalSub: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.ink2,
    marginBottom: 20,
    lineHeight: 18,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    borderTopWidth: 1,
    borderTopColor: colors.hair,
  },
  reasonText: { fontFamily: fonts.sansMedium, fontSize: 15, color: colors.ink },
  reasonChevron: { fontSize: 18, color: colors.ink3 },
  cancelBtn: {
    marginTop: 12,
    padding: 14,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: colors.hair2,
    alignItems: 'center',
  },
  cancelText: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.ink2 },
});
