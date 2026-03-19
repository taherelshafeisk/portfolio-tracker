import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Platform,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import Svg, { Path, Line, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { colors } from '@/constants/colors';
import { apiGet } from '@/context/PortfolioContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 32;
const CHART_HEIGHT = 200;
const PADDING = { top: 20, right: 10, bottom: 30, left: 50 };

interface ChartData {
  symbol: string;
  interval: string;
  range: string;
  timestamps: number[];
  closes: number[];
  volumes: number[];
}

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

const RANGES = [
  { label: '1D', range: '1d', interval: '5m' },
  { label: '5D', range: '5d', interval: '15m' },
  { label: '1M', range: '1mo', interval: '1d' },
  { label: '3M', range: '3mo', interval: '1d' },
  { label: '6M', range: '6mo', interval: '1d' },
  { label: '1Y', range: '1y', interval: '1wk' },
];

export default function ChartScreen() {
  const { symbol } = useLocalSearchParams<{ symbol: string }>();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [selectedRange, setSelectedRange] = useState(RANGES[2]);

  React.useEffect(() => {
    navigation.setOptions({ title: symbol });
  }, [symbol]);

  const { data: quote } = useQuery({
    queryKey: ['quote', symbol],
    queryFn: () => apiGet<MarketQuote>(`/market/quote/${symbol}`),
    refetchInterval: 30000,
  });

  const { data: chartData, isLoading: chartLoading } = useQuery({
    queryKey: ['chart', symbol, selectedRange.range, selectedRange.interval],
    queryFn: () => apiGet<ChartData>(`/market/chart/${symbol}?interval=${selectedRange.interval}&range=${selectedRange.range}`),
  });

  const renderChart = () => {
    if (chartLoading) return (
      <View style={styles.chartPlaceholder}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
    if (!chartData?.closes?.length) return (
      <View style={styles.chartPlaceholder}>
        <Text style={styles.noData}>No chart data available</Text>
      </View>
    );

    const closes = chartData.closes.filter(v => v != null && !isNaN(v));
    if (closes.length < 2) return null;

    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const range = max - min || 1;
    const chartInnerW = CHART_WIDTH - PADDING.left - PADDING.right;
    const chartInnerH = CHART_HEIGHT - PADDING.top - PADDING.bottom;
    const isPositive = closes[closes.length - 1] >= closes[0];

    const points = closes.map((v, i) => ({
      x: PADDING.left + (i / (closes.length - 1)) * chartInnerW,
      y: PADDING.top + chartInnerH - ((v - min) / range) * chartInnerH,
    }));

    const linePath = points.reduce((acc, p, i) => {
      if (i === 0) return `M ${p.x} ${p.y}`;
      const prev = points[i - 1];
      const cpx = (prev.x + p.x) / 2;
      return `${acc} C ${cpx} ${prev.y} ${cpx} ${p.y} ${p.x} ${p.y}`;
    }, '');

    const fillPath = `${linePath} L ${points[points.length - 1].x} ${PADDING.top + chartInnerH} L ${points[0].x} ${PADDING.top + chartInnerH} Z`;
    const lineColor = isPositive ? colors.positive : colors.negative;

    // Y-axis labels
    const yLabels = [min, min + range * 0.25, min + range * 0.5, min + range * 0.75, max];

    return (
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
        <Defs>
          <LinearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
            <Stop offset="100%" stopColor={lineColor} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {yLabels.map((v, i) => {
          const y = PADDING.top + chartInnerH - (i / (yLabels.length - 1)) * chartInnerH;
          return (
            <React.Fragment key={i}>
              <Line x1={PADDING.left} y1={y} x2={CHART_WIDTH - PADDING.right} y2={y} stroke={colors.separator} strokeWidth={0.5} />
              <SvgText x={PADDING.left - 6} y={y + 4} fill={colors.textMuted} fontSize={9} textAnchor="end">
                {v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v.toFixed(0)}
              </SvgText>
            </React.Fragment>
          );
        })}
        <Path d={fillPath} fill="url(#chartGrad)" />
        <Path d={linePath} stroke={lineColor} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    );
  };

  const isPos = (quote?.changePercent ?? 0) >= 0;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === 'web' ? 40 : (insets.bottom + 24) }]}
    >
      {/* Quote Header */}
      {quote && (
        <View style={styles.quoteHeader}>
          <Text style={styles.quoteName}>{quote.name}</Text>
          <Text style={styles.quotePrice}>${quote.price.toFixed(2)}</Text>
          <Text style={[styles.quoteChange, { color: isPos ? colors.positive : colors.negative }]}>
            {isPos ? '+' : ''}{quote.change.toFixed(2)} ({isPos ? '+' : ''}{quote.changePercent.toFixed(2)}%)
          </Text>
        </View>
      )}

      {/* Range Selector */}
      <View style={styles.rangeRow}>
        {RANGES.map(r => (
          <Pressable
            key={r.label}
            style={[styles.rangeBtn, selectedRange.label === r.label && styles.rangeBtnActive]}
            onPress={() => setSelectedRange(r)}
          >
            <Text style={[styles.rangeBtnText, selectedRange.label === r.label && styles.rangeBtnTextActive]}>
              {r.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Chart */}
      <View style={styles.chartContainer}>
        {renderChart()}
      </View>

      {/* Stats */}
      {quote && (
        <View style={styles.statsGrid}>
          <StatItem label="Open" value={`$${quote.previousClose.toFixed(2)}`} />
          <StatItem label="Volume" value={formatVol(quote.volume)} />
          {quote.high52w && <StatItem label="52W High" value={`$${quote.high52w.toFixed(2)}`} />}
          {quote.low52w && <StatItem label="52W Low" value={`$${quote.low52w.toFixed(2)}`} />}
        </View>
      )}
    </ScrollView>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function formatVol(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toString();
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 16 },
  quoteHeader: { marginBottom: 16 },
  quoteName: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textSecondary },
  quotePrice: { fontFamily: 'Inter_700Bold', fontSize: 40, color: colors.textPrimary },
  quoteChange: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginTop: 4 },
  rangeRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  rangeBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.separator },
  rangeBtnActive: { borderColor: colors.primary, backgroundColor: 'rgba(0,212,255,0.1)' },
  rangeBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: colors.textSecondary },
  rangeBtnTextActive: { color: colors.primary },
  chartContainer: { backgroundColor: colors.surface, borderRadius: 16, padding: 8, marginBottom: 20, borderWidth: 1, borderColor: colors.separator },
  chartPlaceholder: { height: CHART_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  noData: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textMuted },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statItem: { flex: 1, minWidth: '45%', backgroundColor: colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.separator },
  statLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted, marginBottom: 4 },
  statValue: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.textPrimary },
});
