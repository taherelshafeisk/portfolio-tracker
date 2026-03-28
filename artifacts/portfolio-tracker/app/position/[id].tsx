import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform, Pressable, Alert } from 'react-native';
import { useLocalSearchParams, useNavigation, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { colors } from '@/constants/colors';
import { usePortfolio, apiGet, apiPatch } from '@/context/PortfolioContext';
import { Card } from '@/components/ui/Card';
import { PnlBadge, formatCurrency } from '@/components/ui/PnlBadge';
import { OrderSuggestion } from '@/components/home/OrderSuggestionsPreview';
import { SuggestionCard } from '@/components/home/SuggestionCard';

export default function PositionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const posId = parseInt(id);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { positions, accounts } = usePortfolio();
  const queryClient = useQueryClient();

  const position = positions.find(p => p.id === posId);
  const account = position ? accounts.find(a => a.id === position.accountId) : null;

  React.useEffect(() => {
    if (position) navigation.setOptions({ title: position.symbol });
  }, [position]);

  // Read from the shared cache — no extra network request if already populated
  const { data: allSuggestions } = useQuery({
    queryKey: ['order-suggestions'],
    queryFn: () => apiGet<OrderSuggestion[]>('/order-suggestions'),
    staleTime: Infinity,
    enabled: !!position,
  });

  const positionSuggestions = (allSuggestions ?? []).filter(
    s => s.status === 'pending' && s.symbol === position?.symbol && s.accountId === position?.accountId,
  );

  const { mutate: updateStatus, isPending: isUpdating } = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'dismissed' | 'executed' }) =>
      apiPatch<OrderSuggestion>(`/order-suggestions/${id}`, { status }),
    onSuccess: (updated) => {
      queryClient.setQueryData<OrderSuggestion[]>(['order-suggestions'], prev =>
        (prev ?? []).map(s => s.id === updated.id ? updated : s),
      );
    },
    onError: () => {
      Alert.alert('Error', 'Failed to update suggestion. Please try again.');
    },
  });

  const handleDismiss = useCallback((s: OrderSuggestion) => {
    Alert.alert(
      'Dismiss suggestion',
      `Dismiss ${s.side.toUpperCase()} ${s.symbol}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dismiss',
          style: 'destructive',
          onPress: () => updateStatus({ id: s.id, status: 'dismissed' }),
        },
      ],
    );
  }, [updateStatus]);

  const handleExecuted = useCallback((s: OrderSuggestion) => {
    Alert.alert(
      'Mark as executed',
      `Mark ${s.side.toUpperCase()} ${s.symbol} as executed?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Executed',
          onPress: () => updateStatus({ id: s.id, status: 'executed' }),
        },
      ],
    );
  }, [updateStatus]);

  if (!position) {
    return (
      <View style={styles.container}>
        <Text style={styles.notFound}>Position not found</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scroll, {
        paddingBottom: Platform.OS === 'web' ? 40 : (insets.bottom + 24)
      }]}
    >
      <Card style={styles.headerCard}>
        <Text style={styles.symbol}>{position.symbol}</Text>
        <Text style={styles.name}>{position.name}</Text>
        {account && <Text style={styles.account}>in {account.name}</Text>}
        <Text style={styles.marketValue}>{formatCurrency(position.marketValue)}</Text>
        <PnlBadge value={position.unrealizedPnl} percentage={position.unrealizedPnlPct} size="md" />
      </Card>

      <View style={styles.statsGrid}>
        <Card style={styles.statCard}>
          <Text style={styles.statLabel}>Quantity</Text>
          <Text style={styles.statValue}>{position.quantity}</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statLabel}>Avg Cost</Text>
          <Text style={styles.statValue}>${position.avgCost.toFixed(2)}</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statLabel}>Current Price</Text>
          <Text style={styles.statValue}>${position.currentPrice.toFixed(2)}</Text>
        </Card>
        <Card style={styles.statCard}>
          <Text style={styles.statLabel}>Cost Basis</Text>
          <Text style={styles.statValue}>{formatCurrency(position.quantity * position.avgCost)}</Text>
        </Card>
      </View>

      {position.sector && (
        <Card>
          <Text style={styles.statLabel}>Sector</Text>
          <Text style={styles.statValue}>{position.sector}</Text>
        </Card>
      )}

      {position.notes && (
        <Card style={{ marginTop: 12 }}>
          <Text style={styles.statLabel}>Notes</Text>
          <Text style={styles.notes}>{position.notes}</Text>
        </Card>
      )}

      {/* Suggestions for this position */}
      {positionSuggestions.length > 0 && (
        <View style={styles.suggestionsSection}>
          <Text style={styles.suggestionsTitle}>Suggested Orders</Text>
          {positionSuggestions.map(s => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              isUpdating={isUpdating}
              onDismiss={() => handleDismiss(s)}
              onExecuted={() => handleExecuted(s)}
            />
          ))}
        </View>
      )}

      <Pressable
        style={styles.chartBtn}
        onPress={() => router.push({ pathname: '/chart/[symbol]', params: { symbol: position.symbol, avgCost: String(position.avgCost), accountId: String(position.accountId) } })}
      >
        <Feather name="trending-up" size={18} color={colors.background} />
        <Text style={styles.chartBtnText}>View Chart</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 16, gap: 12 },
  notFound: { fontFamily: 'Inter_400Regular', fontSize: 16, color: colors.textSecondary, textAlign: 'center', marginTop: 60 },
  headerCard: { marginBottom: 12, gap: 4 },
  symbol: { fontFamily: 'Inter_700Bold', fontSize: 32, color: colors.textPrimary },
  name: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textSecondary },
  account: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textMuted, marginBottom: 8 },
  marketValue: { fontFamily: 'Inter_700Bold', fontSize: 28, color: colors.textPrimary, marginBottom: 4 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  statCard: { flex: 1, minWidth: '45%' },
  statLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted, marginBottom: 4 },
  statValue: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.textPrimary },
  notes: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  suggestionsSection: {
    marginTop: 4,
  },
  suggestionsTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: 10,
  },
  chartBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: 14, padding: 16, marginTop: 8,
  },
  chartBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: colors.background },
});
