import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';

export interface DashboardAlert {
  id: string;
  /**
   * DB primary key(s) — present on API-sourced alerts, absent on client-computed ones.
   * A collapsed summary carries the dbIds of every alert it represents so all can be
   * acknowledged in one tap.
   */
  dbIds?: number[];
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
  /**
   * Called when the user acknowledges alert(s). Receives all dbIds represented by
   * the tapped chip — a collapsed summary passes multiple ids at once.
   * Only rendered when the chip has dbIds (i.e. alerts came from the API).
   */
  onAcknowledge?: (dbIds: number[]) => void;
  /**
   * When true, alerts are client-computed fallback (no API data yet).
   * Renders a small "Scan alerts" button so the user can trigger generation.
   */
  isFallback?: boolean;
  onScan?: () => void;
}

export function AlertSection({ alerts, onAcknowledge, isFallback, onScan }: Props) {
  if (alerts.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.titleRow}>
        <Text style={styles.sectionTitle}>Alerts</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{alerts.length}</Text>
        </View>
        {isFallback && onScan && (
          <Pressable style={styles.scanBtn} onPress={onScan}>
            <Feather name="refresh-cw" size={11} color={colors.textMuted} />
            <Text style={styles.scanText}>Scan</Text>
          </Pressable>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {alerts.map(alert => {
          const color = SEVERITY_COLOR[alert.severity];
          const canDismiss = (alert.dbIds?.length ?? 0) > 0 && onAcknowledge != null;
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
              {canDismiss && (
                <>
                  <View style={[styles.chipSeparator, { backgroundColor: `${color}44` }]} />
                  <Pressable
                    style={styles.chipDismiss}
                    onPress={() => onAcknowledge(alert.dbIds!)}
                    hitSlop={8}
                    accessibilityLabel="Dismiss alert"
                  >
                    <Feather name="x" size={12} color={colors.textSecondary} />
                  </Pressable>
                </>
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
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surfaceElevated,
  },
  scanText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: colors.textMuted,
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
  chipSeparator: {
    width: 1,
    alignSelf: 'stretch',
  },
  chipDismiss: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    maxWidth: 180,
  },
});
