import React from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { colors } from '@/constants/colors';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';

export interface OrderSuggestion {
  id: number;
  accountId: number;
  accountName: string;
  symbol: string;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit' | 'stop' | 'stop_limit' | 'laddered_limit';
  urgency: 'low' | 'medium' | 'high' | 'critical';
  rationale: string;
  trigger: string;
  status: 'pending' | 'dismissed' | 'executed';
  quantity?: number | null;
  limitPrice?: number | null;
  stopPrice?: number | null;
  executionNotes?: string | null;
}

const ORDER_TYPE_LABEL: Record<OrderSuggestion['orderType'], string> = {
  market: 'Market',
  limit: 'Limit',
  stop: 'Stop',
  stop_limit: 'Stop Limit',
  laddered_limit: 'Laddered Limit',
};

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
  isLoading: boolean;
  isGenerating: boolean;
  onGenerate: () => void;
  onViewAll?: () => void;
}

export function OrderSuggestionsPreview({ suggestions, isLoading, isGenerating, onGenerate, onViewAll }: Props) {
  const busy = isLoading || isGenerating;
  const shown = suggestions.slice(0, MAX_VISIBLE);
  const overflow = suggestions.length - MAX_VISIBLE;

  return (
    <View style={styles.section}>
      <View style={styles.titleRow}>
        <Pressable onPress={onViewAll} disabled={!onViewAll} style={styles.titlePressable}>
          <Text style={styles.sectionTitle}>Suggested Orders</Text>
        </Pressable>
        <Pressable
          onPress={onGenerate}
          disabled={busy}
          style={({ pressed }) => [styles.generateBtn, busy && styles.generateBtnDisabled, pressed && styles.generateBtnPressed]}
        >
          {isGenerating
            ? <ActivityIndicator size={12} color={colors.primary} />
            : <Text style={[styles.generateBtnText, busy && styles.generateBtnTextDisabled]}>Generate</Text>
          }
        </Pressable>
      </View>

      {isLoading ? (
        <Card style={styles.card}>
          <View style={styles.skeletonRow}>
            <Skeleton height={36} width={44} style={{ borderRadius: 6 }} />
            <View style={{ flex: 1, gap: 6 }}>
              <Skeleton height={12} width={80} />
              <Skeleton height={10} width={160} />
              <Skeleton height={10} width={60} />
            </View>
          </View>
          <View style={[styles.skeletonRow, styles.rowBorder]}>
            <Skeleton height={36} width={44} style={{ borderRadius: 6 }} />
            <View style={{ flex: 1, gap: 6 }}>
              <Skeleton height={12} width={80} />
              <Skeleton height={10} width={140} />
              <Skeleton height={10} width={60} />
            </View>
          </View>
        </Card>
      ) : suggestions.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text style={styles.emptyText}>No pending suggestions.</Text>
          <Text style={styles.emptyHint}>Tap Generate to analyse your portfolio.</Text>
        </Card>
      ) : (
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
                    <Text style={styles.orderType}>{ORDER_TYPE_LABEL[s.orderType]}</Text>
                  </View>
                  <Text style={styles.rationale} numberOfLines={1}>{s.rationale}</Text>
                  <Text style={styles.sleeve}>{s.accountName}</Text>
                </View>
                <View style={[styles.urgencyDot, { backgroundColor: urgencyColor }]} />
              </View>
            );
          })}
          {overflow > 0 && (
            <Pressable
              style={[styles.overflowRow, styles.rowBorder]}
              onPress={onViewAll}
              disabled={!onViewAll}
            >
              <Text style={styles.overflowText}>+{overflow} more suggestion{overflow > 1 ? 's' : ''}</Text>
            </Pressable>
          )}
        </Card>
      )}
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
  titlePressable: {
    flex: 1,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: colors.textPrimary,
  },
  generateBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: `${colors.primary}22`,
    minWidth: 72,
    alignItems: 'center',
  },
  generateBtnDisabled: {
    opacity: 0.5,
  },
  generateBtnPressed: {
    opacity: 0.7,
  },
  generateBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: colors.primary,
  },
  generateBtnTextDisabled: {
    color: colors.textMuted,
  },
  card: {
    padding: 0,
    overflow: 'hidden',
  },
  emptyCard: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 4,
  },
  emptyText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.textSecondary,
  },
  emptyHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
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
  overflowRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
  },
  overflowText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
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
