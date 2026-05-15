/**
 * components/account/ActionableNowSection.tsx
 *
 * Displays violations-only actions for a single sleeve.
 * Items come from computeActions() filtered to this account — violations only
 * (concentration / leverage). No movers, no risers, no neutral items.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import type { Action } from '@/lib/actions';
import { AlertRow } from '@/components/AlertRow';
import type { AlertSeverity } from '@/components/AlertRow';

interface Props {
  actions: Action[];
  onPressItem: (action: Action) => void;
}

function actionSeverity(action: Action): AlertSeverity {
  if (action.type === 'leverage') return 'alert';
  if (action.type === 'concentration') return 'warning';
  return 'info';
}

export function ActionableNowSection({ actions, onPressItem }: Props) {
  const filtered = actions.filter(a => a.type !== 'drawdown');
  if (filtered.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>INSIGHTS</Text>
      </View>

      {filtered.map((action, i) => (
        <View key={action.id} style={i > 0 ? styles.itemBorder : undefined}>
          <AlertRow
            severity={actionSeverity(action)}
            title={action.label}
            onPress={() => onPressItem(action)}
          />
        </View>
      ))}
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
  itemBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.hair,
  },
});
