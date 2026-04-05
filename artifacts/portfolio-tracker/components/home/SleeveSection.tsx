import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { colors } from '@/constants/colors';
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
      <View style={styles.grid}>
        {sleeves.map(sleeve => {
          const isDayUp = sleeve.dayChangePct >= 0;
          return (
            <Pressable
              key={sleeve.id}
              style={({ pressed }) => [styles.card, { opacity: pressed ? 0.75 : 1 }]}
              onPress={() =>
                router.push({ pathname: '/account/[id]', params: { id: sleeve.id.toString() } })
              }
            >
              <Text style={styles.name} numberOfLines={1}>{sleeve.name}</Text>
              <Text style={styles.nav}>{formatCurrency(sleeve.nav, 'compact')}</Text>
              <Text style={[styles.day, { color: isDayUp ? colors.positive : colors.negative }]}>
                {isDayUp ? '+' : ''}{formatCurrency(Math.abs(sleeve.dayChange))} ({isDayUp ? '+' : ''}{sleeve.dayChangePct.toFixed(2)}%)
              </Text>
            </Pressable>
          );
        })}
      </View>
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  card: {
    width: '48.5%',
    backgroundColor: '#161B22',
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: '#30363D',
    padding: 14,
    gap: 4,
  },
  name: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.textPrimary,
  },
  nav: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: colors.textPrimary,
    marginTop: 2,
  },
  day: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginTop: 2,
  },
});
