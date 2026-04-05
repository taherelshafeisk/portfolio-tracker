import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';

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
        {value >= 0 ? '+' : ''}{value.toFixed(2)}
        {percentage !== undefined && ` (${percentage >= 0 ? '+' : ''}${percentage.toFixed(2)}%)`}
      </Text>
    </View>
  );
}

export function formatPnl(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${value >= 0 ? '+' : '-'}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${value >= 0 ? '+' : '-'}$${(abs / 1_000).toFixed(2)}K`;
  return `${value >= 0 ? '+' : '-'}$${abs.toFixed(2)}`;
}

function withCommas(n: number, dec = 2): string {
  const [int, frac] = n.toFixed(dec).split('.');
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac !== undefined ? '.' + frac : '');
}

/**
 * Format a dollar value.
 *
 * mode 'full'    (default) — $43,484.04, comma-separated, 2 decimal places.
 * mode 'compact'           — $43.5K / $1.2M, 1 decimal place with K/M suffix.
 */
export function formatCurrency(value: number, mode: 'full' | 'compact' = 'full'): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (mode === 'compact') {
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
    return `${sign}$${abs.toFixed(0)}`;
  }
  // 'full'
  if (abs >= 1_000_000) return `${sign}$${withCommas(abs / 1_000_000, 2)}M`;
  return `${sign}$${withCommas(abs, 2)}`;
}

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
