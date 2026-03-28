import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { colors } from '@/constants/colors';
import { Card } from '@/components/ui/Card';
import { OrderSuggestion } from '@/components/home/OrderSuggestionsPreview';

export const ORDER_TYPE_LABEL: Record<OrderSuggestion['orderType'], string> = {
  market: 'Market',
  limit: 'Limit',
  stop: 'Stop',
  stop_limit: 'Stop Limit',
  laddered_limit: 'Laddered Limit',
};

export const URGENCY_COLOR: Record<OrderSuggestion['urgency'], string> = {
  low: colors.textMuted,
  medium: '#F5A623',
  high: colors.negative,
  critical: colors.negative,
};

export const URGENCY_LABEL: Record<OrderSuggestion['urgency'], string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const SIDE_COLOR: Record<OrderSuggestion['side'], string> = {
  buy: colors.positive,
  sell: colors.negative,
};

export interface SuggestionCardProps {
  suggestion: OrderSuggestion;
  isUpdating: boolean;
  onDismiss: () => void;
  onExecuted: () => void;
}

export function SuggestionCard({ suggestion: s, isUpdating, onDismiss, onExecuted }: SuggestionCardProps) {
  const sideColor = SIDE_COLOR[s.side];
  const urgencyColor = URGENCY_COLOR[s.urgency];

  return (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.sideBadge, { backgroundColor: `${sideColor}22` }]}>
          <Text style={[styles.sideText, { color: sideColor }]}>
            {s.side.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.symbol}>{s.symbol}</Text>
        <Text style={styles.orderType}>{ORDER_TYPE_LABEL[s.orderType]}</Text>
        <View style={styles.urgencyPill}>
          <View style={[styles.urgencyDot, { backgroundColor: urgencyColor }]} />
          <Text style={[styles.urgencyText, { color: urgencyColor }]}>
            {URGENCY_LABEL[s.urgency]}
          </Text>
        </View>
      </View>

      <Text style={styles.accountName}>{s.accountName}</Text>

      <Text style={styles.rationale}>{s.rationale}</Text>

      {(s.quantity != null || s.limitPrice != null || s.stopPrice != null) && (
        <View style={styles.priceRow}>
          {s.quantity != null && (
            <PriceChip label="Qty" value={s.quantity.toFixed(4)} />
          )}
          {s.limitPrice != null && (
            <PriceChip label="Limit" value={`$${s.limitPrice.toFixed(2)}`} />
          )}
          {s.stopPrice != null && (
            <PriceChip label="Stop" value={`$${s.stopPrice.toFixed(2)}`} />
          )}
        </View>
      )}

      {s.executionNotes && (
        <Text style={styles.executionNotes}>{s.executionNotes}</Text>
      )}

      <View style={styles.actions}>
        <Pressable
          style={[styles.actionBtn, styles.dismissBtn]}
          onPress={onDismiss}
          disabled={isUpdating}
        >
          <Text style={styles.dismissText}>Dismiss</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.executeBtn]}
          onPress={onExecuted}
          disabled={isUpdating}
        >
          {isUpdating
            ? <ActivityIndicator size={14} color={colors.background} />
            : <Text style={styles.executeText}>Mark Executed</Text>
          }
        </Pressable>
      </View>
    </Card>
  );
}

function PriceChip({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.priceChip}>
      <Text style={styles.priceChipLabel}>{label}</Text>
      <Text style={styles.priceChipValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 12,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
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
  symbol: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: colors.textPrimary,
  },
  orderType: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textMuted,
    flex: 1,
  },
  urgencyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  urgencyDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  urgencyText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  accountName: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
  },
  rationale: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  priceRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  priceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  priceChipLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: colors.textMuted,
  },
  priceChipValue: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    color: colors.textPrimary,
  },
  executionNotes: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
    lineHeight: 17,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
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
    fontSize: 13,
    color: colors.textSecondary,
  },
  executeBtn: {
    backgroundColor: colors.primary,
  },
  executeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.background,
  },
});
