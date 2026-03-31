/**
 * components/account/ActionableNowSection.tsx
 *
 * Displays a short ranked list of positions that deserve attention first,
 * plus an account-level leverage item when applicable.
 *
 * Scoring (computed in parent, passed as pre-ranked items):
 *   policy critical: +15 pts
 *   policy warning:  +5 pts
 *   |dayChangePct|:  × 0.5 pts
 *   dailyDollar/nav: × 2 pts (daily dollar move as % of account NAV)
 *
 * Only items scoring ≥ 2 or with a policy breach are shown, capped at 5.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';

export interface ActionableItem {
  /** Unique key */
  id: string;
  /** Symbol or account-level label */
  title: string;
  score: number;
  reasons: Array<{ label: string; isNegative?: boolean }>;
  /** If set, tapping navigates to the position */
  positionId?: number;
}

interface ActionableNowSectionProps {
  items: ActionableItem[];
  /** If non-null, shows a leverage account-level item */
  leverageRatio: number | null;
  onPressItem: (item: ActionableItem) => void;
  onPressLeverage?: () => void;
}

export function ActionableNowSection({
  items,
  leverageRatio,
  onPressItem,
  onPressLeverage,
}: ActionableNowSectionProps) {
  const hasLeverage = leverageRatio !== null;
  if (items.length === 0 && !hasLeverage) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Feather name="zap" size={13} color={colors.primary} />
        <Text style={styles.headerText}>Actionable Now</Text>
      </View>

      {hasLeverage && (
        <Pressable
          style={({ pressed }) => [styles.item, pressed && styles.pressed]}
          onPress={onPressLeverage}
        >
          <View style={styles.itemLeft}>
            <Text style={styles.itemTitle}>Leverage active</Text>
            <View style={styles.reasons}>
              <View style={[styles.badge, styles.badgeCritical]}>
                <Text style={[styles.badgeText, { color: colors.negative }]}>
                  {leverageRatio!.toFixed(2)}x
                </Text>
              </View>
              <View style={[styles.badge, styles.badgeCritical]}>
                <Text style={[styles.badgeText, { color: colors.negative }]}>Margin</Text>
              </View>
            </View>
          </View>
          <Feather name="chevron-right" size={14} color={colors.textMuted} />
        </Pressable>
      )}

      {items.map(item => (
        <Pressable
          key={item.id}
          style={({ pressed }) => [styles.item, pressed && styles.pressed]}
          onPress={() => onPressItem(item)}
        >
          <View style={styles.itemLeft}>
            <Text style={styles.itemTitle}>{item.title}</Text>
            {item.reasons.length > 0 && (
              <View style={styles.reasons}>
                {item.reasons.map((r, i) => (
                  <View
                    key={i}
                    style={[styles.badge, r.isNegative ? styles.badgeCritical : styles.badgeNeutral]}
                  >
                    <Text style={[
                      styles.badgeText,
                      { color: r.isNegative ? colors.negative : colors.textSecondary },
                    ]}>
                      {r.label}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
          <Feather name="chevron-right" size={14} color={colors.textMuted} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.separator,
    marginBottom: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  headerText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.primary,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator + '80',
  },
  pressed: { backgroundColor: colors.surfaceElevated },
  itemLeft: { flex: 1, gap: 4 },
  itemTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: colors.textPrimary,
  },
  reasons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  badgeCritical: {
    backgroundColor: 'rgba(255,59,48,0.10)',
    borderColor: 'rgba(255,59,48,0.25)',
  },
  badgeNeutral: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.separator,
  },
  badgeText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
  },
});
