import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@/constants/colors';
import { Card } from '@/components/ui/Card';
import { formatCurrency } from '@/components/ui/PnlBadge';

export interface ExposureEntry {
  accountId: number;
  accountName: string;
  quantity: number;
  marketValue: number;
}

interface Props {
  symbol: string;
  entries: ExposureEntry[];
}

export function CrossAccountExposureCard({ symbol, entries }: Props) {
  // Group by accountId to avoid duplicate rows when the same account has multiple positions
  const grouped = React.useMemo(() => {
    const map = new Map<number, ExposureEntry>();
    for (const e of entries) {
      const existing = map.get(e.accountId);
      if (existing) {
        map.set(e.accountId, {
          accountId: e.accountId,
          accountName: e.accountName,
          quantity: existing.quantity + e.quantity,
          marketValue: existing.marketValue + e.marketValue,
        });
      } else {
        map.set(e.accountId, { ...e });
      }
    }
    return Array.from(map.values());
  }, [entries]);

  if (grouped.length < 2) return null;

  const totalQty = grouped.reduce((s, e) => s + e.quantity, 0);
  const totalValue = grouped.reduce((s, e) => s + e.marketValue, 0);

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Cross-Account Exposure</Text>
        <Text style={styles.subtitle}>{symbol} held in {grouped.length} accounts</Text>
      </View>

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <View style={styles.totalRight}>
          <Text style={styles.totalQty}>{totalQty.toFixed(4)} sh</Text>
          <Text style={styles.totalValue}>{formatCurrency(totalValue)}</Text>
        </View>
      </View>

      {grouped.map((entry, i) => (
        <View key={entry.accountId} style={[styles.entryRow, i < grouped.length - 1 && styles.entryBorder]}>
          <Text style={styles.accountName} numberOfLines={1}>{entry.accountName}</Text>
          <View style={styles.entryRight}>
            <Text style={styles.entryQty}>{entry.quantity.toFixed(4)} sh</Text>
            <Text style={styles.entryValue}>{formatCurrency(entry.marketValue)}</Text>
          </View>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 0,
    paddingVertical: 12,
  },
  header: {
    paddingHorizontal: 16,
    marginBottom: 10,
    gap: 2,
  },
  title: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.separator + '80',
    marginBottom: 4,
  },
  totalLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.textSecondary,
  },
  totalRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  totalQty: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: colors.textMuted,
  },
  totalValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: colors.textPrimary,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  entryBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.separator + '80',
  },
  accountName: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
    flex: 1,
    marginRight: 12,
  },
  entryRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  entryQty: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
  },
  entryValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.textPrimary,
  },
});
