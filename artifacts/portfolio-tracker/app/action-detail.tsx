import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, Modal, GestureResponderEvent,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { colors } from '@/constants/colors';
import { usePortfolio, apiGet, apiPatch } from '@/context/PortfolioContext';
import { formatCurrency } from '@/components/ui/PnlBadge';
import { Card } from '@/components/ui/Card';
import { TriggerLevelsCard } from '@/components/position/TriggerLevelsCard';
import { CrossAccountExposureCard } from '@/components/position/CrossAccountExposureCard';
import {
  computeActions, reconcileActions,
  DEFAULT_CONCENTRATION_LIMIT, DEFAULT_LEVERAGE_CEILING, DRAWDOWN_THRESHOLD_AMBER,
  type Action,
} from '@/lib/actions';
import { defaultStrategyProfile } from '@workspace/portfolio-policy';

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── Helper components ────────────────────────────────────────────────────────

function SectionLabel({ title }: { title: string }) {
  return <Text style={styles.sectionLabel}>{title}</Text>;
}

function MetricRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, color ? { color } : undefined]}>{value}</Text>
    </View>
  );
}

function RowDivider() {
  return <View style={styles.rowDivider} />;
}

// ─── Custom slider ────────────────────────────────────────────────────────────

interface SliderProps {
  /** 0..1 fraction (0 = sell everything, 1 = keep at current) */
  value: number;
  /** default target fraction (e.g. 0.20 for concentrationLimit) */
  defaultMark: number;
  onChange: (v: number) => void;
}

function SliderTrack({ value, defaultMark, onChange }: SliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);

  const handleTouch = useCallback(
    (e: GestureResponderEvent) => {
      if (trackWidth === 0) return;
      const x = e.nativeEvent.locationX;
      const clamped = Math.max(0, Math.min(1, x / trackWidth));
      onChange(clamped);
    },
    [trackWidth, onChange],
  );

  const filledPct = value * 100;
  const markPct = defaultMark * 100;

  return (
    <View
      style={styles.sliderTrack}
      onLayout={e => setTrackWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={handleTouch}
      onResponderMove={handleTouch}
    >
      {/* Filled portion */}
      <View style={[styles.sliderFill, { width: `${filledPct}%` }]} />
      {/* Default mark line */}
      <View style={[styles.sliderMark, { left: `${markPct}%` }]} />
      {/* Thumb */}
      <View style={[styles.sliderThumb, { left: `${filledPct}%`, marginLeft: -10 }]} />
    </View>
  );
}

// ─── Tranche row ──────────────────────────────────────────────────────────────

function TrancheRow({
  label,
  qty,
  price,
  estValue,
  isExecuted,
  onMarkExecuted,
}: {
  label: string;
  qty: number;
  price: number;
  estValue: number;
  isExecuted: boolean;
  onMarkExecuted: () => void;
}) {
  return (
    <View style={[styles.trancheRow, isExecuted && styles.trancheExecuted]}>
      <View style={styles.trancheLeft}>
        <Text style={styles.trancheLabel}>{label}</Text>
        <Text style={styles.trancheDetail}>
          {qty.toFixed(2)} sh @ {formatCurrency(price)} ≈ {formatCurrency(estValue)}
        </Text>
      </View>
      <Pressable
        style={[styles.trancheBtn, isExecuted && styles.trancheBtnDone]}
        onPress={onMarkExecuted}
        disabled={isExecuted}
      >
        {isExecuted ? (
          <Feather name="check" size={14} color={colors.positive} />
        ) : (
          <Text style={styles.trancheBtnText}>Mark Executed</Text>
        )}
      </Pressable>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ActionDetailScreen() {
  const { actionId } = useLocalSearchParams<{ actionId: string }>();
  const insets = useSafeAreaInsets();
  const { accounts, positions, summary } = usePortfolio();

  // Slider: 0 = 0% target (exit full), 1 = keep at current level
  // Default = concentrationLimit expressed as fraction of current position %
  const [trimFraction, setTrimFraction] = useState<number | null>(null);
  const [trancheExecuted, setTrancheExecuted] = useState([false, false, false]);
  const [showDismissModal, setShowDismissModal] = useState(false);

  // ── Resolve action ─────────────────────────────────────────────────────────

  const sleeveNavMap = useMemo(
    () => new Map((summary?.accounts ?? []).map(a => [a.id, a.nav])),
    [summary],
  );

  const allActions = useMemo(
    () => computeActions(accounts, positions, sleeveNavMap),
    [accounts, positions, sleeveNavMap],
  );

  const action = useMemo(
    () => allActions.find(a => a.id === actionId),
    [allActions, actionId],
  );

  // ── Position & account data ────────────────────────────────────────────────

  const position = useMemo(
    () =>
      action?.positionId != null
        ? positions.find(p => p.id === action.positionId)
        : undefined,
    [action, positions],
  );

  const account = useMemo(
    () => (action ? accounts.find(a => a.id === action.accountId) : undefined),
    [action, accounts],
  );

  const sleeveNav = action ? (sleeveNavMap.get(action.accountId) ?? 0) : 0;
  const concentrationLimit = account?.concentrationLimit ?? DEFAULT_CONCENTRATION_LIMIT;
  const leverageCeiling = account?.leverageCeiling ?? DEFAULT_LEVERAGE_CEILING;

  // Slider state: fraction of the track (0 = trim to 0%, 1 = keep current %)
  const concentrationPct =
    sleeveNav > 0 && position ? (position.marketValue / sleeveNav) * 100 : 0;

  // Default mark on slider corresponds to concentrationLimit as a fraction of current %
  const defaultMark =
    concentrationPct > 0 ? concentrationLimit / (concentrationPct / 100) : 0.5;
  const clampedDefaultMark = Math.min(1, Math.max(0, defaultMark));

  // Effective trim target %: slider value → target sleeve % for this position
  const effectiveTrimTargetPct =
    trimFraction !== null
      ? trimFraction * concentrationPct
      : concentrationLimit * 100;

  // ── Concentration calculations ─────────────────────────────────────────────

  const concCalcs = useMemo(() => {
    if (action?.type !== 'concentration' || !position || sleeveNav <= 0) return null;
    const targetValue = (effectiveTrimTargetPct / 100) * sleeveNav;
    const qtyToSell = Math.max(0, (position.marketValue - targetValue) / position.currentPrice);
    const estValue = qtyToSell * position.currentPrice;
    const pctAfter = sleeveNav > 0 ? ((position.marketValue - estValue) / sleeveNav) * 100 : 0;
    const t1Price = position.currentPrice;
    const t2Price = position.currentPrice * 1.01;
    const t3Price = position.currentPrice * 1.02;
    return {
      qtyToSell,
      estValue,
      pctAfter,
      tranches: [
        { qty: qtyToSell / 3, price: t1Price },
        { qty: qtyToSell / 3, price: t2Price },
        { qty: qtyToSell / 3, price: t3Price },
      ],
    };
  }, [action?.type, position, sleeveNav, effectiveTrimTargetPct]);

  // ── DB alerts (for dismiss) ────────────────────────────────────────────────

  const { data: dbAlerts, refetch: refetchAlerts } = useQuery({
    queryKey: ['alerts', 'all-active'],
    queryFn: () => apiGet<ApiAlert[]>('/alerts?status=active'),
    staleTime: Infinity,
    enabled: !!action,
  });

  const { mutate: patchAlert } = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) =>
      apiPatch<unknown>(`/alerts/${id}`, {
        status: 'acknowledged',
        ...(reason ? { dismissReason: reason } : {}),
      }),
    onSuccess: () => {
      refetchAlerts();
      router.back();
    },
  });

  const resolvedAction = useMemo(() => {
    if (!action) return undefined;
    const [r] = reconcileActions([action], dbAlerts ?? []);
    return r;
  }, [action, dbAlerts]);

  const handleDismissWithReason = useCallback(
    (reason: string) => {
      setShowDismissModal(false);
      resolvedAction?.dbIds?.forEach(id => patchAlert({ id, reason }));
    },
    [resolvedAction, patchAlert],
  );

  // ── Drawdown positions list ────────────────────────────────────────────────

  const drawdownPositions = useMemo(() => {
    if (action?.type !== 'drawdown') return [];
    return positions
      .filter(
        p =>
          p.accountId === action.accountId &&
          p.unrealizedPnlPct / 100 <= DRAWDOWN_THRESHOLD_AMBER,
      )
      .sort((a, b) => a.unrealizedPnlPct - b.unrealizedPnlPct);
  }, [action, positions]);

  // ── Cross-account exposure (concentration) ─────────────────────────────────

  const crossAccountEntries = useMemo(() => {
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
  }, [position, positions, accounts]);

  // ── Leverage ratio ─────────────────────────────────────────────────────────

  const leverageRatio = useMemo(() => {
    if (!account || account.currentBalance >= 0) return null;
    const nav = sleeveNav;
    if (nav <= 0) return null;
    const borrowed = Math.abs(account.currentBalance);
    return (nav + borrowed) / nav;
  }, [account, sleeveNav]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!action) {
    return (
      <View style={[styles.container, { paddingTop: Platform.OS === 'web' ? 67 : insets.top }]}>
        <View style={styles.navbar}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Feather name="arrow-left" size={22} color={colors.textPrimary} />
          </Pressable>
        </View>
        <View style={styles.loadingCenter}>
          <Text style={styles.notFound}>Action not found</Text>
        </View>
      </View>
    );
  }

  const title = position?.symbol ?? account?.name ?? '—';
  const severityColor = action.severity === 'red' ? colors.negative : '#F59E0B';
  const { concentrationRule, drawdownRule } = defaultStrategyProfile;

  const sliderValue =
    trimFraction !== null ? trimFraction : clampedDefaultMark;

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === 'web' ? 67 : insets.top }]}>
      {/* Nav bar */}
      <View style={styles.navbar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.navTitle}>
          <Text style={styles.navSymbol}>{title}</Text>
          {action.type === 'concentration' ? (
            <View style={[styles.sideBadge, { backgroundColor: `${colors.negative}22` }]}>
              <Text style={[styles.sideText, { color: colors.negative }]}>SELL</Text>
            </View>
          ) : (
            <View style={[styles.severityDot, { backgroundColor: severityColor }]} />
          )}
        </View>
        <View style={styles.backBtn} />
      </View>

      {/* Sub-title */}
      {position?.name ? (
        <Text style={styles.subTitle} numberOfLines={1}>{position.name}</Text>
      ) : account?.name && action.type !== 'concentration' ? (
        <Text style={styles.subTitle} numberOfLines={1}>{account.name}</Text>
      ) : null}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: Platform.OS === 'web' ? 120 : insets.bottom + 120 },
        ]}
      >
        {/* ── Section 1: The Issue ──────────────────────────────────────────── */}
        <SectionLabel title="The Issue" />
        <Card style={styles.issueCard}>
          <View style={[styles.issueSeverityBar, { backgroundColor: severityColor }]} />
          <Text style={styles.issueText}>{action.label}</Text>
        </Card>

        {/* Trigger levels for concentration */}
        {action.type === 'concentration' && position && (
          <TriggerLevelsCard
            concentrationPct={concentrationPct}
            drawdownPct={position.unrealizedPnlPct}
            concWarnPct={concentrationRule.warningPct * 100}
            concCritPct={concentrationRule.criticalPct * 100}
            ddWarnPct={drawdownRule.warningPct * 100}
            ddCritPct={drawdownRule.criticalPct * 100}
            currentPrice={position.currentPrice}
            stopPrice={position.stopPrice != null ? Number(position.stopPrice) : undefined}
            ipsAction={position.ipsAction ?? undefined}
            addZoneLow={position.addZoneLow != null ? Number(position.addZoneLow) : undefined}
            addZoneHigh={position.addZoneHigh != null ? Number(position.addZoneHigh) : undefined}
          />
        )}

        {/* Leverage context */}
        {action.type === 'leverage' && account && (
          <>
            <SectionLabel title="Context" />
            <Card style={styles.metricCard}>
              <MetricRow
                label="Current Leverage"
                value={leverageRatio != null ? `${leverageRatio.toFixed(2)}x` : '—'}
                color={leverageRatio != null && leverageRatio > leverageCeiling ? colors.negative : '#F59E0B'}
              />
              <RowDivider />
              <MetricRow label="Ceiling" value={`${leverageCeiling.toFixed(1)}x`} />
              <RowDivider />
              <MetricRow
                label="Cash Balance"
                value={formatCurrency(account.currentBalance)}
                color={colors.negative}
              />
            </Card>
          </>
        )}

        {/* Drawdown summary */}
        {action.type === 'drawdown' && (
          <>
            <SectionLabel title="Context" />
            <Card style={styles.metricCard}>
              <MetricRow
                label="Positions in Drawdown"
                value={`${drawdownPositions.length}`}
              />
            </Card>
          </>
        )}

        {/* ── Section 2: Position Context (concentration only) ──────────────── */}
        {action.type === 'concentration' && position && (
          <>
            <SectionLabel title="Position" />
            <Card style={styles.metricCard}>
              <MetricRow label="Qty Held" value={`${position.quantity.toFixed(4)} sh`} />
              <RowDivider />
              <MetricRow label="Avg Cost" value={formatCurrency(position.avgCost)} />
              <RowDivider />
              <MetricRow label="Current Price" value={formatCurrency(position.currentPrice)} />
              <RowDivider />
              <MetricRow
                label="Unrealized P&L"
                value={`${formatCurrency(position.unrealizedPnl)} (${position.unrealizedPnlPct >= 0 ? '+' : ''}${position.unrealizedPnlPct.toFixed(2)}%)`}
                color={position.unrealizedPnl >= 0 ? colors.positive : colors.negative}
              />
              <RowDivider />
              <MetricRow
                label="% of Sleeve"
                value={`${concentrationPct.toFixed(1)}%`}
              />
            </Card>

            <CrossAccountExposureCard
              symbol={position.symbol}
              entries={crossAccountEntries}
            />
          </>
        )}

        {/* Drawdown position list */}
        {action.type === 'drawdown' && drawdownPositions.length > 0 && (
          <>
            <SectionLabel title="Positions" />
            <Card style={styles.metricCard}>
              {drawdownPositions.map((p, i) => (
                <React.Fragment key={p.id}>
                  {i > 0 && <RowDivider />}
                  <MetricRow
                    label={p.symbol}
                    value={`${p.unrealizedPnlPct.toFixed(1)}%`}
                    color={colors.negative}
                  />
                </React.Fragment>
              ))}
            </Card>
          </>
        )}

        {/* ── Section 3: Resolution (concentration) ─────────────────────────── */}
        {action.type === 'concentration' && position && concCalcs && (
          <>
            <SectionLabel title="Resolution" />

            {/* Target label */}
            <Card style={styles.targetCard}>
              <Text style={styles.targetText}>
                To reach{' '}
                <Text style={styles.targetHighlight}>
                  {effectiveTrimTargetPct.toFixed(0)}%
                </Text>
                , sell{' '}
                <Text style={styles.targetHighlight}>
                  {concCalcs.qtyToSell.toFixed(2)} shares
                </Text>
                {' '}(est.{' '}
                <Text style={styles.targetHighlight}>
                  {formatCurrency(concCalcs.estValue)}
                </Text>
                )
              </Text>
              <Text style={styles.targetAfter}>
                Sleeve % after: {concCalcs.pctAfter.toFixed(1)}%
              </Text>
            </Card>

            {/* Slider */}
            <Card style={styles.sliderCard}>
              <View style={styles.sliderLabelRow}>
                <Text style={styles.sliderLabel}>Trim to</Text>
                <Text style={styles.sliderValueText}>
                  {effectiveTrimTargetPct.toFixed(0)}%
                </Text>
              </View>
              <SliderTrack
                value={sliderValue}
                defaultMark={clampedDefaultMark}
                onChange={(v) => setTrimFraction(v)}
              />
              <View style={styles.sliderLimits}>
                <Text style={styles.sliderLimitText}>0% (full exit)</Text>
                <Text style={styles.sliderLimitText}>
                  {concentrationPct.toFixed(1)}% (current)
                </Text>
              </View>
            </Card>

            {/* Exit fully */}
            <Pressable
              style={styles.exitFullyBtn}
              onPress={() => setTrimFraction(0)}
            >
              <Text style={styles.exitFullyText}>Exit fully</Text>
            </Pressable>

            {/* Tranches — sell into strength, limit orders at or above current price */}
            <SectionLabel title="Tranches (at or above current price)" />
            {concCalcs.tranches.map((t, i) => (
              <TrancheRow
                key={i}
                label={`Tranche ${i + 1}`}
                qty={t.qty}
                price={t.price}
                estValue={t.qty * t.price}
                isExecuted={trancheExecuted[i]}
                onMarkExecuted={() => {
                  const next = [...trancheExecuted] as [boolean, boolean, boolean];
                  next[i] = true;
                  setTrancheExecuted(next);
                }}
              />
            ))}
          </>
        )}
      </ScrollView>

      {/* Bottom bar */}
      <View
        style={[
          styles.bottomBar,
          { paddingBottom: Platform.OS === 'web' ? 16 : insets.bottom + 8 },
        ]}
      >
        <Pressable
          style={[styles.bottomBtn, styles.dismissBtn]}
          onPress={() => setShowDismissModal(true)}
        >
          <Text style={styles.dismissText}>Dismiss with reason</Text>
        </Pressable>
      </View>

      {/* Dismiss reason modal */}
      <Modal
        visible={showDismissModal}
        animationType="slide"
        presentationStyle="pageSheet"
        transparent
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Why are you dismissing this?</Text>
            <Text style={styles.modalSub} numberOfLines={2}>
              {action.label}
            </Text>
            {DISMISS_REASONS.map(reason => (
              <Pressable
                key={reason}
                style={styles.reasonRow}
                onPress={() => handleDismissWithReason(reason)}
              >
                <Text style={styles.reasonText}>{reason}</Text>
                <Feather name="chevron-right" size={16} color={colors.textMuted} />
              </Pressable>
            ))}
            <Pressable
              style={styles.cancelBtn}
              onPress={() => setShowDismissModal(false)}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
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
  severityDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  subTitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  loadingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFound: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: colors.textMuted,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  sectionLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 20,
    marginBottom: 8,
  },
  // Issue card
  issueCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 0,
    overflow: 'hidden',
    gap: 0,
  },
  issueSeverityBar: {
    width: 3,
    alignSelf: 'stretch',
    minHeight: 40,
    borderRadius: 2,
    marginRight: 12,
    marginVertical: 0,
  },
  issueText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 20,
    paddingVertical: 14,
    paddingRight: 14,
  },
  // Metric card
  metricCard: {
    padding: 0,
    overflow: 'hidden',
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  metricLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.textSecondary,
  },
  metricValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: 'right',
    flexShrink: 1,
    marginLeft: 12,
  },
  rowDivider: {
    height: 0.5,
    backgroundColor: colors.separator,
    marginHorizontal: 16,
  },
  // Target card
  targetCard: {
    gap: 4,
  },
  targetText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  targetHighlight: {
    fontFamily: 'Inter_600SemiBold',
    color: colors.textPrimary,
  },
  targetAfter: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
  },
  // Slider
  sliderCard: {
    gap: 12,
    marginTop: 8,
  },
  sliderLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sliderLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: colors.textSecondary,
  },
  sliderValueText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: colors.textPrimary,
  },
  sliderTrack: {
    height: 24,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 12,
    overflow: 'visible',
    position: 'relative',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.primary + '44',
    borderRadius: 12,
  },
  sliderMark: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#F59E0B',
    borderRadius: 1,
  },
  sliderThumb: {
    position: 'absolute',
    top: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 4,
  },
  sliderLimits: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sliderLimitText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: colors.textMuted,
  },
  exitFullyBtn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surfaceElevated,
  },
  exitFullyText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.textSecondary,
  },
  // Tranche rows
  trancheRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: colors.separator,
    padding: 14,
    marginBottom: 8,
  },
  trancheExecuted: {
    opacity: 0.5,
  },
  trancheLeft: {
    flex: 1,
    gap: 2,
  },
  trancheLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.textPrimary,
  },
  trancheDetail: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textSecondary,
  },
  trancheBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: colors.primary,
    marginLeft: 12,
  },
  trancheBtnDone: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.positive + '44',
  },
  trancheBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: colors.background,
  },
  // Bottom bar
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 0.5,
    borderTopColor: colors.separator,
    backgroundColor: colors.background,
  },
  bottomBtn: {
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
