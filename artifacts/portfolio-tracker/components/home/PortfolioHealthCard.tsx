import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@/constants/colors';
import { Card } from '@/components/ui/Card';
import { PnlBadge, formatCurrency } from '@/components/ui/PnlBadge';
import { Skeleton } from '@/components/ui/Skeleton';

export type HealthSignal = 'green' | 'amber' | 'red';

const SIGNAL_COLOR: Record<HealthSignal, string> = {
  green: colors.positive,
  amber: '#F5A623',
  red: colors.negative,
};

const SIGNAL_LABEL: Record<HealthSignal, string> = {
  green: 'Healthy',
  amber: 'Needs attention',
  red: 'Action required',
};

interface Props {
  totalNav: number;
  totalUnrealizedPnl: number;
  totalUnrealizedPnlPct: number;
  dayChange: number;
  dayChangePct: number;
  positionCount: number;
  sleeveCount: number;
  healthSignal: HealthSignal;
  isLoading: boolean;
}

export function PortfolioHealthCard({
  totalNav,
  totalUnrealizedPnl,
  totalUnrealizedPnlPct,
  dayChange,
  dayChangePct,
  positionCount,
  sleeveCount,
  healthSignal,
  isLoading,
}: Props) {
  if (isLoading) {
    return (
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.separator }]}>
        <Skeleton height={11} width="45%" />
        <Skeleton height={40} width="60%" style={{ marginTop: 10 }} />
        <Skeleton height={28} width="50%" style={{ marginTop: 10 }} />
      </View>
    );
  }

  const signalColor = SIGNAL_COLOR[healthSignal];

  return (
    <Card style={[styles.card, { borderColor: `${signalColor}33` }]}>
      <View style={styles.topRow}>
        <Text style={styles.label}>TOTAL PORTFOLIO VALUE</Text>
        <View style={styles.signalBadge}>
          <View style={[styles.signalDot, { backgroundColor: signalColor }]} />
          <Text style={[styles.signalText, { color: signalColor }]}>
            {SIGNAL_LABEL[healthSignal]}
          </Text>
        </View>
      </View>

      <Text style={styles.nav}>{formatCurrency(totalNav)}</Text>

      <View style={styles.badgeRow}>
        <PnlBadge value={totalUnrealizedPnl} percentage={totalUnrealizedPnlPct} size="md" />
        <Text style={styles.meta}>
          {positionCount} positions · {sleeveCount} {sleeveCount === 1 ? 'sleeve' : 'sleeves'}
        </Text>
      </View>

      {dayChange !== 0 && (
        <View style={styles.dailyRow}>
          <Text style={styles.dailyLabel}>Today</Text>
          <Text style={[styles.dailyVal, { color: dayChange >= 0 ? colors.positive : colors.negative }]}>
            {dayChange >= 0 ? '+' : ''}{formatCurrency(dayChange)}
            {'  '}({dayChangePct >= 0 ? '+' : ''}{dayChangePct.toFixed(2)}%)
          </Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 20,
    marginBottom: 20,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  signalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  signalDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  signalText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  nav: {
    fontFamily: 'Inter_700Bold',
    fontSize: 38,
    color: colors.textPrimary,
    marginBottom: 10,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  meta: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
  },
  dailyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  dailyLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
  },
  dailyVal: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
});
