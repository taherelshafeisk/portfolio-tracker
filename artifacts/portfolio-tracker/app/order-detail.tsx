import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator, Modal,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { colors } from '@/constants/colors';
import { usePortfolio, apiGet, apiPatch } from '@/context/PortfolioContext';
import { formatCurrency } from '@/components/ui/PnlBadge';
import { OrderSuggestion } from '@/components/home/OrderSuggestionsPreview';
import { ORDER_TYPE_LABEL, SIDE_COLOR } from '@/components/home/SuggestionCard';

const BUCKET_LABELS: Record<string, string> = {
  core: 'CORE', swing: 'SWING', spec: 'SPEC', def: 'DEF',
  anchor: 'ANCHOR', inc: 'INC', cut: 'CUT',
};

const IPS_ACTION_LABELS: Record<string, string> = {
  hold: 'Hold', add: 'Add', trim: 'Trim',
  monitor: 'Monitor', cut: 'Cut', exit: 'Exit',
};

const DISMISS_REASONS = [
  'Reviewed and accepted',
  'Will act within 5 days',
  'No longer relevant',
] as const;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function OrderDetailScreen() {
  const insets = useSafeAreaInsets();
  const { suggestionId, positionId, accountId } = useLocalSearchParams<{
    suggestionId?: string;
    positionId?: string;
    accountId?: string;
  }>();

  const { positions, accounts, summary } = usePortfolio();
  const queryClient = useQueryClient();

  const [showDismissModal, setShowDismissModal] = useState(false);

  // ── Fetch all suggestions (cached) ─────────────────────────────────────────
  const { data: allSuggestions, isLoading: suggestionsLoading } = useQuery({
    queryKey: ['order-suggestions'],
    queryFn: () => apiGet<OrderSuggestion[]>('/order-suggestions'),
    staleTime: Infinity,
  });

  // ── Resolve suggestion ──────────────────────────────────────────────────────
  const suggestion = useMemo<OrderSuggestion | undefined>(() => {
    if (suggestionId) {
      return (allSuggestions ?? []).find(s => s.id === parseInt(suggestionId));
    }
    return undefined;
  }, [allSuggestions, suggestionId]);

  // ── Resolve position ────────────────────────────────────────────────────────
  const position = useMemo(() => {
    if (positionId) {
      return positions.find(p => p.id === parseInt(positionId));
    }
    if (suggestion) {
      return positions.find(p =>
        p.symbol === suggestion.symbol && p.accountId === suggestion.accountId,
      );
    }
    return undefined;
  }, [positionId, suggestion, positions]);

  const resolvedAccountId = suggestion?.accountId ?? position?.accountId ?? (accountId ? parseInt(accountId) : undefined);
  const account = accounts.find(a => a.id === resolvedAccountId);
  const accSummary = summary?.accounts.find(a => a.id === resolvedAccountId);

  const symbol = suggestion?.symbol ?? position?.symbol ?? '—';
  const companyName = position?.name ?? suggestion?.accountName ?? '';
  const side = suggestion?.side;
  const sideColor = side ? SIDE_COLOR[side] : colors.textMuted;

  const sleeveNav = accSummary?.nav ?? 0;
  const currentPct = (sleeveNav > 0 && position) ? (position.marketValue / sleeveNav * 100) : null;

  const afterSellPct = useMemo(() => {
    if (!position || !suggestion || suggestion.side !== 'sell' || sleeveNav <= 0) return null;
    const qty = suggestion.quantity ?? 0;
    if (qty <= 0) return null;
    const remainingValue = (position.quantity - qty) * position.currentPrice;
    return (remainingValue / sleeveNav) * 100;
  }, [position, suggestion, sleeveNav]);

  const estimatedValue = useMemo(() => {
    if (!suggestion?.quantity) return null;
    const price = suggestion.limitPrice ?? position?.currentPrice ?? 0;
    return suggestion.quantity * price;
  }, [suggestion, position]);

  // ── Mutation ────────────────────────────────────────────────────────────────
  const { mutate: updateStatus, isPending: isUpdating } = useMutation({
    mutationFn: ({ status, reason }: { status: 'dismissed' | 'executed'; reason?: string }) =>
      apiPatch<OrderSuggestion>(`/order-suggestions/${suggestion!.id}`, {
        status,
        ...(reason ? { executionNotes: reason } : {}),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<OrderSuggestion[]>(['order-suggestions'], prev =>
        (prev ?? []).map(s => s.id === updated.id ? updated : s),
      );
      router.back();
    },
  });

  const handleExecute = useCallback(() => {
    if (!suggestion) return;
    updateStatus({ status: 'executed' });
  }, [suggestion, updateStatus]);

  const handleDismiss = useCallback(() => {
    if (!suggestion) return;
    const isRed = suggestion.urgency === 'high' || suggestion.urgency === 'critical';
    if (isRed) {
      setShowDismissModal(true);
    } else {
      updateStatus({ status: 'dismissed' });
    }
  }, [suggestion, updateStatus]);

  const confirmDismiss = useCallback((reason: string) => {
    setShowDismissModal(false);
    updateStatus({ status: 'dismissed', reason });
  }, [updateStatus]);

  // ── Loading state ───────────────────────────────────────────────────────────
  const isLoading = suggestionsLoading && !allSuggestions;

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === 'web' ? 67 : insets.top }]}>
      {/* Nav bar */}
      <View style={styles.navbar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.navTitle}>
          <Text style={styles.navSymbol}>{symbol}</Text>
          {side && (
            <View style={[styles.sideBadge, { backgroundColor: `${sideColor}22` }]}>
              <Text style={[styles.sideText, { color: sideColor }]}>{side.toUpperCase()}</Text>
            </View>
          )}
        </View>
        <View style={styles.backBtn} />
      </View>

      {companyName ? (
        <Text style={styles.companyName} numberOfLines={1}>{companyName}</Text>
      ) : null}

      {isLoading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: (Platform.OS === 'web' ? 100 : insets.bottom + 100) },
          ]}
        >
          {/* Section 1 — The order */}
          {suggestion && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>The Order</Text>
              <View style={styles.card}>
                <OrderRow label="Action" value={side?.toUpperCase() ?? '—'} valueColor={sideColor} />
                <Divider />
                <OrderRow label="Order type" value={ORDER_TYPE_LABEL[suggestion.orderType] ?? suggestion.orderType} />
                {suggestion.quantity != null && (
                  <>
                    <Divider />
                    <OrderRow label="Qty" value={suggestion.quantity.toFixed(4)} />
                  </>
                )}
                {suggestion.limitPrice != null && (
                  <>
                    <Divider />
                    <OrderRow label="Limit price" value={formatCurrency(suggestion.limitPrice)} />
                  </>
                )}
                {estimatedValue != null && (
                  <>
                    <Divider />
                    <OrderRow label="Est. value" value={formatCurrency(estimatedValue)} />
                  </>
                )}
                {suggestion.stopPrice != null && (
                  <>
                    <Divider />
                    <OrderRow label="Stop price" value={formatCurrency(suggestion.stopPrice)} />
                  </>
                )}
              </View>
            </View>
          )}

          {/* Section 2 — Why */}
          {suggestion?.rationale ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Why</Text>
              <View style={styles.card}>
                <Text style={styles.rationaleText}>{suggestion.rationale}</Text>
              </View>
            </View>
          ) : null}

          {/* Section 3 — Context */}
          {position && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Context</Text>
              <View style={styles.card}>
                <OrderRow label="Qty held" value={`${position.quantity.toFixed(4)} sh`} />
                <Divider />
                <OrderRow label="Avg cost" value={formatCurrency(position.avgCost)} />
                <Divider />
                <OrderRow label="Current price" value={formatCurrency(position.currentPrice)} />
                <Divider />
                <OrderRow
                  label="Unrealized P&L"
                  value={`${formatCurrency(position.unrealizedPnl)} (${position.unrealizedPnlPct >= 0 ? '+' : ''}${position.unrealizedPnlPct.toFixed(2)}%)`}
                  valueColor={position.unrealizedPnl >= 0 ? colors.positive : colors.negative}
                />
                {currentPct != null && (
                  <>
                    <Divider />
                    <OrderRow label="% of sleeve" value={`${currentPct.toFixed(1)}%`} />
                  </>
                )}
                {afterSellPct != null && (
                  <>
                    <Divider />
                    <OrderRow
                      label="% after execution"
                      value={`~${afterSellPct.toFixed(1)}%`}
                      valueColor={colors.textSecondary}
                    />
                  </>
                )}
              </View>
            </View>
          )}

          {/* Section 4 — IPS context */}
          {position && (position.positionBucket || position.ipsAction || position.stopPrice != null) && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>IPS Context</Text>
              <View style={styles.card}>
                {position.positionBucket ? (
                  <OrderRow
                    label="Bucket"
                    value={BUCKET_LABELS[position.positionBucket] ?? position.positionBucket.toUpperCase()}
                  />
                ) : null}
                {position.ipsAction ? (
                  <>
                    {position.positionBucket && <Divider />}
                    <OrderRow
                      label="IPS action"
                      value={IPS_ACTION_LABELS[position.ipsAction] ?? position.ipsAction}
                    />
                  </>
                ) : null}
                {position.stopPrice != null ? (
                  <>
                    {(position.positionBucket || position.ipsAction) && <Divider />}
                    <OrderRow label="Stop price" value={formatCurrency(position.stopPrice)} />
                  </>
                ) : null}
              </View>
            </View>
          )}

          {/* No suggestion state — just position context */}
          {!suggestion && !isLoading && (
            <View style={styles.noSuggestionNote}>
              <Feather name="info" size={14} color={colors.textMuted} />
              <Text style={styles.noSuggestionText}>
                No specific order suggestion yet. Tap "Get suggestions" on the home screen to generate one.
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* Bottom bar */}
      {suggestion && (
        <View style={[styles.bottomBar, { paddingBottom: Platform.OS === 'web' ? 16 : insets.bottom + 8 }]}>
          <Pressable
            style={[styles.bottomBtn, styles.dismissBtn]}
            onPress={handleDismiss}
            disabled={isUpdating}
          >
            <Text style={styles.dismissText}>Dismiss</Text>
          </Pressable>
          <Pressable
            style={[styles.bottomBtn, styles.executeBtn, isUpdating && { opacity: 0.6 }]}
            onPress={handleExecute}
            disabled={isUpdating}
          >
            {isUpdating
              ? <ActivityIndicator size={14} color={colors.background} />
              : <Text style={styles.executeText}>Mark Executed</Text>
            }
          </Pressable>
        </View>
      )}

      {/* Dismiss reason modal */}
      <Modal visible={showDismissModal} animationType="slide" presentationStyle="pageSheet" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Why are you dismissing this?</Text>
            {DISMISS_REASONS.map(reason => (
              <Pressable key={reason} style={styles.reasonRow} onPress={() => confirmDismiss(reason)}>
                <Text style={styles.reasonText}>{reason}</Text>
                <Feather name="chevron-right" size={16} color={colors.textMuted} />
              </Pressable>
            ))}
            <Pressable style={styles.cancelBtn} onPress={() => setShowDismissModal(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────

function OrderRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.orderRow}>
      <Text style={styles.orderLabel}>{label}</Text>
      <Text style={[styles.orderValue, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  navbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 36,
    alignItems: 'center',
  },
  navTitle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  navSymbol: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    color: colors.textPrimary,
  },
  sideBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  sideText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  companyName: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  loadingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: 16,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 0.5,
    borderColor: colors.separator,
    overflow: 'hidden',
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  orderLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.textSecondary,
  },
  orderValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: 'right',
    flexShrink: 1,
    marginLeft: 12,
  },
  divider: {
    height: 0.5,
    backgroundColor: colors.separator,
    marginHorizontal: 16,
  },
  rationaleText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 21,
    padding: 16,
  },
  noSuggestionNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 0.5,
    borderColor: colors.separator,
    marginBottom: 16,
  },
  noSuggestionText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
  },
  // Bottom bar
  bottomBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: colors.separator,
    backgroundColor: colors.background,
  },
  bottomBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
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
    fontSize: 15,
    color: colors.textSecondary,
  },
  executeBtn: {
    backgroundColor: colors.primary,
  },
  executeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: colors.background,
  },
  // Dismiss modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.separator,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 15,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  reasonText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    color: colors.textPrimary,
  },
  cancelBtn: {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.separator,
    alignItems: 'center',
  },
  cancelText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: colors.textSecondary,
  },
});
