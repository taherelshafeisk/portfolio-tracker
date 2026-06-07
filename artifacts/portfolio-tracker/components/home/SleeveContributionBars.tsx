import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { router } from 'expo-router';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { sleeveDisplayName, fmtSigned, fmtPct } from '@/lib/formatters';
import type { PulseContribution } from '@/lib/types/pulse';

// ─── Aggregation (shared between variants) ──────────────────────────────────

interface SleeveRow {
  key: string;
  name: string;
  dayChange: number;
  dayPct: number;
}

function useSleeveAggregation(contributions: PulseContribution[]): SleeveRow[] {
  return useMemo(() => {
    const map = new Map<string, { dayChange: number; nav: number }>();
    for (const c of contributions) {
      const key = c.positionBucket || '';
      const existing = map.get(key);
      if (existing) {
        existing.dayChange += c.dayChangeDollars;
        existing.nav += c.marketValue;
      } else {
        map.set(key, { dayChange: c.dayChangeDollars, nav: c.marketValue });
      }
    }
    return Array.from(map.entries())
      .map(([key, { dayChange, nav }]) => ({
        key,
        name: sleeveDisplayName(key),
        dayChange,
        dayPct: nav > 0 ? (dayChange / nav) * 100 : 0,
      }))
      .sort((a, b) => Math.abs(b.dayChange) - Math.abs(a.dayChange));
  }, [contributions]);
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  contributions: PulseContribution[];
  /**
   * 'centered' — Home screen style: center tick, pos/neg halves, $ only.
   * 'left'     — Pulse screen style: left-aligned bar, % + $ columns.
   */
  variant: 'centered' | 'left';
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SleeveContributionBars({ contributions, variant }: Props) {
  const sleeves = useSleeveAggregation(contributions);
  if (sleeves.length === 0) return null;

  const maxAbs = Math.max(...sleeves.map(s => Math.abs(s.dayChange)), 1);

  return (
    <View style={styles.card}>
      {variant === 'centered' ? (
        <View style={styles.headerRow}>
          <Text style={styles.eyebrow}>CONTRIBUTION BY SLEEVE</Text>
          <Text style={styles.eyebrow}>$ TODAY</Text>
        </View>
      ) : (
        <Text style={styles.eyebrow}>BY SLEEVE</Text>
      )}

      {sleeves.map((sleeve, i) => {
        const isZero = sleeve.dayChange === 0;
        const isPos = sleeve.dayChange >= 0;
        const frac = Math.abs(sleeve.dayChange) / maxAbs;
        const barColor = isPos ? colors.positive : colors.negative;
        const barBg = isPos ? colors.positiveLight : colors.negativeLight;
        const positions = contributions.filter(c => (c.positionBucket || '') === sleeve.key);

        return (
          <Pressable
            key={sleeve.name}
            style={[styles.row, i > 0 && styles.rowBorder]}
            onPress={() =>
              router.push({
                pathname: '/sleeve-breakdown',
                params: { sleeve: sleeve.name, data: JSON.stringify(positions) },
              })
            }
          >
            <Text style={styles.label} numberOfLines={1}>{sleeve.name}</Text>

            {variant === 'centered' ? (
              /* Center-tick layout: left half (neg) | tick | right half (pos) */
              <View style={centeredStyles.track}>
                <View style={centeredStyles.halfLeft}>
                  {!isPos && !isZero && (
                    <View style={[centeredStyles.barNeg, { width: `${Math.round(frac * 100)}%` as any }]} />
                  )}
                </View>
                <View style={centeredStyles.tick} />
                <View style={centeredStyles.halfRight}>
                  {isPos && (
                    <View style={[centeredStyles.barPos, { width: `${Math.round(frac * 100)}%` as any }]} />
                  )}
                </View>
              </View>
            ) : (
              /* Left-aligned bar */
              <View style={leftStyles.track}>
                <View
                  style={[
                    leftStyles.bar,
                    {
                      width: `${Math.round(frac * 100)}%`,
                      backgroundColor: barBg,
                      borderRightWidth: isPos ? 2 : 0,
                      borderLeftWidth: isPos ? 0 : 2,
                      borderColor: barColor,
                    },
                  ]}
                />
              </View>
            )}

            {variant === 'left' && (
              <Text style={[styles.mono58, { color: barColor }]}>{fmtPct(sleeve.dayPct)}</Text>
            )}

            <Text
              style={[
                styles.mono60,
                isZero ? styles.muted : { color: barColor },
              ]}
            >
              {isZero ? '—' : fmtSigned(sleeve.dayChange)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Shared styles ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 22,
    marginTop: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.hair2,
    borderRadius: 2,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  eyebrow: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.ink3,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.hair },
  label: { fontFamily: fonts.sans, fontSize: 12, color: colors.ink2, width: 90 },
  mono58: { fontFamily: fonts.mono, fontSize: 11, fontVariant: ['tabular-nums'], width: 58, textAlign: 'right' },
  mono60: { fontFamily: fonts.mono, fontSize: 11, fontVariant: ['tabular-nums'], width: 60, textAlign: 'right' },
  muted: { color: colors.ink3 },
});

// Centered variant (Home)
const centeredStyles = StyleSheet.create({
  track: { flex: 1, height: 12, flexDirection: 'row', alignItems: 'center' },
  halfLeft: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  halfRight: { flex: 1, flexDirection: 'row', justifyContent: 'flex-start' },
  tick: { width: 1, height: 12, backgroundColor: colors.hair2 },
  barNeg: {
    height: 12,
    backgroundColor: colors.negativeLight,
    borderLeftWidth: 2,
    borderLeftColor: colors.negative,
    borderRadius: 1,
  },
  barPos: {
    height: 12,
    backgroundColor: colors.positiveLight,
    borderRightWidth: 2,
    borderRightColor: colors.positive,
    borderRadius: 1,
  },
});

// Left-aligned variant (Pulse)
const leftStyles = StyleSheet.create({
  track: {
    flex: 1,
    height: 12,
    backgroundColor: colors.bgInset,
    borderRadius: 1,
    overflow: 'hidden',
  },
  bar: { height: '100%', borderRadius: 1 },
});
