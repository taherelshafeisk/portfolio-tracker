import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
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
        <View style={[styles.bucketBadge, { borderColor: bucketColor + '60' }]}>
          <Text style={[styles.bucketLabel, { color: bucketColor }]}>{BUCKET_LABELS[bucket]}</Text>
        </View>
        {hasConcBadge && (
          <View style={[styles.policyBadge, concentrationSeverity === 'critical' ? styles.badgeCritical : styles.badgeWarning]}>
            <Text style={[styles.policyBadgeText, { color: concentrationSeverity === 'critical' ? colors.negative : colors.amber }]}>
              Over limit
            </Text>
          </View>
        )}
        {hasDdBadge && (
          <View style={[styles.policyBadge, drawdownSeverity === 'critical' ? styles.badgeCritical : styles.badgeWarning]}>
            <Text style={[styles.policyBadgeText, { color: drawdownSeverity === 'critical' ? colors.negative : colors.amber }]}>
              Drawdown
            </Text>
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
          <Text style={styles.menuDots}>···</Text>
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
    borderRadius: 2,
    backgroundColor: colors.card,
    marginBottom: 2,
    borderWidth: 1,
    borderColor: colors.hair2,
  },
  pressed: { backgroundColor: colors.bgInset },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
    flexWrap: 'wrap',
  },
  symbol: {
    fontFamily: fonts.monoBold,
    fontSize: 12,
    color: colors.ink,
    minWidth: 44,
  },
  bucketBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 2,
    borderWidth: 1,
    backgroundColor: colors.bgInset,
  },
  bucketLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 0.5,
  },
  policyBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 2,
  },
  badgeCritical: { backgroundColor: colors.negativeLight },
  badgeWarning:  { backgroundColor: colors.amberSoft },
  policyBadgeText: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 0.3,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dayPct: {
    fontFamily: fonts.mono,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    width: 44,
    textAlign: 'right',
  },
  pnlPct: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    color: colors.ink3,
    width: 50,
    textAlign: 'right',
  },
  todayPnl: {
    fontFamily: fonts.mono,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    width: 50,
    textAlign: 'right',
  },
  mktVal: {
    fontFamily: fonts.monoMedium,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    color: colors.ink,
    width: 56,
    textAlign: 'right',
  },
  menuBtn: { padding: 4 },
  menuDots: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.ink3,
    letterSpacing: 1,
  },
});
