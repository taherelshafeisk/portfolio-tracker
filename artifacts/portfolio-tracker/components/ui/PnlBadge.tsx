import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { formatCurrency } from '@/lib/formatters';


interface PnlBadgeProps {
  value: number;
  percentage?: number;
  showIcon?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function PnlBadge({ value, percentage, showIcon = true, size = 'md' }: PnlBadgeProps) {
  const isPositive = value >= 0;
  const color = isPositive ? colors.positive : colors.negative;
  const bgColor = isPositive ? colors.positiveLight : colors.negativeLight;
  const icon = isPositive ? 'trending-up' : 'trending-down';

  const fontSizes = { sm: 11, md: 13, lg: 16 };
  const iconSizes = { sm: 12, md: 14, lg: 16 };
  const paddings = { sm: { paddingVertical: 2, paddingHorizontal: 6 }, md: { paddingVertical: 4, paddingHorizontal: 8 }, lg: { paddingVertical: 6, paddingHorizontal: 12 } };

  return (
    <View style={[styles.container, { backgroundColor: bgColor }, paddings[size]]}>
      {showIcon && <Feather name={icon} size={iconSizes[size]} color={color} />}
      <Text style={[styles.text, { color, fontSize: fontSizes[size] }]}>
        {value >= 0 ? '+' : ''}{formatCurrency(value)}
        {percentage !== undefined && ` (${percentage >= 0 ? '+' : ''}${percentage.toFixed(2)}%)`}
      </Text>
    </View>
  );
}

// formatCurrency and formatPnl live in @/lib/formatters.

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    gap: 4,
  },
  text: {
    fontFamily: 'Inter_600SemiBold',
  },
});
