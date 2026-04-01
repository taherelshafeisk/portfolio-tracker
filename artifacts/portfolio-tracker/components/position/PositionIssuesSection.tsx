import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { SuggestionCard } from '@/components/home/SuggestionCard';
import type { OrderSuggestion } from '@/components/home/OrderSuggestionsPreview';

export interface PositionAlert {
  id: number;
  alertType: 'concentration' | 'drawdown' | 'leverage';
  severity: 'warning' | 'critical';
  title: string;
  message: string;
}

const ALERT_ICON: Record<PositionAlert['alertType'], React.ComponentProps<typeof Feather>['name']> = {
  concentration: 'pie-chart',
  drawdown: 'trending-down',
  leverage: 'bar-chart-2',
};

const SEVERITY_COLOR: Record<PositionAlert['severity'], string> = {
  warning: '#F5A623',
  critical: colors.negative,
};

function deriveActionSummary(alerts: PositionAlert[]): string {
  const types = new Set(alerts.map(a => a.alertType));
  const hasConcentration = types.has('concentration');
  const hasDrawdown = types.has('drawdown');
  if (hasConcentration && hasDrawdown) return 'Trim to reduce size and review the loss.';
  if (hasConcentration) return 'Trim position to reduce concentration.';
  if (hasDrawdown) return 'Review position — loss exceeds policy threshold.';
  return 'Review this position.';
}

function daysSince(dateStr: string): number {
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

interface Props {
  alerts: PositionAlert[];
  suggestions: OrderSuggestion[];
  isUpdating: boolean;
  onDismiss: (s: OrderSuggestion) => void;
  onExecuted: (s: OrderSuggestion) => void;
  /** ISO date string — triggers cut-list timer when set alongside a cut bucket/action */
  cutListAddedAt?: string;
  positionBucket?: string;
  ipsAction?: string;
}

export function PositionIssuesSection({ alerts, suggestions, isUpdating, onDismiss, onExecuted, cutListAddedAt, positionBucket, ipsAction }: Props) {
  const showCutTimer = cutListAddedAt != null
    && (positionBucket === 'cut' || ipsAction === 'cut' || ipsAction === 'exit');
  const cutDays = showCutTimer ? daysSince(cutListAddedAt!) : 0;
  const cutOverdue = cutDays > 5;

  const hasIssues = alerts.length > 0 || suggestions.length > 0 || showCutTimer;
  if (!hasIssues) return null;

  const worstSeverity = alerts.some(a => a.severity === 'critical') || cutOverdue ? 'critical'
    : alerts.length > 0 || showCutTimer ? 'warning'
    : null;
  const headerColor = worstSeverity === 'critical' ? colors.negative
    : worstSeverity === 'warning' ? '#F5A623'
    : colors.primary;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { borderBottomColor: `${headerColor}33` }]}>
        <Feather name="alert-circle" size={13} color={headerColor} />
        <Text style={[styles.headerText, { color: headerColor }]}>
          {alerts.length > 0 ? 'Issues' : 'Action'}
        </Text>
      </View>

      {/* Suggestions first */}
      {suggestions.length > 0 && (
        <View style={styles.suggestionsWrap}>
          {suggestions.map(s => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              isUpdating={isUpdating}
              onDismiss={() => onDismiss(s)}
              onExecuted={() => onExecuted(s)}
            />
          ))}
        </View>
      )}

      {/* Alert rows */}
      {alerts.map((alert, i) => {
        const color = SEVERITY_COLOR[alert.severity];
        return (
          <View
            key={alert.id}
            style={[
              styles.alertRow,
              i < alerts.length - 1 && !suggestions.length && styles.alertRowBorder,
            ]}
          >
            <View style={[styles.severityDot, { backgroundColor: color }]} />
            <Feather name={ALERT_ICON[alert.alertType]} size={13} color={color} style={styles.alertIcon} />
            <View style={styles.alertText}>
              <Text style={[styles.alertTitle, { color }]}>{alert.title}</Text>
              <Text style={styles.alertMessage} numberOfLines={2}>{alert.message}</Text>
            </View>
          </View>
        );
      })}

      {/* Cut-list timer */}
      {showCutTimer && (
        <View style={[styles.alertRow, (alerts.length > 0 || suggestions.length > 0) && styles.alertRowBorder]}>
          <View style={[styles.severityDot, { backgroundColor: cutOverdue ? colors.negative : '#F5A623' }]} />
          <Feather name="clock" size={13} color={cutOverdue ? colors.negative : '#F5A623'} style={styles.alertIcon} />
          <View style={styles.alertText}>
            <Text style={[styles.alertTitle, { color: cutOverdue ? colors.negative : '#F5A623' }]}>
              {cutOverdue ? `${cutDays} days on cut list — overdue` : `${cutDays} day${cutDays === 1 ? '' : 's'} on cut list`}
            </Text>
            <Text style={styles.alertMessage}>IPS rule: exit within 5 trading days</Text>
          </View>
        </View>
      )}

      {/* Action summary when no suggestion exists */}
      {suggestions.length === 0 && alerts.length > 0 && (
        <View style={styles.actionSummary}>
          <Text style={styles.actionSummaryText}>{deriveActionSummary(alerts)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.separator,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  headerText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  suggestionsWrap: {
    padding: 12,
    gap: 0,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
  },
  alertRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.separator + '80',
  },
  severityDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: 4,
  },
  alertIcon: {
    marginTop: 1,
  },
  alertText: {
    flex: 1,
    gap: 2,
  },
  alertTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  alertMessage: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  actionSummary: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.separator + '80',
  },
  actionSummaryText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
});
