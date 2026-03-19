import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@/constants/colors';

const typeConfig = {
  long_term: { label: 'Long Term', color: colors.longTerm, bg: 'rgba(124,77,255,0.15)' },
  swing: { label: 'Swing', color: colors.swing, bg: 'rgba(255,152,0,0.15)' },
  day_trading: { label: 'Day Trading', color: colors.dayTrading, bg: 'rgba(245,0,87,0.15)' },
  savings: { label: 'Savings', color: colors.savings, bg: 'rgba(0,191,165,0.15)' },
};

interface Props {
  type: keyof typeof typeConfig;
  size?: 'sm' | 'md';
}

export function AccountTypeBadge({ type, size = 'md' }: Props) {
  const config = typeConfig[type] || typeConfig.savings;
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }, size === 'sm' && styles.sm]}>
      <Text style={[styles.text, { color: config.color }, size === 'sm' && styles.smText]}>
        {config.label}
      </Text>
    </View>
  );
}

export function getAccountTypeColor(type: string): string {
  return typeConfig[type as keyof typeof typeConfig]?.color || colors.neutral;
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  text: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  sm: {
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  smText: {
    fontSize: 10,
  },
});
