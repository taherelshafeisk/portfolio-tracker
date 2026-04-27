import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  TextInput, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { apiGet } from '@/context/PortfolioContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MinerviniCriterion {
  label: string;
  pass: boolean;
}

interface ScreenerResult {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  relativeVolume: number;
  high52w: number;
  low52w: number;
  sma50: number | null;
  sma150: number | null;
  sma200: number | null;
  minerviniScore: number;
  minerviniCriteria: MinerviniCriterion[];
  alreadyOwned: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtVol(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

function fmtPct(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

// ─── Score bar ────────────────────────────────────────────────────────────────

function ScoreBar({ score, max = 7 }: { score: number; max?: number }) {
  const pct = Math.round((score / max) * 100);
  const barColor = score >= 6 ? colors.positive : score >= 4 ? colors.amber : colors.ink3;
  return (
    <View style={s.scoreBar}>
      <View style={[s.scoreBarFill, { width: `${pct}%` as any, backgroundColor: barColor }]} />
    </View>
  );
}

// ─── Criteria checklist ───────────────────────────────────────────────────────

function CriteriaList({ criteria, expanded }: { criteria: MinerviniCriterion[]; expanded: boolean }) {
  if (!expanded) return null;
  return (
    <View style={s.criteriaList}>
      {criteria.map((c, i) => (
        <View key={i} style={s.criteriaRow}>
          <Text style={[s.criteriaCheck, { color: c.pass ? colors.positive : colors.ink3 }]}>
            {c.pass ? '✓' : '✗'}
          </Text>
          <Text style={[s.criteriaLabel, !c.pass && s.criteriaFail]}>{c.label}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Stock card ───────────────────────────────────────────────────────────────

function StockCard({ item }: { item: ScreenerResult }) {
  const [expanded, setExpanded] = useState(false);
  const up = item.changePercent >= 0;
  const scoreColor = item.minerviniScore >= 6 ? colors.positive : item.minerviniScore >= 4 ? colors.amber : colors.ink3;

  return (
    <Pressable
      style={s.card}
      onPress={() => setExpanded(e => !e)}
      onLongPress={() => router.push({ pathname: '/position/[ticker]', params: { ticker: item.symbol } })}
    >
      {/* Header row */}
      <View style={s.cardHeader}>
        <View style={{ flex: 1 }}>
          <View style={s.symbolRow}>
            <Text style={s.symbol}>{item.symbol}</Text>
            {item.alreadyOwned && <View style={s.ownedPill}><Text style={s.ownedText}>held</Text></View>}
          </View>
          <Text style={s.name} numberOfLines={1}>{item.name}</Text>
        </View>
        <View style={s.priceBlock}>
          <Text style={s.price}>${item.price.toFixed(2)}</Text>
          <Text style={[s.change, { color: up ? colors.positive : colors.negative }]}>
            {fmtPct(item.changePercent)}
          </Text>
        </View>
      </View>

      {/* Score + meta row */}
      <View style={s.metaRow}>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={s.scoreRow}>
            <Text style={[s.scoreLabel, { color: scoreColor }]}>
              {item.minerviniScore}/7
            </Text>
            <ScoreBar score={item.minerviniScore} />
          </View>
          <Text style={s.volLabel}>
            Vol {fmtVol(item.volume)} · {item.relativeVolume.toFixed(1)}× avg
          </Text>
        </View>
        <Feather
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.ink3}
        />
      </View>

      {/* Criteria checklist */}
      <CriteriaList criteria={item.minerviniCriteria} expanded={expanded} />

      {/* SMA summary (expanded only) */}
      {expanded && (
        <View style={s.smaRow}>
          {item.sma50 != null && <Text style={s.smaStat}>50 SMA ${item.sma50.toFixed(2)}</Text>}
          {item.sma150 != null && <Text style={s.smaStat}>150 SMA ${item.sma150.toFixed(2)}</Text>}
          {item.sma200 != null && <Text style={s.smaStat}>200 SMA ${item.sma200.toFixed(2)}</Text>}
        </View>
      )}
    </Pressable>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ScreenerScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 20 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 100 : insets.bottom + 80;

  const [minScore, setMinScore] = useState(4);
  const [searchText, setSearchText] = useState('');
  const [extraSymbols, setExtraSymbols] = useState('');

  const symbolsParam = useMemo(
    () => extraSymbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).join(','),
    [extraSymbols],
  );

  const { data, isLoading, isError, refetch } = useQuery<ScreenerResult[]>({
    queryKey: ['screener-minervini', symbolsParam],
    queryFn: () => apiGet<ScreenerResult[]>(
      `/market/screener${symbolsParam ? `?symbols=${symbolsParam}` : ''}`
    ),
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    return data
      .filter(s => s.minerviniScore >= minScore)
      .filter(s => !searchText || s.symbol.includes(searchText.toUpperCase()) || s.name.toLowerCase().includes(searchText.toLowerCase()));
  }, [data, minScore, searchText]);

  const passAll = filtered.filter(s => s.minerviniScore === 7).length;

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.eyebrow}>SCREENER</Text>
          <Text style={s.title}>Minervini<Text style={s.titleItalic}> Trend Template</Text></Text>
        </View>
        <Pressable onPress={() => refetch()} hitSlop={8}>
          <Feather name="refresh-cw" size={16} color={isLoading ? colors.accent : colors.ink3} />
        </Pressable>
      </View>

      {/* Template description */}
      <Text style={s.templateDesc}>
        7 criteria · Price structure, SMA alignment, 52W range. Tap a row for details, long-press to open position.
      </Text>

      {/* Search + filters */}
      <View style={s.filterRow}>
        <View style={s.searchBox}>
          <Feather name="search" size={13} color={colors.ink3} />
          <TextInput
            style={s.searchInput}
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Filter…"
            placeholderTextColor={colors.ink3}
            autoCapitalize="characters"
          />
        </View>
        <View style={s.scoreFilter}>
          <Text style={s.scoreFilterLabel}>Min score</Text>
          <View style={s.scoreFilterBtns}>
            {[3, 4, 5, 6, 7].map(n => (
              <Pressable
                key={n}
                style={[s.scoreFilterBtn, minScore === n && s.scoreFilterBtnActive]}
                onPress={() => setMinScore(n)}
              >
                <Text style={[s.scoreFilterBtnText, minScore === n && s.scoreFilterBtnTextActive]}>{n}+</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      {/* Add symbols */}
      <View style={s.addRow}>
        <Feather name="plus-circle" size={13} color={colors.ink3} />
        <TextInput
          style={s.addInput}
          value={extraSymbols}
          onChangeText={setExtraSymbols}
          placeholder="Add symbols: AAPL, NVDA, …"
          placeholderTextColor={colors.ink3}
          autoCapitalize="characters"
          onEndEditing={() => refetch()}
        />
      </View>

      {/* Stats line */}
      {data && !isLoading && (
        <View style={s.statsLine}>
          <Text style={s.statsText}>
            {filtered.length} of {data.length} stocks ·{' '}
            <Text style={{ color: colors.positive }}>{passAll} pass all 7</Text>
          </Text>
        </View>
      )}

      {/* Loading */}
      {isLoading && (
        <View style={s.center}>
          <ActivityIndicator color={colors.ink3} size="small" />
          <Text style={s.loadingText}>Scanning {data ? (data as ScreenerResult[]).length : '~40'} stocks…</Text>
        </View>
      )}

      {/* Error */}
      {isError && !isLoading && (
        <View style={s.center}>
          <Text style={s.errorText}>Failed to load screener.</Text>
          <Pressable onPress={() => refetch()} style={s.retryBtn}>
            <Text style={s.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}

      {/* Results */}
      {!isLoading && !isError && (
        <FlatList
          data={filtered}
          keyExtractor={item => item.symbol}
          renderItem={({ item }) => <StockCard item={item} />}
          contentContainerStyle={{ paddingBottom: bottomPad, paddingHorizontal: 22 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            data ? (
              <View style={s.center}>
                <Text style={s.emptyText}>No stocks match Minervini criteria at score {minScore}+.</Text>
                <Text style={s.emptyHint}>Lower the min score or add more symbols.</Text>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 2,
  },
  eyebrow: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.accent,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 24,
    letterSpacing: -0.02 * 24,
    color: colors.ink,
    marginTop: 2,
  },
  titleItalic: { fontFamily: fonts.serifItalic },

  templateDesc: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.ink3,
    paddingHorizontal: 22,
    marginBottom: 12,
    lineHeight: 17,
  },

  filterRow: { paddingHorizontal: 22, gap: 8, marginBottom: 6 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair2,
    paddingBottom: 4,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.ink,
  },
  scoreFilter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scoreFilterLabel: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: colors.ink3 },
  scoreFilterBtns: { flexDirection: 'row', gap: 4 },
  scoreFilterBtn: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 2, borderWidth: 1, borderColor: colors.hair2 },
  scoreFilterBtnActive: { borderColor: colors.accent, backgroundColor: `${colors.accent}15` },
  scoreFilterBtnText: { fontFamily: fonts.mono, fontSize: 11, color: colors.ink3 },
  scoreFilterBtnTextActive: { color: colors.accent },

  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 22,
    marginBottom: 8,
  },
  addInput: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
    paddingBottom: 3,
  },

  statsLine: { paddingHorizontal: 22, marginBottom: 8 },
  statsText: { fontFamily: fonts.mono, fontSize: 11, color: colors.ink3 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 60 },
  loadingText: { fontFamily: fonts.sans, fontSize: 13, color: colors.ink3 },
  errorText: { fontFamily: fonts.sans, fontSize: 13, color: colors.ink2 },
  retryBtn: { paddingHorizontal: 16, paddingVertical: 7, borderWidth: 1, borderColor: colors.hair2, borderRadius: 2 },
  retryText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.ink2 },
  emptyText: { fontFamily: fonts.sans, fontSize: 13, color: colors.ink2, textAlign: 'center' },
  emptyHint: { fontFamily: fonts.sans, fontSize: 12, color: colors.ink3 },

  // Card
  card: {
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.hair,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  symbolRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  symbol: { fontFamily: fonts.monoBold, fontSize: 14, color: colors.ink },
  name: { fontFamily: fonts.sans, fontSize: 11, color: colors.ink3, marginTop: 2, maxWidth: 200 },
  ownedPill: { backgroundColor: `${colors.accent}20`, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3 },
  ownedText: { fontFamily: fonts.mono, fontSize: 9, letterSpacing: 0.5, color: colors.accent },
  priceBlock: { alignItems: 'flex-end' },
  price: { fontFamily: fonts.monoBold, fontSize: 14, color: colors.ink },
  change: { fontFamily: fonts.mono, fontSize: 11, fontVariant: ['tabular-nums'] },

  // Score
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scoreLabel: { fontFamily: fonts.monoBold, fontSize: 13, width: 32 },
  scoreBar: { flex: 1, height: 3, backgroundColor: colors.hair2, borderRadius: 2, overflow: 'hidden' },
  scoreBarFill: { height: 3, borderRadius: 2 },
  volLabel: { fontFamily: fonts.sans, fontSize: 11, color: colors.ink3 },

  // Criteria
  criteriaList: { marginTop: 10, gap: 4 },
  criteriaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  criteriaCheck: { fontFamily: fonts.monoBold, fontSize: 12, width: 14, textAlign: 'center' },
  criteriaLabel: { fontFamily: fonts.sans, fontSize: 12, color: colors.ink2 },
  criteriaFail: { color: colors.ink3 },

  // SMA
  smaRow: { flexDirection: 'row', gap: 12, marginTop: 8, flexWrap: 'wrap' },
  smaStat: { fontFamily: fonts.mono, fontSize: 10, color: colors.ink3 },
});
