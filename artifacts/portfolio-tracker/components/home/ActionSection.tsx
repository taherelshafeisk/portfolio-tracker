import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { Card } from '@/components/ui/Card';

export interface ActionItem {
  id: string;
  title: string;
  description: string;
  urgency: 'low' | 'medium' | 'high';
  cta: string;
  onPress?: () => void;
}

const URGENCY_COLOR: Record<ActionItem['urgency'], string> = {
  low: colors.textMuted,
  medium: '#F5A623',
  high: colors.negative,
};

const MAX_VISIBLE = 3;

interface Props {
  items: ActionItem[];
}

export function ActionSection({ items }: Props) {
  if (items.length === 0) return null;

  const shown = items.slice(0, MAX_VISIBLE);
  const overflow = items.length - MAX_VISIBLE;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Action Needed</Text>
      <Card style={styles.card}>
        {shown.map((item, i) => (
          <Pressable
            key={item.id}
            style={[styles.row, i > 0 && styles.rowBorder]}
            onPress={item.onPress}
          >
            <View style={[styles.urgencyBar, { backgroundColor: URGENCY_COLOR[item.urgency] }]} />
            <View style={styles.content}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.desc} numberOfLines={1}>{item.description}</Text>
            </View>
            <View style={styles.ctaBlock}>
              <Text style={styles.ctaText}>{item.cta}</Text>
              <Feather name="chevron-right" size={14} color={colors.primary} />
            </View>
          </Pressable>
        ))}
        {overflow > 0 && (
          <View style={styles.overflowRow}>
            <Text style={styles.overflowText}>
              +{overflow} more action{overflow === 1 ? '' : 's'}
            </Text>
          </View>
        )}
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
    paddingVertical: 13,
    paddingRight: 14,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.separator,
  },
  urgencyBar: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 2,
    marginHorizontal: 12,
  },
  content: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: colors.textPrimary,
  },
  desc: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
  },
  ctaBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 8,
  },
  ctaText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: colors.primary,
  },
  overflowRow: {
    borderTopWidth: 1,
    borderTopColor: colors.separator,
    paddingVertical: 10,
    alignItems: 'center',
  },
  overflowText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
  },
});
