/**
 * components/account/ActionableNowSection.tsx
 *
 * Displays violations-only actions for a single sleeve.
 * Items come from computeActions() filtered to this account — violations only
 * (concentration / leverage). No movers, no risers, no neutral items.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import type { Action } from '@/lib/actions';

interface Props {
  actions: Action[];
  onPressItem: (action: Action) => void;
}

export function ActionableNowSection({ actions, onPressItem }: Props) {
  const filtered = actions.filter(a => a.type !== 'drawdown');
  if (filtered.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>NEEDS ATTENTION</Text>
      </View>

      {filtered.map((action, i) => {
        const isBreach = action.category === 'hard_rule';
        const barColor = isBreach ? colors.negative : colors.amber;
        const typeLabel =
          action.type === 'concentration' ? 'CONCENTRATION' : 'LEVERAGE';

        return (
          <Pressable
            key={action.id}
            style={[styles.item, i > 0 && styles.itemBorder]}
            onPress={() => onPressItem(action)}
          >
            <View style={[styles.severityBar, { backgroundColor: barColor }]} />
            <View style={styles.itemContent}>
              <Text style={[styles.typeLabel, { color: barColor }]}>{typeLabel}</Text>
              <Text style={styles.itemTitle} numberOfLines={2}>{action.label}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.hair2,
    borderRadius: 2,
    marginBottom: 16,
    overflow: 'hidden',
  },
  header: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  eyebrow: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingRight: 14,
  },
  itemBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.hair,
  },
  severityBar: {
    width: 3,
    borderRadius: 2,
    alignSelf: 'stretch',
    minHeight: 28,
    marginHorizontal: 12,
  },
  itemContent: {
    flex: 1,
    gap: 2,
  },
  typeLabel: {
    fontFamily: fonts.mono,
    fontSize: 8,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  itemTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.ink,
    lineHeight: 16,
  },
  chevron: {
    fontSize: 18,
    color: colors.ink3,
    paddingLeft: 8,
  },
});
