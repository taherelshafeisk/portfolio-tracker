import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  Pressable, Platform, ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { apiGet } from '@/context/PortfolioContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AlertItem {
  id: number;
  symbol: string | null;
  alertType: string;
  severity: string;
  category: 'hard_rule' | 'informational';
  title: string;
  message: string;
  accountName: string;
  status: string;
  dismissReason: string | null;
  generatedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

interface FlagItem {
  id: number;
  symbol: string | null;
  flagType: string;
  accountName: string;
  dueAt: string | null;
  resolvedAt: string | null;
  resolutionType: string | null;
  resolutionNote: string | null;
  appGeneratedReasonSnapshot: string | null;
}

interface DailyReview {
  date: string;
  nav: { total: number; dayChange: number; dayChangePct: number };
  newToday: AlertItem[];
  actedOn: { alerts: AlertItem[]; flags: FlagItem[] };
  stillOpen: AlertItem[];
  carryForward: FlagItem[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtNav(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function fmtChange(n: number, pct: number): string {
  const sign = n >= 0 ? '+' : '−';
  const abs = Math.abs(n);
  const dollars = abs >= 1000
    ? `${sign}$${Math.round(abs).toLocaleString()}`
    : `${sign}$${abs.toFixed(0)}`;
  const p = `${n >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  return `${dollars}  ${p}`;
}

function fmtDate(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function tradingDaysFromNow(isoDate: string): number {
  const due = new Date(isoDate);
  const now = new Date();
  const ms = due.getTime() - now.getTime();
  return Math.round((ms / 86400000) * (5 / 7));
}

function severityDotColor(severity: string): string {
  if (severity === 'critical') return colors.negative;
  if (severity === 'warning') return colors.amber;
  return colors.ink3;
}

const FLAG_TYPE_LABEL: Record<string, string> = {
  cut: 'Cut position',
  trim: 'Trim position',
  review: 'Review thesis',
  stop: 'Stop triggered',
  reduce_leverage: 'Reduce leverage',
};

const RESOLUTION_LABEL: Record<string, string> = {
  sold: 'Sold',
  trimmed: 'Trimmed',
  dismissed: 'Dismissed',
  expired: 'Expired',
  manual_complete: 'Marked done',
};

// ─── Row components ───────────────────────────────────────────────────────────

function ActionRow({ item }: { item: AlertItem }) {
  const dot = severityDotColor(item.severity);
  return (
    <View style={s.row}>
      <View style={[s.dot, { backgroundColor: dot }]} />
      <View style={s.rowBody}>
        <Text style={s.rowTitle}>{item.message}</Text>
        <Text style={s.rowSub}>{item.accountName}</Text>
      </View>
    </View>
  );
}

function InfoRow({ item }: { item: AlertItem }) {
  const dot = severityDotColor(item.severity);
  const subject = item.symbol ?? item.accountName;
  const pctMatch = item.message.match(/down ([\d.]+)%/);
  const pct = pctMatch ? `−${pctMatch[1]}%` : null;
  return (
    <View style={s.infoRow}>
      <View style={[s.dot, { backgroundColor: dot }]} />
      <Text style={s.infoSymbol}>{subject}</Text>
      {pct && <Text style={[s.infoPct, { color: dot }]}>{pct}</Text>}
      <Text style={s.infoAccount}>{item.accountName}</Text>
    </View>
  );
}

function ActedAlertRow({ item }: { item: AlertItem }) {
  const verb = item.resolvedAt ? 'Resolved' : 'Dismissed';
  const detail = item.dismissReason ? `"${item.dismissReason}"` : verb;
  return (
    <View style={s.row}>
      <Text style={s.checkmark}>✓</Text>
      <View style={s.rowBody}>
        <Text style={s.rowTitle}>{item.message}</Text>
        <Text style={s.rowSub}>{item.accountName}</Text>
        <Text style={s.rowMeta}>{detail}</Text>
      </View>
    </View>
  );
}

function ActedFlagRow({ item }: { item: FlagItem }) {
  const subject = item.symbol
    ? `${item.symbol} · ${item.accountName}`
    : item.accountName;
  return (
    <View style={s.row}>
      <Text style={s.checkmark}>✓</Text>
      <View style={s.rowBody}>
        <Text style={s.rowTitle}>{FLAG_TYPE_LABEL[item.flagType] ?? item.flagType}</Text>
        <Text style={s.rowSub}>{subject}</Text>
        {item.resolutionType && (
          <Text style={s.rowMeta}>{RESOLUTION_LABEL[item.resolutionType] ?? item.resolutionType}</Text>
        )}
      </View>
    </View>
  );
}

function CarryRow({ item }: { item: FlagItem }) {
  const subject = item.symbol
    ? `${item.symbol} · ${item.accountName}`
    : item.accountName;
  const days = item.dueAt ? tradingDaysFromNow(item.dueAt) : null;
  const dueLabel =
    days === null ? null :
    days < 0 ? `${Math.abs(days)}d overdue` :
    days === 0 ? 'Due today' :
    `Due in ${days}d`;
  const dueColor = days !== null && days <= 0 ? colors.negative : colors.amber;

  return (
    <View style={s.row}>
      <Text style={s.arrow}>→</Text>
      <View style={s.rowBody}>
        <Text style={s.rowTitle}>{FLAG_TYPE_LABEL[item.flagType] ?? item.flagType}</Text>
        <Text style={s.rowSub}>{subject}</Text>
        {dueLabel && <Text style={[s.rowMeta, { color: dueColor }]}>{dueLabel}</Text>}
      </View>
    </View>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

function Section({
  title,
  count,
  accentColor,
  empty,
  children,
}: {
  title: string;
  count: number;
  accentColor: string;
  empty: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>{title}</Text>
        <View style={[s.sectionBadge, { backgroundColor: `${accentColor}20` }]}>
          <Text style={[s.sectionCount, { color: accentColor }]}>{count}</Text>
        </View>
      </View>
      {count === 0
        ? <Text style={s.emptyLabel}>{empty}</Text>
        : children}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DailyReviewScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 20 : insets.top;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['daily-review'],
    queryFn: () => apiGet<DailyReview>('/portfolio/daily-review'),
    staleTime: 60_000,
  });

  // Merge newToday + stillOpen, deduplicate by id, exclude acted-on items
  const requiresAction = useMemo(() => {
    if (!data) return [];
    const actedIds = new Set(data.actedOn.alerts.map(a => a.id));
    const seen = new Set<number>();
    return [...data.newToday, ...data.stillOpen]
      .filter(a => a.category === 'hard_rule' && !actedIds.has(a.id))
      .filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; });
  }, [data]);

  const worthNoting = useMemo(() => {
    if (!data) return [];
    const actedIds = new Set(data.actedOn.alerts.map(a => a.id));
    const seen = new Set<number>();
    return [...data.newToday, ...data.stillOpen]
      .filter(a => a.category !== 'hard_rule' && !actedIds.has(a.id))
      .filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; });
  }, [data]);


  const totalActed = (data?.actedOn.alerts.length ?? 0) + (data?.actedOn.flags.length ?? 0);
  const dayPositive = (data?.nav.dayChange ?? 0) >= 0;

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      <View style={s.navbar}>
        <Pressable onPress={() => router.back()} style={s.backBtn} hitSlop={8}>
          <Feather name="arrow-left" size={20} color={colors.ink} />
        </Pressable>
        <Text style={s.navTitle}>Daily Review</Text>
        <View style={s.backBtn} />
      </View>

      {isLoading && (
        <View style={s.center}>
          <ActivityIndicator color={colors.ink3} />
        </View>
      )}

      {error && !isLoading && (
        <View style={s.center}>
          <Text style={s.errorText}>Failed to load review.</Text>
          <Pressable onPress={() => refetch()} style={s.retryBtn}>
            <Text style={s.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {data && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40 }]}
        >
          <Text style={s.dateLabel}>{fmtDate(data.date)}</Text>

          {/* ── Snapshot ── */}
          <View style={s.snapshot}>
            <Text style={s.snapshotNav}>{fmtNav(data.nav.total)}</Text>
            <Text style={[s.snapshotChange, {
              color: dayPositive ? colors.positive : colors.negative,
            }]}>
              {fmtChange(data.nav.dayChange, data.nav.dayChangePct)} today
            </Text>
          </View>

          {/* ── Requires action ── */}
          <Section
            title="Requires action"
            count={requiresAction.length}
            accentColor={requiresAction.length > 0 ? colors.negative : colors.ink3}
            empty="No rule violations today."
          >
            {requiresAction.map(a => <ActionRow key={a.id} item={a} />)}
          </Section>

          {/* ── Worth noting ── */}
          {worthNoting.length > 0 && (
            <Section
              title="Worth noting"
              count={worthNoting.length}
              accentColor={colors.ink3}
              empty=""
            >
              {worthNoting.map(a => <InfoRow key={a.id} item={a} />)}
            </Section>
          )}

          {/* ── Acted on ── */}
          <Section
            title="Acted on"
            count={totalActed}
            accentColor={totalActed > 0 ? colors.positive : colors.ink3}
            empty="No actions taken today."
          >
            {data.actedOn.alerts.map(a => <ActedAlertRow key={`a-${a.id}`} item={a} />)}
            {data.actedOn.flags.map(f => <ActedFlagRow key={`f-${f.id}`} item={f} />)}
          </Section>

          {/* ── Carry forward ── */}
          {data.carryForward.length > 0 && (
            <Section
              title="Carry forward"
              count={data.carryForward.length}
              accentColor={colors.amber}
              empty=""
            >
              {data.carryForward.map(f => <CarryRow key={f.id} item={f} />)}
            </Section>
          )}

          {/* ── Tomorrow line ── */}
          <View style={s.tomorrowLine}>
            <Text style={s.tomorrowLabel}>TOMORROW</Text>
            <Text style={s.tomorrowText}>
              {[
                requiresAction.length > 0
                  ? `${requiresAction.length} rule${requiresAction.length > 1 ? 's' : ''} still breached`
                  : null,
                data.carryForward.length > 0
                  ? `${data.carryForward.length} open commitment${data.carryForward.length > 1 ? 's' : ''}`
                  : null,
              ].filter(Boolean).join('  ·  ') || 'Clean slate.'}
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  navbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  backBtn: { width: 28, alignItems: 'center' },
  navTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.serif,
    fontSize: 17,
    letterSpacing: -0.01 * 17,
    color: colors.ink,
  },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { fontFamily: fonts.sans, fontSize: 14, color: colors.ink2 },
  retryBtn: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 2, borderWidth: 1, borderColor: colors.hair2,
  },
  retryText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.ink2 },

  scroll: { paddingHorizontal: 22, paddingTop: 4 },

  dateLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.ink3,
    marginBottom: 10,
  },

  snapshot: {
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: colors.ink,
    marginBottom: 24,
    gap: 4,
  },
  snapshotNav: {
    fontFamily: fonts.mono,
    fontSize: 30,
    fontWeight: '500',
    letterSpacing: -0.02 * 30,
    color: colors.ink,
  },
  snapshotChange: {
    fontFamily: fonts.mono,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },

  // Sections
  section: { marginBottom: 26 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  sectionTitle: {
    fontFamily: fonts.serif,
    fontSize: 15,
    letterSpacing: -0.01 * 15,
    color: colors.ink,
  },
  sectionBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  sectionCount: { fontFamily: fonts.mono, fontSize: 11, fontWeight: '600' },
  emptyLabel: { fontFamily: fonts.sans, fontSize: 13, color: colors.ink3, paddingVertical: 4 },

  // Action row (full message shown)
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: colors.hair,
    gap: 10,
  },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.ink,
    lineHeight: 19,
  },
  rowSub: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.ink3,
  },
  rowMeta: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.ink3,
    fontStyle: 'italic',
  },
  dot: {
    width: 6, height: 6, borderRadius: 3,
    marginTop: 7, flexShrink: 0,
  },
  checkmark: {
    fontFamily: fonts.sansBold,
    fontSize: 12,
    color: colors.positive,
    marginTop: 3,
    width: 16,
    textAlign: 'center',
  },
  arrow: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.amber,
    marginTop: 3,
    width: 16,
    textAlign: 'center',
  },

  // Info row (compact — just symbol + pct)
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: colors.hair,
    gap: 8,
  },
  infoSymbol: {
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: '600',
    color: colors.ink,
    width: 48,
  },
  infoPct: {
    fontFamily: fonts.mono,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    width: 56,
  },
  infoAccount: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.ink3,
  },

  // Tomorrow line
  tomorrowLine: {
    borderTopWidth: 1,
    borderTopColor: colors.ink,
    paddingTop: 16,
    gap: 4,
  },
  tomorrowLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  tomorrowText: {
    fontFamily: fonts.serif,
    fontSize: 14,
    color: colors.ink2,
    lineHeight: 21,
  },
});
