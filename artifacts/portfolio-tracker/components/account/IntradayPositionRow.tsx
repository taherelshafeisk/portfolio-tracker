import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { BUCKET_LABELS, BUCKET_COLORS, type Bucket } from '@/lib/buckets';
import type { Position } from '@/context/PortfolioContext';

interface IntradayPositionRowProps {
  position: Position;
  bucket: Bucket;
  /** Today's unrealized $ change (shares × day change $) */
  todayPnlAmt: number;
  /** Optional severity badges pre-computed by parent */
  concentrationSeverity?: 'warning' | 'critical' | null;
  drawdownSeverity?: 'warning' | 'critical' | null;
  onPress: () => void;
  onMenuPress: () => void;
}

function formatCompact(val: number): string {
  if (Math.abs(val) >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000)     return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

export function IntradayPositionRow({
  position: pos,
  bucket,
  todayPnlAmt,
  concentrationSeverity,
  drawdownSeverity,
  onPress,
  onMenuPress,
}: IntradayPositionRowProps) {
  const isDayPos    = (pos.dayChangePct ?? 0) >= 0;
  const isPnlPos    = pos.unrealizedPnlPct >= 0;
  const isTodayPos  = todayPnlAmt >= 0;
  const dayColor    = isDayPos ? colors.positive : colors.negative;
  const pnlColor    = isPnlPos ? colors.positive : colors.negative;
  const todayColor  = isTodayPos ? colors.positive : colors.negative;
  const bucketColor = BUCKET_COLORS[bucket];

  const hasConcBadge = concentrationSeverity != null;
  const hasDdBadge   = drawdownSeverity != null;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {/* Left: symbol + badges */}
      <View style={styles.left}>
        <Text style={styles.symbol}>{pos.symbol}</Text>
        <View style={[styles.bucketBadge, { backgroundColor: bucketColor + '20', borderColor: bucketColor + '50' }]}>
          <Text style={[styles.bucketLabel, { color: bucketColor }]}>{BUCKET_LABELS[bucket]}</Text>
        </View>
        {hasConcBadge && (
          <View style={[styles.policyBadge, concentrationSeverity === 'critical' ? styles.badgeCritical : styles.badgeWarning]}>
            <Text style={styles.policyBadgeText}>Over limit</Text>
          </View>
        )}
        {hasDdBadge && (
          <View style={[styles.policyBadge, drawdownSeverity === 'critical' ? styles.badgeCritical : styles.badgeWarning]}>
            <Text style={styles.policyBadgeText}>Drawdown</Text>
          </View>
        )}
      </View>

      {/* Right: today%, P&L%, todayPnl$, value, menu */}
      <View style={styles.right}>
        <Text style={[styles.dayPct, { color: dayColor }]}>
          {isDayPos ? '+' : ''}{(pos.dayChangePct ?? 0).toFixed(1)}%
        </Text>
        <Text style={[styles.pnlPct, { color: pnlColor }]}>
          {isPnlPos ? '+' : ''}{pos.unrealizedPnlPct.toFixed(1)}%
        </Text>
        <Text style={[styles.todayPnl, { color: todayColor }]}>
          {isTodayPos ? '+' : ''}{formatCompact(todayPnlAmt)}
        </Text>
        <Text style={styles.mktVal}>{formatCompact(pos.marketValue)}</Text>
        <Pressable
          onPress={onMenuPress}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={styles.menuBtn}
        >
          <Feather name="more-vertical" size={14} color={colors.textMuted} />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.surface,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: colors.separator,
  },
  pressed: { opacity: 0.75 },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    flexWrap: 'wrap',
  },
  symbol: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: colors.textPrimary,
    minWidth: 52,
  },
  bucketBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  bucketLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 9,
  },
  policyBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeCritical: { backgroundColor: 'rgba(255,59,48,0.18)' },
  badgeWarning:  { backgroundColor: 'rgba(255,149,0,0.18)' },
  policyBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 9,
    color: colors.textSecondary,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dayPct: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    width: 44,
    textAlign: 'right',
  },
  pnlPct: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: colors.textSecondary,
    width: 50,
    textAlign: 'right',
  },
  todayPnl: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    width: 50,
    textAlign: 'right',
  },
  mktVal: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: colors.textPrimary,
    width: 56,
    textAlign: 'right',
  },
  menuBtn: { padding: 4 },
});
