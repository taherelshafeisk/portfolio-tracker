/**
 * components/account/ActionableNowSection.tsx
 *
 * Displays violations-only actions for a single sleeve.
 * Items come from computeActions() filtered to this account — violations only
 * (concentration / drawdown / leverage). No movers, no risers, no neutral items.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import type { Action } from '@/lib/actions';

interface Props {
  actions: Action[];
  onPressItem: (action: Action) => void;
}

export function ActionableNowSection({ actions, onPressItem }: Props) {
  if (actions.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Feather name="zap" size={13} color={colors.primary} />
        <Text style={styles.headerText}>Actionable Now</Text>
      </View>

      {actions.map(action => {
        const barColor = action.severity === 'red' ? colors.negative : '#F59E0B';
        const typeLabel =
          action.type === 'concentration'
            ? 'Concentration'
            : action.type === 'drawdown'
            ? 'Drawdown'
            : 'Leverage';

        return (
          <Pressable
            key={action.id}
            style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            onPress={() => onPressItem(action)}
          >
            <View style={[styles.severityBar, { backgroundColor: barColor }]} />
            <View style={styles.itemContent}>
              <Text style={styles.itemTitle} numberOfLines={2}>
                {action.label}
              </Text>
              <View style={styles.typeChip}>
                <Text style={[styles.typeLabel, { color: barColor }]}>{typeLabel}</Text>
              </View>
            </View>
            <Feather name="chevron-right" size={14} color={colors.textMuted} />
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
    paddingVertical: 12,
    paddingRight: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator + '80',
  },
  pressed: { backgroundColor: colors.surfaceElevated },
  severityBar: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 2,
    marginHorizontal: 12,
    minHeight: 36,
  },
  itemContent: {
    flex: 1,
    gap: 4,
  },
  itemTitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 18,
  },
  typeChip: {
    alignSelf: 'flex-start',
  },
  typeLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
});
