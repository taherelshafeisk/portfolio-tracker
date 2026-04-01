import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '@/constants/colors';
import { Card } from '@/components/ui/Card';
import { formatCurrency } from '@/components/ui/PnlBadge';

interface TriggerRow {
  label: string;
  currentPct: number;
  warnPct: number;
  critPct: number;
  /** true when lower is worse (drawdown), false when higher is worse (concentration) */
  lowerIsWorse: boolean;
}

function rowSeverityColor(row: TriggerRow): string {
  const c = row.currentPct;
  if (row.lowerIsWorse) {
    if (c <= row.critPct) return colors.negative;
    if (c <= row.warnPct) return '#F5A623';
  } else {
    if (c >= row.critPct) return colors.negative;
    if (c >= row.warnPct) return '#F5A623';
  }
  return colors.textSecondary;
}

function fmtPct(n: number, decimals = 1): string {
  return `${n >= 0 ? '' : ''}${n.toFixed(decimals)}%`;
}

interface Props {
  /** position.marketValue / accountNAV × 100 */
  concentrationPct: number;
  /** position.unrealizedPnlPct (e.g. −18.5 for −18.5%) */
  drawdownPct: number;
  /** policy thresholds as percentages (e.g. 20, 30) */
  concWarnPct: number;
  concCritPct: number;
  /** policy thresholds as percentages (e.g. −15, −25) */
  ddWarnPct: number;
  ddCritPct: number;
  /** IPS stop price — shows stop row when set */
  stopPrice?: number;
  /** current market price — used to colour stop row */
  currentPrice?: number;
  /** IPS action — addZone row only shown when 'add' */
  ipsAction?: string;
  addZoneLow?: number;
  addZoneHigh?: number;
}

export function TriggerLevelsCard({
  concentrationPct,
  drawdownPct,
  concWarnPct,
  concCritPct,
  ddWarnPct,
  ddCritPct,
  stopPrice,
  currentPrice,
  ipsAction,
  addZoneLow,
  addZoneHigh,
}: Props) {
  const pctRows: TriggerRow[] = [
    {
      label: 'Concentration',
      currentPct: concentrationPct,
      warnPct: concWarnPct,
      critPct: concCritPct,
      lowerIsWorse: false,
    },
    {
      label: 'Drawdown',
      currentPct: drawdownPct,
      warnPct: ddWarnPct,
      critPct: ddCritPct,
      lowerIsWorse: true,
    },
  ];

  const showStop = stopPrice != null;
  const stopBreached = showStop && currentPrice != null && currentPrice <= stopPrice;
  const stopNear = showStop && currentPrice != null && !stopBreached && currentPrice <= stopPrice * 1.05;
  const stopColor = stopBreached ? colors.negative : stopNear ? '#F5A623' : colors.textSecondary;

  const showAddZone = ipsAction === 'add' && (addZoneLow != null || addZoneHigh != null);
  const inZone = showAddZone && currentPrice != null
    && (addZoneLow == null || currentPrice >= addZoneLow)
    && (addZoneHigh == null || currentPrice <= addZoneHigh);

  return (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>Trigger Levels</Text>
      {pctRows.map((row, i) => {
        const currentColor = rowSeverityColor(row);
        return (
          <View key={row.label} style={[styles.row, i > 0 && styles.rowBorder]}>
            <Text style={styles.rowLabel}>{row.label}</Text>
            <View style={styles.rowRight}>
              <Text style={[styles.currentValue, { color: currentColor }]}>
                {fmtPct(row.currentPct)}
              </Text>
              <View style={styles.thresholds}>
                <View style={styles.threshold}>
                  <View style={[styles.thresholdDot, { backgroundColor: '#F5A623' }]} />
                  <Text style={styles.thresholdText}>{fmtPct(row.warnPct, 0)}</Text>
                </View>
                <View style={styles.threshold}>
                  <View style={[styles.thresholdDot, { backgroundColor: colors.negative }]} />
                  <Text style={styles.thresholdText}>{fmtPct(row.critPct, 0)}</Text>
                </View>
              </View>
            </View>
          </View>
        );
      })}

      {showStop && (
        <View style={[styles.row, styles.rowBorder]}>
          <Text style={styles.rowLabel}>Stop</Text>
          <View style={styles.rowRight}>
            <Text style={[styles.currentValue, { color: stopColor }]}>
              {currentPrice != null ? formatCurrency(currentPrice) : '—'}
            </Text>
            <View style={styles.thresholds}>
              <View style={styles.threshold}>
                <View style={[styles.thresholdDot, { backgroundColor: colors.negative }]} />
                <Text style={styles.thresholdText}>{formatCurrency(stopPrice)}</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {showAddZone && (
        <View style={[styles.row, styles.rowBorder]}>
          <Text style={styles.rowLabel}>Add Zone</Text>
          <View style={styles.rowRight}>
            <Text style={[styles.currentValue, { color: inZone ? '#2DC5A2' : colors.textSecondary }]}>
              {currentPrice != null ? formatCurrency(currentPrice) : '—'}
            </Text>
            <View style={styles.thresholds}>
              <View style={styles.threshold}>
                <View style={[styles.thresholdDot, { backgroundColor: '#2DC5A2' }]} />
                <Text style={styles.thresholdText}>
                  {addZoneLow != null ? formatCurrency(addZoneLow) : '—'}
                  {addZoneLow != null && addZoneHigh != null ? '–' : ''}
                  {addZoneHigh != null ? formatCurrency(addZoneHigh) : ''}
                </Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 0,
    paddingVertical: 12,
  },
  cardTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
    paddingHorizontal: 16,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.separator + '80',
  },
  rowLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: colors.textSecondary,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  currentValue: {
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    minWidth: 52,
    textAlign: 'right',
  },
  thresholds: {
    flexDirection: 'row',
    gap: 8,
  },
  threshold: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  thresholdDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  thresholdText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: colors.textMuted,
  },
});
