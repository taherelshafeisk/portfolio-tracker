import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { formatCurrency, fmtSigned, fmtPct } from '@/lib/formatters';
import type { PulseContribution } from '@/lib/types/pulse';

export default function SleeveBreakdownScreen() {
  const insets = useSafeAreaInsets();
  const { sleeve, data } = useLocalSearchParams<{ sleeve: string; data: string }>();

  const positions = useMemo<PulseContribution[]>(() => {
    try { return JSON.parse(data ?? '[]'); } catch { return []; }
  }, [data]);

  const sorted = useMemo(
    () => [...positions].sort((a, b) => Math.abs(b.dayChangeDollars) - Math.abs(a.dayChangeDollars)),
    [positions],
  );

  const totalChange = positions.reduce((s, p) => s + p.dayChangeDollars, 0);
  const isPos = totalChange >= 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>{sleeve}</Text>
        <Text style={[styles.total, { color: isPos ? colors.positive : colors.negative }]}>
          {fmtSigned(totalChange)} today
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {sorted.map((p, i) => {
          const pos = p.dayChangeDollars >= 0;
          return (
            <Pressable
              key={`${p.id}-${i}`}
              style={styles.row}
              onPress={() => router.push({ pathname: '/position/[ticker]', params: { ticker: p.ticker, accountId: String(p.accountId) } })}
            >
              <View style={styles.rowLeft}>
                <Text style={styles.ticker}>{p.ticker}</Text>
                <Text style={styles.posName} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.account}>{p.accountName}</Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={[styles.dayChange, { color: pos ? colors.positive : colors.negative }]}>
                  {fmtSigned(p.dayChangeDollars)}
                </Text>
                <Text style={[styles.dayChangePct, { color: pos ? colors.positive : colors.negative }]}>
                  {(p.dayChangePct >= 0 ? '+' : '')}{p.dayChangePct.toFixed(2)}%
                </Text>
                <Text style={styles.marketValue}>{formatCurrency(p.marketValue)}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: 22,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair2,
    gap: 4,
  },
  backBtn: { marginBottom: 8 },
  backText: { fontFamily: fonts.sans, fontSize: 15, color: colors.ink2 },
  title: { fontFamily: fonts.serifMedium, fontSize: 26, color: colors.ink },
  total: { fontFamily: fonts.sansMedium, fontSize: 15 },
  list: { paddingBottom: 40 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  rowLeft: { flex: 1, gap: 2, marginRight: 12 },
  ticker: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.ink },
  posName: { fontFamily: fonts.sans, fontSize: 13, color: colors.ink2 },
  account: { fontFamily: fonts.sans, fontSize: 11, color: colors.ink3 },
  rowRight: { alignItems: 'flex-end', gap: 2 },
  dayChange: { fontFamily: fonts.sansMedium, fontSize: 15 },
  dayChangePct: { fontFamily: fonts.sans, fontSize: 12 },
  marketValue: { fontFamily: fonts.mono, fontSize: 11, color: colors.ink3 },
});
