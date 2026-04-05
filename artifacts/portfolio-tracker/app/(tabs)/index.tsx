import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  Pressable, StatusBar, Platform, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { colors } from '@/constants/colors';
import { usePortfolio, apiGet, apiPost, apiPatch, type Position, type Account } from '@/context/PortfolioContext';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';

// Home section components
import { PortfolioHealthCard, HealthSignal } from '@/components/home/PortfolioHealthCard';
import { SleeveSection, SleeveData } from '@/components/home/SleeveSection';

// Shared action computation
import {
  computeActions, reconcileActions,
  DEFAULT_CONCENTRATION_LIMIT, DEFAULT_LEVERAGE_CEILING, DRAWDOWN_THRESHOLD_AMBER,
  type Action,
} from '@/lib/actions';

// ─── Constants ────────────────────────────────────────────────────────────────

const DRAWDOWN_THRESHOLD_RED = -0.25;

const DISMISS_REASONS = [
  'Reviewed and accepted',
  'Will act within 5 days',
  'No longer relevant',
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiAlert {
  id: number;
  fingerprint: string;
  status: string;
  dismissReason: string | null;
}

// ─── Health signal ────────────────────────────────────────────────────────────

function computeHealthSignal(
  positions: Position[],
  accounts: Account[],
  sleeveNavMap: Map<number, number>,
): HealthSignal {
  for (const account of accounts) {
    const nav = sleeveNavMap.get(account.id) ?? 0;
    if (nav <= 0) continue;
    const limit = account.concentrationLimit ?? DEFAULT_CONCENTRATION_LIMIT;
    const acctPositions = positions.filter(p => p.accountId === account.id);
    if (acctPositions.some(p => p.marketValue / nav > 2 * limit)) return 'red';
    if (account.currentBalance < 0) {
      const ceiling = account.leverageCeiling ?? DEFAULT_LEVERAGE_CEILING;
      const borrowed = Math.abs(account.currentBalance);
      const leverageRatio = (nav + borrowed) / nav;
      if (leverageRatio > ceiling) return 'red';
    }
  }
  const hasDrawdownRed = positions.some(p => p.unrealizedPnlPct / 100 <= DRAWDOWN_THRESHOLD_RED);
  if (hasDrawdownRed) return 'red';

  for (const account of accounts) {
    const nav = sleeveNavMap.get(account.id) ?? 0;
    if (nav <= 0) continue;
    const limit = account.concentrationLimit ?? DEFAULT_CONCENTRATION_LIMIT;
    const acctPositions = positions.filter(p => p.accountId === account.id);
    if (acctPositions.some(p => p.marketValue / nav > limit)) return 'amber';
    if (account.currentBalance < 0) return 'amber';
  }
  if (positions.some(p => p.unrealizedPnlPct / 100 <= DRAWDOWN_THRESHOLD_AMBER)) return 'amber';

  return 'green';
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { summary, accounts, positions, isLoading, error, refreshAll } = usePortfolio();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [dismissModal, setDismissModal] = useState<{ action: Action } | null>(null);

  useEffect(() => {
    refreshAll();
    const interval = setInterval(() => refreshAll(), 60_000);
    return () => clearInterval(interval);
  }, []);

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  // ── Derived data ────────────────────────────────────────────────────────────

  const sleeveNavMap = useMemo<Map<number, number>>(
    () => new Map((summary?.accounts ?? []).map(a => [a.id, a.nav])),
    [summary],
  );

  const sleeves = useMemo<SleeveData[]>(
    () =>
      (summary?.accounts ?? []).map(acc => {
        const flatAcc = accounts.find(a => a.id === acc.id);
        return {
          id: acc.id,
          name: acc.name,
          accountType: acc.accountType,
          nav: acc.nav,
          dayChange: acc.dayChange,
          dayChangePct: acc.dayChangePct,
          unrealizedPnl: acc.unrealizedPnl,
          unrealizedPnlPct: acc.unrealizedPnlPct,
          positionCount: acc.positionCount,
          cashBalance: flatAcc?.currentBalance,
        };
      }),
    [summary, accounts],
  );

  const healthSignal = useMemo(
    () => computeHealthSignal(positions, accounts, sleeveNavMap),
    [positions, accounts, sleeveNavMap],
  );

  const computedActions = useMemo(
    () => computeActions(accounts, positions, sleeveNavMap),
    [accounts, positions, sleeveNavMap],
  );

  // ── DB alerts (for dismissal cross-reference) ───────────────────────────────

  const {
    data: dbAlerts,
    refetch: refetchAlerts,
  } = useQuery({
    queryKey: ['alerts', 'all-active'],
    queryFn: () => apiGet<ApiAlert[]>('/alerts?status=active'),
    staleTime: Infinity,
  });

  const { mutate: generateAlerts } = useMutation({
    mutationFn: () => apiPost<ApiAlert[]>('/alerts/generate', {}),
    onSuccess: () => refetchAlerts(),
  });

  const { mutate: patchAlert } = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      apiPatch<ApiAlert>(`/alerts/${id}`, { status: 'acknowledged', ...(reason ? { dismissReason: reason } : {}) }),
    onSuccess: () => refetchAlerts(),
  });

  const actions = useMemo(
    () => reconcileActions(computedActions, dbAlerts ?? []),
    [computedActions, dbAlerts],
  );

  // ── Explicit refresh ────────────────────────────────────────────────────────

  const handleExplicitRefresh = useCallback(async () => {
    await refreshAll();
    generateAlerts();
  }, [refreshAll, generateAlerts]);

  // ── Dismissal ───────────────────────────────────────────────────────────────

  const handleDismiss = useCallback((action: Action) => {
    if (action.severity === 'red') {
      setDismissModal({ action });
    } else {
      // Amber: dismiss immediately, no reason required
      action.dbIds?.forEach(id => patchAlert({ id }));
    }
  }, [patchAlert]);

  const confirmDismiss = useCallback((reason: string) => {
    if (!dismissModal) return;
    dismissModal.action.dbIds?.forEach(id => patchAlert({ id, reason }));
    setDismissModal(null);
  }, [dismissModal, patchAlert]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Text style={styles.greeting}>{getGreeting()}</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => router.push('/ips-parse')}
            style={styles.refreshBtn}
            hitSlop={4}
          >
            <Feather name="file-text" size={18} color={colors.textSecondary} />
          </Pressable>
          <Pressable onPress={handleExplicitRefresh} style={styles.refreshBtn}>
            <Feather name="refresh-cw" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      </View>

      {error && (
        <Pressable style={styles.errorBanner} onPress={handleExplicitRefresh}>
          <Feather name="wifi-off" size={13} color={colors.negative} />
          <Text style={styles.errorBannerText}>{error}</Text>
          <Text style={styles.errorBannerRetry}>Retry</Text>
        </Pressable>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={handleExplicitRefresh}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Platform.OS === 'web' ? 100 : insets.bottom + 90 },
        ]}
      >
        {/* 1. Portfolio header */}
        <PortfolioHealthCard
          totalNav={summary?.totalNav ?? 0}
          totalUnrealizedPnl={summary?.totalUnrealizedPnl ?? 0}
          totalUnrealizedPnlPct={summary?.totalUnrealizedPnlPct ?? 0}
          dayChange={summary?.dayChange ?? 0}
          dayChangePct={summary?.dayChangePct ?? 0}
          positionCount={summary?.positionCount ?? 0}
          sleeveCount={sleeves.length}
          healthSignal={healthSignal}
          isLoading={isLoading && !summary}
        />

        {/* 2. Sleeve grid */}
        <SleeveSection sleeves={sleeves} />

        {/* 3. Actions */}
        <ActionsSection
          actions={actions}
          isLoading={isLoading && computedActions.length === 0}
          onDismiss={handleDismiss}
        />
      </ScrollView>

      {/* Dismiss reason modal — red items only */}
      <Modal visible={!!dismissModal} animationType="slide" presentationStyle="pageSheet" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Why are you dismissing this?</Text>
            <Text style={styles.modalSub} numberOfLines={3}>{dismissModal?.action.label}</Text>
            {DISMISS_REASONS.map(reason => (
              <Pressable
                key={reason}
                style={styles.reasonRow}
                onPress={() => confirmDismiss(reason)}
              >
                <Text style={styles.reasonText}>{reason}</Text>
                <Feather name="chevron-right" size={16} color={colors.textMuted} />
              </Pressable>
            ))}
            <Pressable style={styles.cancelBtn} onPress={() => setDismissModal(null)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── Actions section ──────────────────────────────────────────────────────────

interface ActionsSectionProps {
  actions: Action[];
  isLoading: boolean;
  onDismiss: (action: Action) => void;
}

function ActionsSection({ actions, isLoading, onDismiss }: ActionsSectionProps) {
  return (
    <View style={styles.actionsSection}>
      <Text style={styles.sectionTitle}>Actions</Text>
      <Card style={styles.actionsCard}>
        {isLoading ? (
          <View style={{ padding: 16, gap: 10 }}>
            <Skeleton height={14} width="80%" />
            <Skeleton height={14} width="60%" />
          </View>
        ) : actions.length === 0 ? (
          <View style={styles.emptyActions}>
            <Feather name="check-circle" size={20} color={colors.positive} />
            <Text style={styles.emptyActionsText}>No actions needed — portfolio looks good</Text>
          </View>
        ) : (
          actions.map((action, i) => (
            <ActionRow
              key={action.id}
              action={action}
              showBorder={i > 0}
              onDismiss={onDismiss}
            />
          ))
        )}
      </Card>
    </View>
  );
}

interface ActionRowProps {
  action: Action;
  showBorder: boolean;
  onDismiss: (action: Action) => void;
}

function ActionRow({ action, showBorder, onDismiss }: ActionRowProps) {
  const barColor = action.severity === 'red' ? colors.negative : '#F59E0B';
  const canDismiss = (action.dbIds?.length ?? 0) > 0;

  const handleRowPress = () => {
    if (action.positionId != null) {
      // Concentration (position-level) → ActionDetailScreen
      router.push({ pathname: '/action-detail', params: { actionId: action.id } });
    } else {
      // Leverage / drawdown (sleeve-level) → sleeve detail
      router.push({ pathname: '/account/[id]', params: { id: String(action.accountId) } });
    }
  };

  return (
    <Pressable
      style={[styles.actionRow, showBorder && styles.actionRowBorder]}
      onPress={handleRowPress}
    >
      <View style={[styles.severityBar, { backgroundColor: barColor }]} />
      <Text style={styles.actionLabel}>{action.label}</Text>
      {canDismiss && (
        <Pressable
          onPress={() => onDismiss(action)}
          style={styles.dismissBtn}
          hitSlop={8}
        >
          <Feather name="x" size={14} color={colors.textMuted} />
        </Pressable>
      )}
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 8,
    paddingTop: 4,
  },
  greeting: {
    fontFamily: 'Inter_700Bold',
    fontSize: 26,
    color: colors.textPrimary,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  refreshBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,59,48,0.10)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,59,48,0.25)',
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  errorBannerText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.negative,
  },
  errorBannerRetry: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.negative,
  },
  scroll: {
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: 12,
  },
  // Actions section
  actionsSection: {
    marginBottom: 20,
  },
  actionsCard: {
    padding: 0,
    overflow: 'hidden',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingRight: 14,
  },
  actionRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  severityBar: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 2,
    marginHorizontal: 12,
    minHeight: 36,
  },
  actionLabel: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 18,
  },
  dismissBtn: {
    marginLeft: 8,
    padding: 4,
  },
  emptyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
  },
  emptyActionsText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
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
  modalSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 20,
    lineHeight: 18,
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
