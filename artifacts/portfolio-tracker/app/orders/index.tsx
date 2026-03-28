import React, { useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  RefreshControl, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { colors } from '@/constants/colors';
import { apiGet, apiPatch } from '@/context/PortfolioContext';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { OrderSuggestion } from '@/components/home/OrderSuggestionsPreview';
import { SuggestionCard } from '@/components/home/SuggestionCard';

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

function LoadingSkeleton() {
  return (
    <>
      {[1, 2].map(i => (
        <Card key={i} style={styles.skeletonCard}>
          <View style={styles.skeletonHeader}>
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
  skeletonCard: {
    marginBottom: 12,
    gap: 8,
  },
  skeletonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
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
