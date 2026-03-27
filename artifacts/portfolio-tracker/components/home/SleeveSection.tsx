import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { colors } from '@/constants/colors';
import { Card } from '@/components/ui/Card';
import { AccountTypeBadge } from '@/components/ui/AccountTypeBadge';
import { formatCurrency } from '@/components/ui/PnlBadge';

export interface SleeveData {
  id: number;
  name: string;
  accountType: string;
  nav: number;
  dayChange: number;
  dayChangePct: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  positionCount: number;
  topMover?: { symbol: string; dayChangePct: number };
  cashBalance?: number;
}

interface Props {
  sleeves: SleeveData[];
}

export function SleeveSection({ sleeves }: Props) {
  if (sleeves.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Sleeves</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {sleeves.map(sleeve => {
          const isDayUp = sleeve.dayChangePct >= 0;
          const isPnlUp = sleeve.unrealizedPnl >= 0;
          return (
            <Card
              key={sleeve.id}
              style={styles.card}
              onPress={() =>
                router.push({ pathname: '/account/[id]', params: { id: sleeve.id.toString() } })
              }
            >
              <AccountTypeBadge type={sleeve.accountType as any} size="sm" />
              <Text style={styles.name} numberOfLines={1}>{sleeve.name}</Text>
              <Text style={styles.nav}>{formatCurrency(sleeve.nav)}</Text>
              <Text style={[styles.pnl, { color: isPnlUp ? colors.positive : colors.negative }]}>
                {isPnlUp ? '+' : ''}{sleeve.unrealizedPnlPct.toFixed(1)}% total
              </Text>
              <Text style={[styles.day, { color: isDayUp ? colors.positive : colors.negative }]}>
                {isDayUp ? '+' : ''}{sleeve.dayChangePct.toFixed(2)}% today
              </Text>
              {sleeve.cashBalance !== undefined && sleeve.cashBalance < 0 && (
                <View style={styles.leveragedChip}>
                  <Text style={styles.leveragedText}>LEVERAGED</Text>
                </View>
              )}
              {sleeve.topMover && (
                <View style={[
                  styles.moverChip,
                  {
                    backgroundColor: sleeve.topMover.dayChangePct >= 0
                      ? 'rgba(0,230,118,0.1)'
                      : 'rgba(255,71,87,0.1)',
                  },
                ]}>
                  <Text style={styles.moverSymbol}>{sleeve.topMover.symbol}</Text>
                  <Text style={[
                    styles.moverPct,
                    { color: sleeve.topMover.dayChangePct >= 0 ? colors.positive : colors.negative },
                  ]}>
                    {sleeve.topMover.dayChangePct >= 0 ? '+' : ''}
                    {sleeve.topMover.dayChangePct.toFixed(1)}%
                  </Text>
                </View>
              )}
              <Text style={styles.posCount}>{sleeve.positionCount} positions</Text>
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: 12,
  },
  scroll: {
    marginHorizontal: -4,
  },
  scrollContent: {
    paddingHorizontal: 4,
  },
  card: {
    width: 150,
    marginHorizontal: 4,
    padding: 14,
    gap: 4,
  },
  name: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.textPrimary,
    marginTop: 6,
  },
  nav: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: colors.textPrimary,
    marginTop: 2,
  },
  pnl: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  day: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: colors.textMuted,
  },
  leveragedChip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,71,87,0.12)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginTop: 4,
  },
  leveragedText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
    color: colors.negative,
    letterSpacing: 0.5,
  },
  moverChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  moverSymbol: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    color: colors.textPrimary,
  },
  moverPct: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
  },
  posCount: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 4,
  },
});
