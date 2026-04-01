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
import { defaultStrategyProfile } from '@workspace/portfolio-policy';
import { PositionIssuesSection, PositionAlert } from '@/components/position/PositionIssuesSection';
import { TriggerLevelsCard } from '@/components/position/TriggerLevelsCard';
import { CrossAccountExposureCard, ExposureEntry } from '@/components/position/CrossAccountExposureCard';

function bucketColor(bucket: string): string {
  switch (bucket) {
    case 'cut':   return colors.negative;
    case 'spec':  return '#F5A623';
    case 'swing': return colors.primary;
    case 'inc':   return '#2DC5A2';
    default:      return colors.positive; // core, def, anchor
  }
}

function actionColor(action: string): string {
  switch (action) {
    case 'cut':
    case 'exit':    return colors.negative;
    case 'trim':    return '#F5A623';
    case 'monitor': return '#D4A017';
    case 'add':     return '#2DC5A2';
    default:        return colors.textMuted; // hold
  }
}

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

  // Shared cache — no extra network request if already populated
  const { data: allSuggestions } = useQuery({
    queryKey: ['order-suggestions'],
    queryFn: () => apiGet<OrderSuggestion[]>('/order-suggestions'),
    staleTime: Infinity,
    enabled: !!position,
  });

  // Active alerts for this position
  const { data: rawAlerts } = useQuery<PositionAlert[]>({
    queryKey: ['alerts', 'position', posId],
    queryFn: () => apiGet<PositionAlert[]>(`/alerts?positionId=${posId}&status=active`),
    staleTime: 60_000,
    enabled: !!position,
  });
  const activeAlerts: PositionAlert[] = rawAlerts ?? [];

  const positionSuggestions = (allSuggestions ?? []).filter(
    s => s.status === 'pending' && s.symbol === position?.symbol && s.accountId === position?.accountId,
  );

  // ── Derived metrics ──────────────────────────────────────────────────────────

  // Account NAV = sum of all positions in this account + cash balance
  const accountNAV = React.useMemo(() => {
    if (!position || !account) return 0;
    const positionsValue = positions
      .filter(p => p.accountId === position.accountId)
      .reduce((sum, p) => sum + p.marketValue, 0);
    return positionsValue + account.currentBalance;
  }, [positions, position, account]);

  const concentrationPct = accountNAV > 0 && position
    ? (position.marketValue / accountNAV) * 100
    : 0;

  // Cross-account: same symbol held in multiple accounts
  const crossAccountEntries: ExposureEntry[] = React.useMemo(() => {
    if (!position) return [];
    return positions
      .filter(p => p.symbol === position.symbol)
      .map(p => {
        const acc = accounts.find(a => a.id === p.accountId);
        return {
          accountId: p.accountId,
          accountName: acc?.name ?? `Account ${p.accountId}`,
          quantity: p.quantity,
          marketValue: p.marketValue,
        };
      });
  }, [positions, accounts, position]);

  const isMultiAccount = new Set(crossAccountEntries.map(e => e.accountId)).size > 1;

  // TriggerLevelsCard visibility: show when flagged in any way
  const showTriggerLevels = activeAlerts.length > 0 || positionSuggestions.length > 0 || isMultiAccount;

  // Policy thresholds as display percentages
  const { concentrationRule, drawdownRule } = defaultStrategyProfile;
  const concWarnPct  = concentrationRule.warningPct  * 100;   // 20
  const concCritPct  = concentrationRule.criticalPct * 100;   // 30
  const ddWarnPct    = drawdownRule.warningPct  * 100;        // -15
  const ddCritPct    = drawdownRule.criticalPct * 100;        // -25

  // ── Mutation ─────────────────────────────────────────────────────────────────

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
      {/* 1. Header */}
      <Card style={styles.headerCard}>
        <View style={styles.headerTop}>
          <View style={styles.headerTitles}>
            <Text style={styles.symbol}>{position.symbol}</Text>
            <Text style={styles.name}>{position.name}</Text>
            {account && <Text style={styles.account}>in {account.name}</Text>}
          </View>
          {(position.positionBucket || position.ipsAction) && (
            <View style={styles.policyBadges}>
              {position.positionBucket && (
                <View style={[styles.bucketBadge, { backgroundColor: bucketColor(position.positionBucket) + '22', borderColor: bucketColor(position.positionBucket) + '66' }]}>
                  <Text style={[styles.bucketBadgeText, { color: bucketColor(position.positionBucket) }]}>
                    {position.positionBucket.toUpperCase()}
                  </Text>
                </View>
              )}
              {position.ipsAction && (
                <View style={[styles.actionBadge, { backgroundColor: actionColor(position.ipsAction) + '22', borderColor: actionColor(position.ipsAction) + '66' }]}>
                  <Text style={[styles.actionBadgeText, { color: actionColor(position.ipsAction) }]}>
                    {position.ipsAction.toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
          )}
        </View>
        <Text style={styles.marketValue}>{formatCurrency(position.marketValue)}</Text>
        <PnlBadge value={position.unrealizedPnl} percentage={position.unrealizedPnlPct} size="md" />
      </Card>

      {/* 2. Issues & Action — suggestion first, then alerts, then action summary */}
      <PositionIssuesSection
        alerts={activeAlerts}
        suggestions={positionSuggestions}
        isUpdating={isUpdating}
        onDismiss={handleDismiss}
        onExecuted={handleExecuted}
        cutListAddedAt={position.cutListAddedAt != null ? String(position.cutListAddedAt) : undefined}
        positionBucket={position.positionBucket ?? undefined}
        ipsAction={position.ipsAction ?? undefined}
      />

      {/* 3. Trigger Levels — only when flagged */}
      {showTriggerLevels && (
        <TriggerLevelsCard
          concentrationPct={concentrationPct}
          drawdownPct={position.unrealizedPnlPct}
          concWarnPct={concWarnPct}
          concCritPct={concCritPct}
          ddWarnPct={ddWarnPct}
          ddCritPct={ddCritPct}
          currentPrice={position.currentPrice}
          stopPrice={position.stopPrice != null ? Number(position.stopPrice) : undefined}
          ipsAction={position.ipsAction ?? undefined}
          addZoneLow={position.addZoneLow != null ? Number(position.addZoneLow) : undefined}
          addZoneHigh={position.addZoneHigh != null ? Number(position.addZoneHigh) : undefined}
        />
      )}

      {/* 4. Cross-Account Exposure — only when symbol held in 2+ accounts */}
      <CrossAccountExposureCard
        symbol={position.symbol}
        entries={crossAccountEntries}
      />

      {/* 5. Reference stats (demoted) */}
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

      {position.policyNote && (
        <Card>
          <Text style={styles.statLabel}>Policy Note</Text>
          <Text style={styles.notes}>{position.policyNote}</Text>
        </Card>
      )}

      {position.notes && (
        <Card>
          <Text style={styles.statLabel}>Notes</Text>
          <Text style={styles.notes}>{position.notes}</Text>
        </Card>
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
  headerCard: { marginBottom: 4, gap: 4 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerTitles: { flex: 1 },
  policyBadges: { flexDirection: 'column', alignItems: 'flex-end', gap: 4, marginLeft: 8, marginTop: 4 },
  bucketBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  bucketBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.5 },
  actionBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  actionBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.5 },
  symbol: { fontFamily: 'Inter_700Bold', fontSize: 32, color: colors.textPrimary },
  name: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textSecondary },
  account: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textMuted, marginBottom: 8 },
  marketValue: { fontFamily: 'Inter_700Bold', fontSize: 28, color: colors.textPrimary, marginBottom: 4 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { flex: 1, minWidth: '45%' },
  statLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted, marginBottom: 4 },
  statValue: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.textPrimary },
  notes: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  chartBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.primary, borderRadius: 14, padding: 16, marginTop: 8,
  },
  chartBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: colors.background },
});
