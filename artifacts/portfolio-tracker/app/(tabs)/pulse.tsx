import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  Pressable, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { apiGet } from '@/context/PortfolioContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PositionContribution {
  id: number;
  ticker: string;
  name: string;
  accountId: number;
  accountName: string;
  positionBucket: string | null;
  qty: number;
  currentPrice: number;
  marketValue: number;
  dayChangeDollars: number;
  dayChangePct: number;
  unrealizedPnlPct: number;
}

interface PulseData {
  totalDayChange: number;
  contributions: PositionContribution[];
  leaders: PositionContribution[];
  laggards: PositionContribution[];
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtSigned(n: number): string {
  const abs = Math.abs(n);
  const s = abs >= 1000 ? Math.round(abs).toLocaleString() : abs.toFixed(0);
  return (n >= 0 ? '+$' : '−$') + s;
}

function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

// ─── Sleeve bidir bars ────────────────────────────────────────────────────────

function SleeveBidirBars({ contributions }: { contributions: PositionContribution[] }) {
  const sleeves = useMemo(() => {
    const map = new Map<string, { dayChange: number; nav: number }>();
    for (const c of contributions) {
      const key = c.positionBucket ?? c.accountName;
      const existing = map.get(key);
      if (existing) {
        existing.dayChange += c.dayChangeDollars;
        existing.nav += c.marketValue;
      } else {
        map.set(key, { dayChange: c.dayChangeDollars, nav: c.marketValue });
      }
    }
    return Array.from(map.entries())
      .map(([name, { dayChange, nav }]) => ({
        name,
        dayChange,
        dayPct: nav > 0 ? (dayChange / nav) * 100 : 0,
      }))
      .sort((a, b) => b.dayChange - a.dayChange);
  }, [contributions]);

  if (sleeves.length === 0) return null;
  const maxAbs = Math.max(...sleeves.map(s => Math.abs(s.dayChange)), 1);

  return (
    <View style={bidirStyles.card}>
      <Text style={bidirStyles.eyebrow}>BY SLEEVE</Text>
      {sleeves.map((s, i) => {
        const isPos = s.dayChange >= 0;
        const frac = Math.abs(s.dayChange) / maxAbs;
        const barColor = isPos ? colors.positive : colors.negative;
        const barBg = isPos ? colors.positiveLight : colors.negativeLight;
        return (
          <View key={s.name} style={[bidirStyles.row, i > 0 && bidirStyles.rowBorder]}>
            <Text style={bidirStyles.label} numberOfLines={1}>{s.name}</Text>
            <View style={bidirStyles.track}>
              <View
                style={[
                  bidirStyles.bar,
                  {
                    width: `${Math.round(frac * 100)}%`,
                    backgroundColor: barBg,
                    borderRightWidth: isPos ? 2 : 0,
                    borderLeftWidth: isPos ? 0 : 2,
                    borderColor: barColor,
                  },
                ]}
              />
            </View>
            <Text style={[bidirStyles.pct, { color: barColor }]}>{fmtPct(s.dayPct)}</Text>
            <Text style={[bidirStyles.dollar, { color: barColor }]}>{fmtSigned(s.dayChange)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const bidirStyles = StyleSheet.create({
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
  eyebrow: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.ink3,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    gap: 8,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.hair },
  label: { fontFamily: fonts.sans, fontSize: 12, color: colors.ink2, width: 90 },
  track: {
    flex: 1,
    height: 12,
    backgroundColor: colors.bgInset,
    borderRadius: 1,
    overflow: 'hidden',
  },
  bar: { height: '100%', borderRadius: 1 },
  pct: { fontFamily: fonts.mono, fontSize: 11, fontVariant: ['tabular-nums'], width: 58, textAlign: 'right' },
  dollar: { fontFamily: fonts.mono, fontSize: 10, fontVariant: ['tabular-nums'], width: 60, textAlign: 'right', color: colors.ink3 },
});

// ─── Pulse list item ──────────────────────────────────────────────────────────

function PulseListItem({
  item,
  maxAbs,
  isPositive,
}: {
  item: PositionContribution;
  maxAbs: number;
  isPositive: boolean;
}) {
  const barColor = isPositive ? colors.positive : colors.negative;
  const barWidth = maxAbs > 0 ? (Math.abs(item.dayChangeDollars) / maxAbs) * 100 : 0;

  return (
    <Pressable
      style={listStyles.item}
      onPress={() => router.push({ pathname: '/position/[ticker]', params: { ticker: item.ticker, accountId: String(item.accountId) } })}
    >
      <View style={listStyles.row}>
        <Text style={listStyles.ticker}>{item.ticker}</Text>
        <Text style={listStyles.name} numberOfLines={1}>{item.name}</Text>
        <View style={listStyles.right}>
          <Text style={[listStyles.pct, { color: barColor }]}>{fmtPct(item.dayChangePct)}</Text>
          <Text style={[listStyles.dollars, { color: barColor }]}>{fmtSigned(item.dayChangeDollars)}</Text>
        </View>
      </View>
      <View style={listStyles.barTrack}>
        <View style={[listStyles.barFill, { width: `${barWidth}%` as any, backgroundColor: barColor }]} />
      </View>
      <Text style={listStyles.context}>
        <Text style={listStyles.contextLabel}>{item.positionBucket ?? item.accountName}  </Text>
        {isPositive
          ? `Up ${fmtPct(Math.abs(item.dayChangePct))} · since entry ${item.unrealizedPnlPct >= 0 ? '+' : ''}${item.unrealizedPnlPct.toFixed(1)}%`
          : `Down ${fmtPct(Math.abs(item.dayChangePct))} · since entry ${item.unrealizedPnlPct >= 0 ? '+' : ''}${item.unrealizedPnlPct.toFixed(1)}%`}
      </Text>
    </Pressable>
  );
}

const listStyles = StyleSheet.create({
  item: { paddingVertical: 11 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ticker: { fontFamily: fonts.monoBold, fontSize: 13, color: colors.ink, minWidth: 44 },
  name: { flex: 1, fontFamily: fonts.sans, fontSize: 11, color: colors.ink3 },
  right: { alignItems: 'flex-end', gap: 1 },
  pct: { fontFamily: fonts.mono, fontSize: 12, fontVariant: ['tabular-nums'] },
  dollars: { fontFamily: fonts.monoMedium, fontSize: 11, fontVariant: ['tabular-nums'] },
  barTrack: { height: 2, backgroundColor: colors.hair2, borderRadius: 1, marginTop: 5, overflow: 'hidden' },
  barFill: { height: 2, borderRadius: 1 },
  context: { fontFamily: fonts.serifItalic, fontSize: 10.5, color: colors.ink3, marginTop: 4, lineHeight: 15 },
  contextLabel: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: colors.accent },
});

// ─── Timeframe toggle ─────────────────────────────────────────────────────────

type Timeframe = 'today' | 'entry';

function TimeframeToggle({ value, onChange }: { value: Timeframe; onChange: (v: Timeframe) => void }) {
  return (
    <View style={toggleStyles.wrap}>
      {(['today', 'entry'] as Timeframe[]).map(tf => (
        <Pressable key={tf} onPress={() => onChange(tf)} style={toggleStyles.option}>
          <Text style={[toggleStyles.label, value === tf && toggleStyles.labelActive]}>
            {tf === 'today' ? 'Today' : 'Since entry'}
          </Text>
          {value === tf && <View style={toggleStyles.underline} />}
        </Pressable>
      ))}
    </View>
  );
}

const toggleStyles = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: 16 },
  option: { alignItems: 'center' },
  label: { fontFamily: fonts.serif, fontSize: 13, color: colors.ink3 },
  labelActive: { fontFamily: fonts.serifItalic, color: colors.ink },
  underline: { height: 1.5, backgroundColor: colors.accent, alignSelf: 'stretch', marginTop: 2 },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PulseScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 20 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 100 : insets.bottom + 80;

  const [timeframe, setTimeframe] = useState<Timeframe>('today');

  const { data, isLoading, isError, refetch } = useQuery<PulseData>({
    queryKey: ['pulse'],
    queryFn: () => apiGet<PulseData>('/portfolio/pulse'),
    staleTime: 60_000,
  });

  const leaders = data?.leaders ?? [];
  const laggards = data?.laggards ?? [];
  const contributions = data?.contributions ?? [];
  const totalDayChange = data?.totalDayChange ?? 0;

  const greenCount = contributions.filter(c => c.dayChangeDollars > 0).length;
  const redCount = contributions.filter(c => c.dayChangeDollars < 0).length;

  const entryLeaders = useMemo(
    () => [...contributions].sort((a, b) => b.unrealizedPnlPct - a.unrealizedPnlPct).slice(0, 5),
    [contributions],
  );
  const entryLaggards = useMemo(
    () => [...contributions].sort((a, b) => a.unrealizedPnlPct - b.unrealizedPnlPct).slice(0, 5),
    [contributions],
  );

  const displayLeaders = timeframe === 'today' ? leaders.slice(0, 5) : entryLeaders;
  const displayLaggards = timeframe === 'today' ? laggards.slice(0, 5) : entryLaggards;
  const maxLeaderAbs = Math.max(...displayLeaders.map(l => Math.abs(l.dayChangeDollars)), 1);
  const maxLaggardAbs = Math.max(...displayLaggards.map(l => Math.abs(l.dayChangeDollars)), 1);

  const hasData = !!data;

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.ink3} />}
        contentContainerStyle={{ paddingBottom: bottomPad }}
      >
        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.eyebrow}>PULSE</Text>
          <Text style={styles.title}>
            How the book{' '}
            <Text style={styles.titleItalic}>feels</Text>
            {' '}today.
          </Text>
        </View>

        {/* ── Timeframe + timestamp ── */}
        <View style={styles.toggleRow}>
          <TimeframeToggle value={timeframe} onChange={setTimeframe} />
          <Text style={styles.asOf}>
            {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>

        {/* ── Loading ── */}
        {isLoading && !hasData && (
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" color={colors.ink3} />
          </View>
        )}

        {/* ── Error ── */}
        {isError && !hasData && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Unable to load</Text>
            <Pressable style={styles.retryBtn} onPress={() => refetch()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {/* ── Content ── */}
        {hasData && (
          <>
            {/* Narrative headline */}
            <View style={styles.narrative}>
              <Text style={styles.narrativeText}>
                {totalDayChange >= 0 ? 'Up ' : 'Down '}
                <Text style={{ color: totalDayChange >= 0 ? colors.positive : colors.negative }}>
                  {fmtSigned(totalDayChange)}
                </Text>
                {leaders[0] && laggards[0]
                  ? ` · ${leaders[0].ticker} carrying, ${laggards[0].ticker} slipping.`
                  : '.'}
              </Text>
              <Text style={styles.narrativeSub}>
                {greenCount} green · {redCount} red
                {leaders[0] ? ` · ${leaders[0].ticker} ${fmtSigned(leaders[0].dayChangeDollars)} top contributor` : ''}
              </Text>
            </View>

            {/* Sleeve bidir bars */}
            {contributions.length > 0 && (
              <SleeveBidirBars contributions={contributions} />
            )}

            {/* Leaders */}
            {displayLeaders.length > 0 && (
              <View style={styles.listSection}>
                <View style={styles.listHeader}>
                  <Text style={styles.listTitle}>
                    <Text style={styles.listTitleItalic}>Leaders</Text>
                    {' · '}{displayLeaders.length}
                  </Text>
                  <Text style={[styles.listMeta, { color: colors.positive }]}>
                    {fmtSigned(displayLeaders.reduce((s, l) => s + Math.abs(l.dayChangeDollars), 0))}
                  </Text>
                </View>
                <View style={styles.listTable}>
                  {displayLeaders.map((item, i) => (
                    <View key={item.id} style={i > 0 ? styles.listItemBorder : undefined}>
                      <PulseListItem item={item} maxAbs={maxLeaderAbs} isPositive />
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Laggards */}
            {displayLaggards.length > 0 && (
              <View style={styles.listSection}>
                <View style={styles.listHeader}>
                  <Text style={styles.listTitle}>
                    <Text style={styles.listTitleItalic}>Laggards</Text>
                    {' · '}{displayLaggards.length}
                  </Text>
                  <Text style={[styles.listMeta, { color: colors.negative }]}>
                    {fmtSigned(displayLaggards.reduce((s, l) => s + Math.abs(l.dayChangeDollars), 0))}
                  </Text>
                </View>
                <View style={styles.listTable}>
                  {displayLaggards.map((item, i) => (
                    <View key={item.id} style={i > 0 ? styles.listItemBorder : undefined}>
                      <PulseListItem item={item} maxAbs={maxLaggardAbs} isPositive={false} />
                    </View>
                  ))}
                </View>
              </View>
            )}

            {contributions.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>No positions yet</Text>
                <Text style={styles.emptyText}>Add positions to see today's pulse</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
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
    color: colors.accent,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 26,
    letterSpacing: -0.02 * 26,
    color: colors.ink,
    marginTop: 4,
    lineHeight: 30,
  },
  titleItalic: { fontFamily: fonts.serifItalic },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    marginTop: 14,
    marginBottom: 4,
  },
  asOf: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 0.5,
    color: colors.ink3,
  },

  narrative: { paddingHorizontal: 22, marginTop: 16, marginBottom: 4 },
  narrativeText: {
    fontFamily: fonts.serif,
    fontSize: 20,
    letterSpacing: -0.01 * 20,
    color: colors.ink,
    lineHeight: 26,
  },
  narrativeSub: {
    fontFamily: fonts.serifItalic,
    fontSize: 12,
    color: colors.ink3,
    marginTop: 5,
    lineHeight: 17,
  },

  listSection: { paddingHorizontal: 22, marginTop: 22 },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  listTitle: { fontFamily: fonts.serif, fontSize: 15, color: colors.ink },
  listTitleItalic: { fontFamily: fonts.serifItalic },
  listMeta: { fontFamily: fonts.mono, fontSize: 12, fontVariant: ['tabular-nums'] },
  listTable: { borderTopWidth: 1, borderTopColor: colors.ink },
  listItemBorder: { borderTopWidth: 1, borderTopColor: colors.hair },

  loadingState: { alignItems: 'center', paddingTop: 80 },
  emptyState: { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyTitle: { fontFamily: fonts.serif, fontSize: 20, color: colors.ink },
  emptyText: { fontFamily: fonts.sans, fontSize: 13, color: colors.ink3, textAlign: 'center' },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.hair2,
    borderRadius: 2,
  },
  retryText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.ink2 },
});
