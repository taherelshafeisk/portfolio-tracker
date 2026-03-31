import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';

export interface DashboardAlert {
  id: string;
  /** DB primary key — present on API-sourced alerts, absent on client-computed ones */
  dbId?: number;
  type: 'concentration' | 'drawdown' | 'leverage' | 'manual';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  symbol?: string;
  positionId?: number;
  accountId?: number;
  onPress?: () => void;
}

const SEVERITY_COLOR: Record<DashboardAlert['severity'], string> = {
  info: colors.primary,
  warning: '#F5A623',
  critical: colors.negative,
};

const TYPE_ICON: Record<DashboardAlert['type'], React.ComponentProps<typeof Feather>['name']> = {
  concentration: 'pie-chart',
  drawdown: 'trending-down',
  leverage: 'bar-chart-2',
  manual: 'bell',
};

interface Props {
  alerts: DashboardAlert[];
  /** Called when the user acknowledges an API-sourced alert. Only shown when dbId is present. */
  onAcknowledge?: (dbId: number) => void;
}

export function AlertSection({ alerts, onAcknowledge }: Props) {
  if (alerts.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.titleRow}>
        <Text style={styles.sectionTitle}>Alerts</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{alerts.length}</Text>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {alerts.map(alert => {
          const color = SEVERITY_COLOR[alert.severity];
          return (
            <View
              key={alert.id}
              style={[
                styles.chip,
                { borderColor: `${color}44`, backgroundColor: `${color}11` },
              ]}
            >
              <Pressable
                style={styles.chipMain}
                onPress={alert.onPress}
              >
                <Feather name={TYPE_ICON[alert.type]} size={12} color={color} />
                <Text style={[styles.chipText, { color }]} numberOfLines={1}>
                  {alert.title}
                </Text>
              </Pressable>
              {alert.dbId != null && onAcknowledge && (
                <Pressable
                  style={styles.chipDismiss}
                  onPress={() => onAcknowledge(alert.dbId!)}
                  hitSlop={6}
                >
                  <Feather name="x" size={11} color={color} />
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 20,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: colors.textPrimary,
  },
  countBadge: {
    backgroundColor: colors.negative,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  countText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    color: colors.white,
  },
  scroll: {
    marginHorizontal: -4,
  },
  scrollContent: {
    paddingHorizontal: 4,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  chipMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipDismiss: {
    paddingRight: 10,
    paddingLeft: 2,
    paddingVertical: 8,
  },
  chipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    maxWidth: 180,
  },
});
