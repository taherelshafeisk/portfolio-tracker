import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@/constants/colors';
import { Card } from '@/components/ui/Card';

export interface OrderSuggestion {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  orderType: 'Market' | 'Limit' | 'Stop' | 'Stop Limit' | 'Laddered Limit';
  urgency: 'low' | 'medium' | 'high' | 'critical';
  rationale: string;
  sleeve: string;
}

const SIDE_COLOR: Record<OrderSuggestion['side'], string> = {
  buy: colors.positive,
  sell: colors.negative,
};

const URGENCY_COLOR: Record<OrderSuggestion['urgency'], string> = {
  low: colors.textMuted,
  medium: '#F5A623',
  high: colors.negative,
  critical: colors.negative,
};

const MAX_VISIBLE = 2;

interface Props {
  suggestions: OrderSuggestion[];
}

export function OrderSuggestionsPreview({ suggestions }: Props) {
  if (suggestions.length === 0) return null;

  const shown = suggestions.slice(0, MAX_VISIBLE);
  const overflow = suggestions.length - MAX_VISIBLE;

  return (
    <View style={styles.section}>
      <View style={styles.titleRow}>
        <Text style={styles.sectionTitle}>Suggested Orders</Text>
        {overflow > 0 && (
          <Text style={styles.viewAll}>View all {suggestions.length}</Text>
        )}
      </View>
      <Card style={styles.card}>
        {shown.map((s, i) => {
          const sideColor = SIDE_COLOR[s.side];
          const urgencyColor = URGENCY_COLOR[s.urgency];
          return (
            <View key={s.id} style={[styles.row, i > 0 && styles.rowBorder]}>
              <View style={[styles.sideBadge, { backgroundColor: `${sideColor}22` }]}>
                <Text style={[styles.sideText, { color: sideColor }]}>
                  {s.side.toUpperCase()}
                </Text>
              </View>
              <View style={styles.content}>
                <View style={styles.topLine}>
                  <Text style={styles.symbol}>{s.symbol}</Text>
                  <Text style={styles.orderType}>{s.orderType}</Text>
                </View>
                <Text style={styles.rationale} numberOfLines={1}>{s.rationale}</Text>
                <Text style={styles.sleeve}>{s.sleeve}</Text>
              </View>
              <View style={[styles.urgencyDot, { backgroundColor: urgencyColor }]} />
            </View>
          );
        })}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: colors.textPrimary,
  },
  viewAll: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: colors.primary,
  },
  card: {
    padding: 0,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  sideBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 44,
    alignItems: 'center',
  },
  sideText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
  },
  content: {
    flex: 1,
    gap: 2,
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  symbol: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
    color: colors.textPrimary,
  },
  orderType: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
  },
  rationale: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textSecondary,
  },
  sleeve: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: colors.textMuted,
  },
  urgencyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
