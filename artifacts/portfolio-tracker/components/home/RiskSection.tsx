import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@/constants/colors';
import { Card } from '@/components/ui/Card';

export interface RiskIndicator {
  id: string;
  label: string;
  value: string;
  severity: 'ok' | 'warning' | 'critical';
  detail?: string;
}

const SEVERITY_COLOR: Record<RiskIndicator['severity'], string> = {
  ok: colors.positive,
  warning: '#F5A623',
  critical: colors.negative,
};

interface Props {
  indicators: RiskIndicator[];
}

export function RiskSection({ indicators }: Props) {
  const flagged = indicators.filter(i => i.severity !== 'ok');
  if (flagged.length === 0) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Risk</Text>
      <Card style={styles.card}>
        {flagged.map((item, i) => {
          const color = SEVERITY_COLOR[item.severity];
          return (
            <View key={item.id} style={[styles.row, i > 0 && styles.rowBorder]}>
              <View style={styles.left}>
                <View style={[styles.dot, { backgroundColor: color }]} />
                <View style={styles.textBlock}>
                  <Text style={styles.label}>{item.label}</Text>
                  {item.detail ? (
                    <Text style={styles.detail}>{item.detail}</Text>
                  ) : null}
                </View>
              </View>
              <Text style={[styles.value, { color }]}>{item.value}</Text>
            </View>
          );
        })}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: 12,
  },
  card: {
    padding: 0,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  textBlock: {
    flex: 1,
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: colors.textPrimary,
  },
  detail: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 1,
  },
  value: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },
});
