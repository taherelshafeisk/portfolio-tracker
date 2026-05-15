import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';

export type AlertSeverity = 'info' | 'warning' | 'alert';

interface AlertRowProps {
  severity: AlertSeverity;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  onDismiss?: () => void;
}

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  info:    'ℹ️',
  warning: '⚠️',
  alert:   '🚨',
};

const SEVERITY_BAR_COLOR: Record<AlertSeverity, string> = {
  info:    colors.ink3,
  warning: colors.amber,
  alert:   colors.negative,
};

export function AlertRow({ severity, title, subtitle, onPress, onDismiss }: AlertRowProps) {
  const barColor = SEVERITY_BAR_COLOR[severity];

  return (
    <Pressable style={styles.row} onPress={onPress} disabled={!onPress}>
      <View style={[styles.bar, { backgroundColor: barColor }]} />
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {SEVERITY_EMOJI[severity]}{'  '}{title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {onDismiss && (
        <Pressable hitSlop={8} onPress={onDismiss} style={styles.dismiss}>
          <Text style={styles.dismissText}>×</Text>
        </Pressable>
      )}
      {onPress && !onDismiss && <Text style={styles.chevron}>›</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingRight: 14,
  },
  bar: {
    width: 3,
    borderRadius: 2,
    alignSelf: 'stretch',
    minHeight: 28,
    marginHorizontal: 12,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.ink,
    lineHeight: 16,
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.ink3,
  },
  chevron: {
    fontSize: 18,
    color: colors.ink3,
    paddingLeft: 8,
  },
  dismiss: { paddingLeft: 8 },
  dismissText: {
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.ink3,
  },
});
