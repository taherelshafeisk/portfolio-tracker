import React, { useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  RefreshControl, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { colors } from '@/constants/colors';
import { apiGet, apiPatch } from '@/context/PortfolioContext';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { OrderSuggestion } from '@/components/home/OrderSuggestionsPreview';

const ORDER_TYPE_LABEL: Record<OrderSuggestion['orderType'], string> = {
  market: 'Market',
  limit: 'Limit',
  stop: 'Stop',
  stop_limit: 'Stop Limit',
  laddered_limit: 'Laddered Limit',
};

const URGENCY_COLOR: Record<OrderSuggestion['urgency'], string> = {
  low: colors.textMuted,
  medium: '#F5A623',
  high: colors.negative,
  critical: colors.negative,
};

const URGENCY_LABEL: Record<OrderSuggestion['urgency'], string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

const SIDE_COLOR: Record<OrderSuggestion['side'], string> = {
  buy: colors.positive,
  sell: colors.negative,
};

export default function OrdersScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const {
    data: allSuggestions,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['order-suggestions'],
    queryFn: () => apiGet<OrderSuggestion[]>('/order-suggestions'),
    staleTime: Infinity,
  });

  const pending = (allSuggestions ?? []).filter(s => s.status === 'pending');

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

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === 'web' ? 12 : 0 }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Platform.OS === 'web' ? 40 : insets.bottom + 24 },
        ]}
      >
        {isLoading ? (
          <LoadingSkeleton />
        ) : pending.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <Text style={styles.hint}>
              {pending.length} pending suggestion{pending.length !== 1 ? 's' : ''}
            </Text>
            {pending.map(s => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                isUpdating={isUpdating}
                onDismiss={() => handleDismiss(s)}
                onExecuted={() => handleExecuted(s)}
              />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface SuggestionCardProps {
  suggestion: OrderSuggestion;
  isUpdating: boolean;
  onDismiss: () => void;
  onExecuted: () => void;
}

function SuggestionCard({ suggestion: s, isUpdating, onDismiss, onExecuted }: SuggestionCardProps) {
  const sideColor = SIDE_COLOR[s.side];
  const urgencyColor = URGENCY_COLOR[s.urgency];

  return (
    <Card style={styles.card}>
      {/* Header row */}
      <View style={styles.cardHeader}>
        <View style={[styles.sideBadge, { backgroundColor: `${sideColor}22` }]}>
          <Text style={[styles.sideText, { color: sideColor }]}>
            {s.side.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.symbol}>{s.symbol}</Text>
        <Text style={styles.orderType}>{ORDER_TYPE_LABEL[s.orderType]}</Text>
        <View style={styles.urgencyPill}>
          <View style={[styles.urgencyDot, { backgroundColor: urgencyColor }]} />
          <Text style={[styles.urgencyText, { color: urgencyColor }]}>
            {URGENCY_LABEL[s.urgency]}
          </Text>
        </View>
      </View>

      {/* Sleeve */}
      <Text style={styles.accountName}>{s.accountName}</Text>

      {/* Rationale */}
      <Text style={styles.rationale}>{s.rationale}</Text>

      {/* Price details if present */}
      {(s.quantity != null || s.limitPrice != null || s.stopPrice != null) && (
        <View style={styles.priceRow}>
          {s.quantity != null && (
            <PriceChip label="Qty" value={s.quantity.toFixed(4)} />
          )}
          {s.limitPrice != null && (
            <PriceChip label="Limit" value={`$${s.limitPrice.toFixed(2)}`} />
          )}
          {s.stopPrice != null && (
            <PriceChip label="Stop" value={`$${s.stopPrice.toFixed(2)}`} />
          )}
        </View>
      )}

      {/* Execution notes */}
      {s.executionNotes && (
        <Text style={styles.executionNotes}>{s.executionNotes}</Text>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <Pressable
          style={[styles.actionBtn, styles.dismissBtn]}
          onPress={onDismiss}
          disabled={isUpdating}
        >
          <Text style={styles.dismissText}>Dismiss</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.executeBtn]}
          onPress={onExecuted}
          disabled={isUpdating}
        >
          {isUpdating
            ? <ActivityIndicator size={14} color={colors.background} />
            : <Text style={styles.executeText}>Mark Executed</Text>
          }
        </Pressable>
      </View>
    </Card>
  );
}

function PriceChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.priceChip}>
      <Text style={styles.priceChipLabel}>{label}</Text>
      <Text style={styles.priceChipValue}>{value}</Text>
    </View>
  );
}

function LoadingSkeleton() {
  return (
    <>
      {[1, 2].map(i => (
        <Card key={i} style={styles.card}>
          <View style={styles.cardHeader}>
            <Skeleton height={28} width={44} style={{ borderRadius: 6 }} />
            <Skeleton height={16} width={60} />
            <Skeleton height={12} width={80} />
          </View>
          <Skeleton height={10} width={100} style={{ marginTop: 8 }} />
          <Skeleton height={12} width="100%" style={{ marginTop: 10 }} />
          <Skeleton height={12} width="80%" style={{ marginTop: 6 }} />
        </Card>
      ))}
    </>
  );
}

function EmptyState() {
  return (
    <Card style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>No pending suggestions</Text>
      <Text style={styles.emptyHint}>
        Go back to the Home screen and tap Generate to analyse your portfolio.
      </Text>
    </Card>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  hint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 12,
  },
  card: {
    marginBottom: 12,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  sideBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 44,
    alignItems: 'center',
  },
  sideText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
  },
  symbol: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: colors.textPrimary,
  },
  orderType: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textMuted,
    flex: 1,
  },
  urgencyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  urgencyDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  urgencyText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  accountName: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
  },
  rationale: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  priceRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  priceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  priceChipLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: colors.textMuted,
  },
  priceChipValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    color: colors.textPrimary,
  },
  executionNotes: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
    lineHeight: 17,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissBtn: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.separator,
  },
  dismissText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.textSecondary,
  },
  executeBtn: {
    backgroundColor: colors.primary,
  },
  executeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.background,
  },
  emptyCard: {
    gap: 8,
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: colors.textSecondary,
  },
  emptyHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 280,
  },
});
