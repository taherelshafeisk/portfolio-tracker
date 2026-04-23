import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  Pressable, Platform, ActivityIndicator,
} from 'react-native';
import Svg, { Rect } from 'react-native-svg';
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

// ─── Contribution ribbon ──────────────────────────────────────────────────────

function ContribRibbon({ contributions }: { contributions: PositionContribution[] }) {
  const totalAbs = contributions.reduce((s, c) => s + Math.abs(c.dayChangeDollars), 0);
  if (totalAbs === 0) return null;

  const W = 336;
  const H = 22;

  const segments = contributions
    .filter(c => c.dayChangeDollars !== 0)
    .map(c => {
      const share = Math.abs(c.dayChangeDollars) / totalAbs;
      const maxOpacity = 0.75;
      const minOpacity = 0.25;
      const opacity = minOpacity + share * (maxOpacity - minOpacity);
      return {
        width: share * W,
        color: c.dayChangeDollars >= 0 ? colors.positive : colors.negative,
        opacity,
        ticker: c.ticker,
      };
    });

  let x = 0;
  return (
    <View>
      <Text style={styles.ribbonCaption}>width = $ impact · color = direction · opacity = size</Text>
      <View style={[styles.ribbonWrapper, { width: W, height: H }]}>
        <Svg width={W} height={H}>
          {segments.map((seg, i) => {
            const rx = x;
            x += seg.width;
            return (
              <Rect
                key={i}
                x={rx + (i > 0 ? 0.5 : 0)}
                y={0}
                width={seg.width - (i > 0 ? 0.5 : 0)}
                height={H}
                fill={seg.color}
                opacity={seg.opacity}
              />
            );
          })}
        </Svg>
      </View>
    </View>
  );
}

// ─── Pulse list ───────────────────────────────────────────────────────────────

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
      style={styles.pulseItem}
      onPress={() => router.push({ pathname: '/position/[ticker]', params: { ticker: item.ticker, accountId: String(item.accountId) } })}
    >
      <View style={styles.pulseItemRow}>
        <Text style={styles.pulseItemTicker}>{item.ticker}</Text>
        <Text style={[styles.pulseItemName]}>{item.name}</Text>
        <View style={styles.pulseItemRight}>
          <Text style={[styles.pulseItemPct, { color: barColor }]}>{fmtPct(item.dayChangePct)}</Text>
          <Text style={[styles.pulseItemDollars, { color: barColor }]}>{fmtSigned(item.dayChangeDollars)}</Text>
        </View>
      </View>
      {/* Contribution bar */}
      <View style={styles.pulseBarTrack}>
        <View style={[styles.pulseBarFill, { width: `${barWidth}%` as any, backgroundColor: barColor }]} />
      </View>
      {/* Because line — placeholder since we don't have a news API */}
      <Text style={styles.becauseLine}>
        <Text style={styles.becauseLabel}>BECAUSE  </Text>
        {isPositive
          ? `Up ${fmtPct(Math.abs(item.dayChangePct))} today · ${item.accountName}`
          : `Down ${fmtPct(Math.abs(item.dayChangePct))} today · ${item.accountName}`}
      </Text>
    </Pressable>
  );
}

// ─── Sleeve diverging chart ───────────────────────────────────────────────────

interface SleeveSummary {
  name: string;
  dayPct: number;
}

function SleeveDivergingChart({ sleeves }: { sleeves: SleeveSummary[] }) {
  const maxAbs = Math.max(...sleeves.map(s => Math.abs(s.dayPct)), 0.01);

  return (
    <View style={styles.sleeveChart}>
      {sleeves.map((sleeve, i) => {
        const isPos = sleeve.dayPct >= 0;
        const barW = (Math.abs(sleeve.dayPct) / maxAbs) * 36;
        return (
          <View key={i} style={styles.sleeveChartRow}>
            <Text style={styles.sleeveName} numberOfLines={1}>{sleeve.name}</Text>
            <View style={styles.sleeveLane}>
              <View style={styles.sleeveAxis} />
              <View style={[
                styles.sleeveBar,
                isPos
                  ? { left: '50%', width: barW, backgroundColor: colors.positive }
                  : { right: '50%', width: barW, backgroundColor: colors.negative },
              ]} />
            </View>
            <Text style={[styles.sleeveDayPct, { color: isPos ? colors.positive : colors.negative }]}>
              {fmtPct(sleeve.dayPct)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ─── Timeframe toggle ─────────────────────────────────────────────────────────

type Timeframe = 'today' | 'entry';

function TimeframeToggle({ value, onChange }: { value: Timeframe; onChange: (v: Timeframe) => void }) {
  return (
    <View style={styles.toggle}>
      {(['today', 'entry'] as Timeframe[]).map(tf => (
        <Pressable key={tf} onPress={() => onChange(tf)} style={styles.toggleOption}>
          <Text style={[styles.toggleLabel, value === tf && styles.toggleLabelActive]}>
            {tf === 'today' ? 'Today' : 'Since my entry'}
          </Text>
          {value === tf && <View style={styles.toggleUnderline} />}
        </Pressable>
      ))}
    </View>
  );
}

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
  const largest = leaders[0];
  const largestDrag = laggards[0];

  // For "Since entry" mode, rerank by unrealizedPnlPct
  const entryLeaders = [...contributions].sort((a, b) => b.unrealizedPnlPct - a.unrealizedPnlPct).slice(0, 5);
  const entryLaggards = [...contributions].sort((a, b) => a.unrealizedPnlPct - b.unrealizedPnlPct).slice(0, 5);

  const displayLeaders = timeframe === 'today' ? leaders.slice(0, 5) : entryLeaders;
  const displayLaggards = timeframe === 'today' ? laggards.slice(0, 5) : entryLaggards;
  const maxLeaderAbs = Math.max(...displayLeaders.map(l => Math.abs(l.dayChangeDollars)), 1);
  const maxLaggardAbs = Math.max(...displayLaggards.map(l => Math.abs(l.dayChangeDollars)), 1);

  // Sleeve summaries — derive from contributions (group by accountName)
  const sleeveMap = new Map<string, { dayChange: number; nav: number }>();
  contributions.forEach(c => {
    const existing = sleeveMap.get(c.accountName);
    if (existing) {
      existing.dayChange += c.dayChangeDollars;
      existing.nav += c.marketValue;
    } else {
      sleeveMap.set(c.accountName, { dayChange: c.dayChangeDollars, nav: c.marketValue });
    }
  });
  const sleeves: SleeveSummary[] = Array.from(sleeveMap.entries()).map(([name, { dayChange, nav }]) => ({
    name,
    dayPct: nav > 0 ? (dayChange / nav) * 100 : 0,
  }));

  const hasData = !!data;

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.ink3} />}
        contentContainerStyle={{ paddingBottom: bottomPad }}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.eyebrow}>PULSE</Text>
          <Text style={styles.title}>
            How the book{' '}
            <Text style={styles.titleItalic}>feels</Text>
            {' '}today.
          </Text>
        </View>

        {/* Timeframe toggle */}
        <View style={styles.toggleRow}>
          <TimeframeToggle value={timeframe} onChange={setTimeframe} />
          <Text style={styles.asOf}>
            as of {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}
          </Text>
        </View>

        {/* Loading state */}
        {isLoading && !hasData && (
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" color={colors.ink3} />
          </View>
        )}

        {/* Error state */}
        {isError && !hasData && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Unable to load</Text>
            <Text style={styles.emptyText}>Something went wrong fetching today's pulse</Text>
            <Pressable style={styles.retryBtn} onPress={() => refetch()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {/* Content — only renders once data is confirmed present */}
        {hasData && (
          <>
            {/* Narrative */}
            <View style={styles.narrativeSection}>
              <Text style={styles.narrative}>
                {totalDayChange >= 0 ? 'Up ' : 'Down '}
                <Text style={{ color: totalDayChange >= 0 ? colors.positive : colors.negative }}>
                  {fmtSigned(totalDayChange)}
                </Text>
                {largest && laggards[0]
                  ? ` · ${largest.ticker} carrying, ${laggards[0].ticker} slipping.`
                  : '.'}
              </Text>
              <Text style={styles.narrativeSub}>
                {greenCount} green · {redCount} red.
                {largest ? ` Largest contributor: ${largest.ticker} (${fmtSigned(largest.dayChangeDollars)}).` : ''}
                {largestDrag ? ` Largest drag: ${largestDrag.ticker} (${fmtSigned(largestDrag.dayChangeDollars)}).` : ''}
              </Text>
            </View>

            {/* Contribution ribbon */}
            <View style={styles.ribbonSection}>
              <Text style={styles.sectionEyebrow}>CONTRIBUTION</Text>
              <ContribRibbon contributions={contributions} />
            </View>

            {/* Leaders */}
            {displayLeaders.length > 0 && (
              <View style={styles.listSection}>
                <View style={styles.listHeader}>
                  <Text style={styles.listTitle}>
                    <Text style={styles.listTitleItalic}>Leaders</Text>
                    {' · '}top {displayLeaders.length}
                  </Text>
                  <Text style={[styles.listTotal, { color: colors.positive }]}>
                    {fmtSigned(displayLeaders.reduce((s, l) => s + Math.abs(l.dayChangeDollars), 0))}
                  </Text>
                </View>
                <View style={styles.listTable}>
                  {displayLeaders.map((item, i) => (
                    <View key={item.id} style={i > 0 ? styles.listItemBorder : undefined}>
                      <PulseListItem item={item} maxAbs={maxLeaderAbs} isPositive={true} />
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
                    {' · '}bottom {displayLaggards.length}
                  </Text>
                  <Text style={[styles.listTotal, { color: colors.negative }]}>
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

            {/* Who's carrying — sleeve diverging chart */}
            {sleeves.length > 0 && (
              <View style={styles.sleeveSection}>
                <Text style={styles.sectionEyebrow}>WHO'S CARRYING</Text>
                <SleeveDivergingChart sleeves={sleeves} />
              </View>
            )}

            {/* Empty state — only when API returned successfully with zero positions */}
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

  // Timeframe toggle
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    marginTop: 14,
    marginBottom: 4,
  },
  toggle: { flexDirection: 'row', gap: 16 },
  toggleOption: { alignItems: 'center' },
  toggleLabel: {
    fontFamily: fonts.serif,
    fontSize: 13,
    color: colors.ink3,
  },
  toggleLabelActive: {
    fontFamily: fonts.serifItalic,
    color: colors.ink,
  },
  toggleUnderline: {
    height: 1.5,
    backgroundColor: colors.accent,
    alignSelf: 'stretch',
    marginTop: 2,
  },
  asOf: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.ink3,
  },

  // Narrative
  narrativeSection: { paddingHorizontal: 22, marginTop: 16, marginBottom: 4 },
  narrative: {
    fontFamily: fonts.serif,
    fontSize: 20,
    letterSpacing: -0.01 * 20,
    color: colors.ink,
    lineHeight: 26,
  },
  narrativeSub: {
    fontFamily: fonts.serifItalic,
    fontSize: 12.5,
    color: colors.ink3,
    marginTop: 6,
    lineHeight: 18,
  },

  // Ribbon
  ribbonSection: { paddingHorizontal: 22, marginTop: 18, marginBottom: 4 },
  sectionEyebrow: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.ink3,
    marginBottom: 8,
  },
  ribbonWrapper: {
    borderWidth: 1,
    borderColor: colors.hair2,
    borderRadius: 2,
    overflow: 'hidden',
  },
  ribbonCaption: {
    fontFamily: fonts.mono,
    fontSize: 9,
    color: colors.ink3,
    marginBottom: 6,
  },

  // Pulse list
  listSection: { paddingHorizontal: 22, marginTop: 20 },
  listHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 },
  listTitle: { fontFamily: fonts.serif, fontSize: 15, color: colors.ink },
  listTitleItalic: { fontFamily: fonts.serifItalic },
  listTotal: { fontFamily: fonts.mono, fontSize: 13, fontVariant: ['tabular-nums'] },
  listTable: { borderTopWidth: 1, borderTopColor: colors.ink },
  listItemBorder: { borderTopWidth: 1, borderTopColor: colors.hair },

  pulseItem: { paddingVertical: 10 },
  pulseItemRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pulseItemTicker: { fontFamily: fonts.monoBold, fontSize: 13, color: colors.ink, minWidth: 44 },
  pulseItemName: { flex: 1, fontFamily: fonts.sans, fontSize: 11.5, color: colors.ink2 },
  pulseItemRight: { alignItems: 'flex-end' },
  pulseItemPct: { fontFamily: fonts.mono, fontSize: 12, fontVariant: ['tabular-nums'] },
  pulseItemDollars: { fontFamily: fonts.monoMedium, fontSize: 11, fontVariant: ['tabular-nums'] },

  pulseBarTrack: { height: 2, backgroundColor: colors.hair2, borderRadius: 1, marginTop: 6, overflow: 'hidden' },
  pulseBarFill: { height: 2, borderRadius: 1 },

  becauseLine: {
    fontFamily: fonts.serifItalic,
    fontSize: 11,
    color: colors.ink3,
    marginTop: 5,
    lineHeight: 15,
  },
  becauseLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.accent,
    fontStyle: 'normal',
  },

  // Sleeve chart
  sleeveSection: { paddingHorizontal: 22, marginTop: 24, marginBottom: 8 },
  sleeveChart: { gap: 10 },
  sleeveChartRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sleeveName: { fontFamily: fonts.sans, fontSize: 12, color: colors.ink2, width: 120 },
  sleeveLane: {
    flex: 1,
    height: 10,
    position: 'relative',
    justifyContent: 'center',
  },
  sleeveAxis: {
    position: 'absolute',
    left: '50%',
    top: 3,
    width: 1,
    height: 4,
    backgroundColor: colors.hair2,
  },
  sleeveBar: {
    position: 'absolute',
    height: 4,
    top: 3,
    borderRadius: 2,
  },
  sleeveDayPct: { fontFamily: fonts.mono, fontSize: 11, fontVariant: ['tabular-nums'], width: 54, textAlign: 'right' },

  // Loading / error / empty
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
