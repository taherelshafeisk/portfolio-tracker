import React, { useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  TextInput, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { colors } from '@/constants/colors';
import { apiGet } from '@/context/PortfolioContext';
import { Card } from '@/components/ui/Card';

interface ScreenerResult {
  symbol: string;
  name: string;
  price: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  relativeVolume: number;
  rsi?: number;
  swingScore: number;
  marketCap?: number;
}

function SwingScoreMeter({ score }: { score: number }) {
  const color = score >= 70 ? colors.positive : score >= 50 ? colors.swing : colors.negative;
  return (
    <View style={scoreMeterStyles.container}>
      <View style={scoreMeterStyles.track}>
        <View style={[scoreMeterStyles.fill, { width: `${score}%`, backgroundColor: color }]} />
      </View>
      <Text style={[scoreMeterStyles.label, { color }]}>{score}</Text>
    </View>
  );
}

const scoreMeterStyles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { flex: 1, height: 4, backgroundColor: colors.surfaceElevated, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  label: { fontFamily: 'Inter_700Bold', fontSize: 13, width: 26, textAlign: 'right' },
});

export default function ScreenerScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [minPrice, setMinPrice] = useState('5');
  const [maxPrice, setMaxPrice] = useState('500');
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['screener', minPrice, maxPrice],
    queryFn: () => apiGet<ScreenerResult[]>(`/market/screener?minPrice=${minPrice}&maxPrice=${maxPrice}`),
  });

  const filtered = (data || []).filter(s =>
    !searchQuery || s.symbol.includes(searchQuery.toUpperCase()) || s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatVolume = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return v.toString();
  };

  const renderItem = ({ item }: { item: ScreenerResult }) => {
    const pos = item.changePercent >= 0;
    const scoreColor = item.swingScore >= 70 ? colors.positive : item.swingScore >= 50 ? colors.swing : colors.textMuted;
    return (
      <Card
        style={styles.resultCard}
        onPress={() => router.push({ pathname: '/chart/[symbol]', params: { symbol: item.symbol } })}
      >
        <View style={styles.resultHeader}>
          <View>
            <Text style={styles.symbol}>{item.symbol}</Text>
            <Text style={styles.companyName} numberOfLines={1}>{item.name}</Text>
          </View>
          <View style={styles.priceBlock}>
            <Text style={styles.price}>${item.price.toFixed(2)}</Text>
            <Text style={[styles.change, { color: pos ? colors.positive : colors.negative }]}>
              {pos ? '+' : ''}{item.changePercent.toFixed(2)}%
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Volume</Text>
            <Text style={styles.statVal}>{formatVolume(item.volume)}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Rel Vol</Text>
            <Text style={[styles.statVal, { color: item.relativeVolume > 1.5 ? colors.positive : colors.textPrimary }]}>
              {item.relativeVolume.toFixed(1)}x
            </Text>
          </View>
          {item.rsi != null && (
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>RSI</Text>
              <Text style={[styles.statVal, {
                color: item.rsi > 70 ? colors.negative : item.rsi < 30 ? colors.positive : colors.textPrimary
              }]}>{item.rsi.toFixed(0)}</Text>
            </View>
          )}
        </View>

        <View style={styles.swingRow}>
          <Text style={styles.swingLabel}>Swing Score</Text>
          <SwingScoreMeter score={item.swingScore} />
        </View>
      </Card>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Screener</Text>
        <Pressable onPress={() => refetch()} style={styles.refreshBtn}>
          <Feather name="refresh-cw" size={18} color={isLoading ? colors.primary : colors.textSecondary} />
        </Pressable>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <Feather name="search" size={16} color={colors.textMuted} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search symbol or name..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="characters"
        />
      </View>

      {/* Filters */}
      <View style={styles.filterRow}>
        <View style={styles.filterItem}>
          <Text style={styles.filterLabel}>Min $</Text>
          <TextInput
            style={styles.filterInput}
            value={minPrice}
            onChangeText={setMinPrice}
            onEndEditing={() => refetch()}
            keyboardType="decimal-pad"
            placeholderTextColor={colors.textMuted}
          />
        </View>
        <View style={styles.filterItem}>
          <Text style={styles.filterLabel}>Max $</Text>
          <TextInput
            style={styles.filterInput}
            value={maxPrice}
            onChangeText={setMaxPrice}
            onEndEditing={() => refetch()}
            keyboardType="decimal-pad"
            placeholderTextColor={colors.textMuted}
          />
        </View>
        <View style={styles.filterItem}>
          <Text style={styles.filterLabel}>Results</Text>
          <Text style={styles.filterVal}>{filtered.length}</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.loadingText}>Scanning markets...</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.symbol}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, {
            paddingBottom: Platform.OS === 'web' ? 100 : (insets.bottom + 90)
          }]}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="search" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>No stocks match your criteria</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 8, paddingTop: 4 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, color: colors.textPrimary },
  refreshBtn: { padding: 8 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 10, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.separator },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: 12, color: colors.textPrimary, fontFamily: 'Inter_400Regular', fontSize: 14 },
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 10 },
  filterItem: { flex: 1, backgroundColor: colors.surface, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: colors.separator },
  filterLabel: { fontFamily: 'Inter_400Regular', fontSize: 10, color: colors.textMuted, marginBottom: 4 },
  filterInput: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: colors.textPrimary },
  filterVal: { fontFamily: 'Inter_700Bold', fontSize: 16, color: colors.primary },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textSecondary },
  list: { paddingHorizontal: 16 },
  resultCard: { marginBottom: 10 },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  symbol: { fontFamily: 'Inter_700Bold', fontSize: 17, color: colors.textPrimary },
  companyName: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textSecondary, marginTop: 1, maxWidth: 180 },
  priceBlock: { alignItems: 'flex-end' },
  price: { fontFamily: 'Inter_700Bold', fontSize: 17, color: colors.textPrimary },
  change: { fontFamily: 'Inter_600SemiBold', fontSize: 13, marginTop: 2 },
  statsRow: { flexDirection: 'row', marginBottom: 10 },
  statItem: { flex: 1 },
  statLabel: { fontFamily: 'Inter_400Regular', fontSize: 10, color: colors.textMuted, marginBottom: 2 },
  statVal: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.textPrimary },
  swingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  swingLabel: { fontFamily: 'Inter_500Medium', fontSize: 12, color: colors.textSecondary, width: 80 },
  emptyState: { alignItems: 'center', paddingTop: 80, gap: 16 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textMuted },
});
