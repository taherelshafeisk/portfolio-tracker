import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  Pressable, Modal, TextInput, Alert, Platform, Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { usePortfolio, apiPost, apiPut, apiDelete, Account } from '@/context/PortfolioContext';
import { formatCurrency } from '@/components/ui/PnlBadge';

const DEFAULT_CONCENTRATION_LIMIT = 0.20;
const DEFAULT_LEVERAGE_CEILING = 1.50;

const ACCOUNT_TYPES = [
  { key: 'long_term', label: 'Long Term' },
  { key: 'swing', label: 'Swing Trading' },
  { key: 'day_trading', label: 'Day Trading' },
  { key: 'savings', label: 'Savings / Cash' },
];

// ─── Compliance ───────────────────────────────────────────────────────────────

type ComplianceSeverity = 'green' | 'amber' | 'red';

interface ComplianceIssue {
  label: string;
  severity: 'amber' | 'red';
}

function computeCompliance(
  account: Account,
  accountPositions: { symbol: string; marketValue: number }[],
  nav: number,
): { dot: ComplianceSeverity; issues: ComplianceIssue[] } {
  const issues: ComplianceIssue[] = [];
  const limit = account.concentrationLimit ?? DEFAULT_CONCENTRATION_LIMIT;
  const ceiling = account.leverageCeiling ?? DEFAULT_LEVERAGE_CEILING;

  if (nav > 0) {
    for (const p of accountPositions) {
      const fraction = p.marketValue / nav;
      if (fraction > 2 * limit) {
        issues.push({
          label: `${p.symbol} is ${(fraction * 100).toFixed(1)}% — over 2× the ${(limit * 100).toFixed(0)}% limit`,
          severity: 'red',
        });
      } else if (fraction > limit) {
        issues.push({
          label: `${p.symbol} is ${(fraction * 100).toFixed(1)}% — above the ${(limit * 100).toFixed(0)}% limit`,
          severity: 'amber',
        });
      }
    }
  }

  if (account.currentBalance < 0) {
    const borrowed = Math.abs(account.currentBalance);
    const leverageRatio = nav > 0 ? (nav + borrowed) / nav : 99;
    if (leverageRatio > ceiling) {
      issues.push({
        label: `Leverage ${leverageRatio.toFixed(2)}× exceeds ${ceiling.toFixed(1)}× ceiling`,
        severity: 'red',
      });
    } else {
      issues.push({
        label: `Leverage active — ${formatCurrency(borrowed)} borrowed, ${leverageRatio.toFixed(2)}×`,
        severity: 'amber',
      });
    }
  }

  const dot: ComplianceSeverity = issues.some(i => i.severity === 'red')
    ? 'red'
    : issues.some(i => i.severity === 'amber')
      ? 'amber'
      : 'green';

  return { dot, issues };
}

// ─── Sleeve row ───────────────────────────────────────────────────────────────

interface SleeveRowProps {
  account: Account;
  nav: number;
  dayChangePct: number;
  positionCount: number;
  accountPositions: { symbol: string; marketValue: number }[];
  isFirst: boolean;
  onLongPress: () => void;
}

function SleeveRow({
  account, nav, dayChangePct, positionCount, accountPositions, isFirst, onLongPress,
}: SleeveRowProps) {
  const [expanded, setExpanded] = useState(false);
  const { dot, issues } = computeCompliance(account, accountPositions, nav);

  const dotColor = dot === 'red' ? colors.negative : dot === 'amber' ? colors.amber : colors.positive;
  const dayColor = dayChangePct >= 0 ? colors.positive : colors.negative;

  return (
    <View style={[styles.sleeveRow, !isFirst && styles.sleeveRowBorder]}>
      <Pressable
        style={styles.sleeveRowMain}
        onPress={() => router.push({ pathname: '/account/[id]', params: { id: account.id } })}
        onLongPress={onLongPress}
      >
        {/* Compliance indicator */}
        <Pressable
          onPress={(e) => {
            if ('stopPropagation' in e) (e as any).stopPropagation();
            setExpanded(v => !v);
          }}
          hitSlop={8}
          style={styles.dotBtn}
        >
          <View style={[styles.complianceDot, { backgroundColor: dotColor }]} />
        </Pressable>

        <View style={styles.sleeveRowLeft}>
          <Text style={styles.sleeveName} numberOfLines={1}>{account.name}</Text>
          <Text style={styles.sleeveMeta}>{positionCount} pos</Text>
        </View>

        <View style={styles.sleeveRowRight}>
          <Text style={styles.sleeveNav}>
            ${nav.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </Text>
          <Text style={[styles.sleeveDayPct, { color: dayColor }]}>
            {dayChangePct >= 0 ? '+' : ''}{dayChangePct.toFixed(2)}%
          </Text>
          <Text style={styles.chevron}>›</Text>
        </View>
      </Pressable>

      {expanded && (
        <View style={styles.complianceExpanded}>
          {issues.length === 0 ? (
            <Text style={[styles.complianceText, { color: colors.positive }]}>
              All thresholds met
            </Text>
          ) : (
            issues.map((issue, i) => (
              <View key={i} style={styles.issueRow}>
                <View style={[styles.issueDot, { backgroundColor: issue.severity === 'red' ? colors.negative : colors.amber }]} />
                <Text style={styles.complianceText}>{issue.label}</Text>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AccountsScreen() {
  const insets = useSafeAreaInsets();
  const { accounts, positions, summary, isLoading, refreshAll } = usePortfolio();
  const topPad = Platform.OS === 'web' ? 20 : insets.top;

  const [showAdd, setShowAdd] = useState(false);
  const [menuAccount, setMenuAccount] = useState<{ id: number; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: '', broker: '', accountType: 'long_term', currency: 'USD',
    initialBalance: '', sleeveKey: '', maxLeverageRatio: '',
  });

  useEffect(() => { refreshAll(); }, []);

  const canSubmit = !!(form.name.trim() && form.broker.trim());

  const exportAllCSV = () => {
    const header = 'Account,Symbol,Name,Qty,Avg Cost,Current Price,Market Value,Unrealized P&L,P&L %';
    const rows = positions.map(p => {
      const acc = accounts.find(a => a.id === p.accountId);
      return `"${acc?.name ?? ''}",${p.symbol},"${p.name}",${p.quantity},${p.avgCost.toFixed(4)},${p.currentPrice.toFixed(4)},${p.marketValue.toFixed(2)},${p.unrealizedPnl.toFixed(2)},${p.unrealizedPnlPct.toFixed(2)}`;
    });
    const csv = [header, ...rows].join('\n');
    const filename = `portfolio_${new Date().toISOString().slice(0, 10)}.csv`;
    if (Platform.OS === 'web') {
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } else {
      Share.share({ message: csv, title: filename });
    }
  };

  const handleAdd = async () => {
    if (!canSubmit || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const created = await apiPost<Account>('/accounts', {
        name: form.name.trim(),
        broker: form.broker.trim(),
        accountType: form.accountType,
        currency: form.currency,
        initialBalance: parseFloat(form.initialBalance) || 0,
      });
      if (form.sleeveKey || form.maxLeverageRatio) {
        await apiPut(`/accounts/${created.id}`, {
          sleeveKey: form.sleeveKey || null,
          maxLeverageRatio: form.maxLeverageRatio ? parseFloat(form.maxLeverageRatio) : null,
        });
      }
      setShowAdd(false);
      setForm({ name: '', broker: '', accountType: 'long_term', currency: 'USD', initialBalance: '', sleeveKey: '', maxLeverageRatio: '' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refreshAll();
    } catch {
      Alert.alert('Error', 'Failed to create account');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = useCallback((id: number, name: string) => {
    setConfirmDelete({ id, name });
  }, []);

  const doDelete = async () => {
    if (!confirmDelete) return;
    const { id } = confirmDelete;
    setConfirmDelete(null);
    try {
      await apiDelete(`/accounts/${id}`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refreshAll();
    } catch {
      Alert.alert('Error', 'Failed to delete account');
    }
  };

  const bottomPad = Platform.OS === 'web' ? 100 : insets.bottom + 80;

  const totalNav = summary?.totalNav ?? 0;
  const dayChange = summary?.dayChange ?? 0;
  const dayChangePct = summary?.dayChangePct ?? 0;
  const dayColor = dayChange >= 0 ? colors.positive : colors.negative;

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>PORTFOLIO</Text>
          <Text style={styles.title}>Accounts</Text>
        </View>
        <View style={styles.headerActions}>
          {positions.length > 0 && (
            <Pressable style={styles.iconBtn} onPress={exportAllCSV}>
              <Text style={styles.iconBtnText}>↓</Text>
            </Pressable>
          )}
          <Pressable
            style={styles.addBtn}
            onPress={() => { Haptics.selectionAsync(); setShowAdd(true); }}
          >
            <Text style={styles.addBtnText}>+</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refreshAll} tintColor={colors.ink3} />}
        contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: bottomPad }}
      >
        {/* NW summary panel */}
        {summary != null && (
          <View style={styles.navPanel}>
            <Text style={styles.navEyebrow}>NET LIQUID VALUE</Text>
            <Text style={styles.navFigure}>
              ${totalNav.toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </Text>
            <View style={styles.navMeta}>
              <Text style={[styles.navChange, { color: dayColor }]}>
                {dayChange >= 0 ? '+$' : '−$'}{Math.abs(dayChange).toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </Text>
              <Text style={[styles.navChange, { color: dayColor }]}>
                {dayChange >= 0 ? '+' : ''}{dayChangePct.toFixed(2)}%
              </Text>
              <Text style={styles.navSep}>·</Text>
              <Text style={styles.navLabel}>today</Text>
              <Text style={styles.navSep}>·</Text>
              <Text style={styles.navLabel}>{summary.positionCount} positions</Text>
            </View>
          </View>
        )}

        {accounts.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No accounts yet</Text>
            <Text style={styles.emptyText}>Add your trading or savings accounts to start tracking</Text>
          </View>
        ) : (
          <View style={styles.ledgerTable}>
            {accounts.map((account, i) => {
              const accSummary = summary?.accounts.find(a => a.id === account.id);
              const accountPositions = positions
                .filter(p => p.accountId === account.id)
                .map(p => ({ symbol: p.symbol, marketValue: p.marketValue }));
              return (
                <SleeveRow
                  key={account.id}
                  account={account}
                  nav={accSummary?.nav ?? account.currentBalance}
                  dayChangePct={accSummary?.dayChangePct ?? 0}
                  positionCount={accountPositions.length}
                  accountPositions={accountPositions}
                  isFirst={i === 0}
                  onLongPress={() => setMenuAccount({ id: account.id, name: account.name })}
                />
              );
            })}
          </View>
        )}

        {/* Import activity */}
        <Pressable
          style={styles.importRow}
          onPress={() => router.push('/(tabs)/activity')}
        >
          <Text style={styles.importRowText}>Import activity</Text>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </ScrollView>

      {/* Add Account Modal */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>New Account</Text>

            <TextInput
              style={styles.input}
              placeholder="Account name"
              placeholderTextColor={colors.ink3}
              value={form.name}
              onChangeText={t => setForm(f => ({ ...f, name: t }))}
            />
            <TextInput
              style={styles.input}
              placeholder="Broker / Institution"
              placeholderTextColor={colors.ink3}
              value={form.broker}
              onChangeText={t => setForm(f => ({ ...f, broker: t }))}
            />

            <Text style={styles.inputLabel}>Type</Text>
            <View style={styles.typeGrid}>
              {ACCOUNT_TYPES.map(t => (
                <Pressable
                  key={t.key}
                  style={[styles.typeOption, form.accountType === t.key && styles.typeSelected]}
                  onPress={() => setForm(f => ({ ...f, accountType: t.key }))}
                >
                  <Text style={[styles.typeText, form.accountType === t.key && styles.typeTextSelected]}>
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <TextInput
              style={styles.input}
              placeholder="Initial balance (USD)"
              placeholderTextColor={colors.ink3}
              keyboardType="decimal-pad"
              value={form.initialBalance}
              onChangeText={t => setForm(f => ({ ...f, initialBalance: t }))}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Sleeve key (A–H)"
                placeholderTextColor={colors.ink3}
                autoCapitalize="characters"
                maxLength={1}
                value={form.sleeveKey}
                onChangeText={t => setForm(f => ({ ...f, sleeveKey: t.toUpperCase() }))}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Max leverage (e.g. 1.5)"
                placeholderTextColor={colors.ink3}
                keyboardType="decimal-pad"
                value={form.maxLeverageRatio}
                onChangeText={t => setForm(f => ({ ...f, maxLeverageRatio: t }))}
              />
            </View>

            <View style={styles.modalBtns}>
              <Pressable style={styles.cancelBtn} onPress={() => setShowAdd(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.saveBtn, (!canSubmit || isSubmitting) && { opacity: 0.4 }]}
                onPress={handleAdd}
                disabled={!canSubmit || isSubmitting}
              >
                <Text style={styles.saveBtnText}>{isSubmitting ? 'Adding…' : 'Add Account'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Confirm delete */}
      <Modal visible={!!confirmDelete} animationType="fade" transparent>
        <View style={styles.menuOverlay}>
          <View style={[styles.menuSheet, { paddingBottom: insets.bottom + 8 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Delete Account</Text>
            <Text style={styles.deleteText}>
              Delete "{confirmDelete?.name}" and all its positions and activities? This cannot be undone.
            </Text>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
              <Pressable style={[styles.confirmBtn, { borderWidth: 1, borderColor: colors.hair2 }]} onPress={() => setConfirmDelete(null)}>
                <Text style={[styles.confirmBtnText, { color: colors.ink2 }]}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.confirmBtn, { backgroundColor: colors.negative }]} onPress={doDelete}>
                <Text style={[styles.confirmBtnText, { color: '#fff' }]}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Context menu */}
      <Modal visible={!!menuAccount} animationType="fade" transparent>
        <Pressable style={styles.menuOverlay} onPress={() => setMenuAccount(null)}>
          <View style={[styles.menuSheet, { paddingBottom: insets.bottom + 8 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.menuTitle}>{menuAccount?.name}</Text>
            <Pressable
              style={styles.menuItem}
              onPress={() => { setMenuAccount(null); router.push({ pathname: '/account/[id]', params: { id: menuAccount!.id } }); }}
            >
              <Text style={styles.menuItemText}>View Details</Text>
              <Text style={styles.menuItemChevron}>›</Text>
            </Pressable>
            <Pressable
              style={[styles.menuItem, styles.menuItemBorder]}
              onPress={() => { const a = menuAccount!; setMenuAccount(null); setConfirmDelete({ id: a.id, name: a.name }); }}
            >
              <Text style={[styles.menuItemText, { color: colors.negative }]}>Delete Account</Text>
              <Text style={[styles.menuItemChevron, { color: colors.negative }]}>›</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 16,
  },
  eyebrow: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  title: {
    fontFamily: fonts.serif,
    fontSize: 26,
    letterSpacing: -0.02 * 26,
    color: colors.ink,
    marginTop: 4,
  },
  headerActions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  iconBtn: {
    width: 34, height: 34,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: colors.hair2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: { fontFamily: fonts.mono, fontSize: 16, color: colors.ink2 },
  addBtn: {
    width: 34, height: 34,
    borderRadius: 2,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: { fontSize: 20, color: colors.card, lineHeight: 22 },

  // NW panel
  navPanel: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.hair2,
    borderRadius: 2,
    padding: 14,
    marginBottom: 18,
  },
  navEyebrow: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: colors.ink3,
  },
  navFigure: {
    fontFamily: fonts.mono,
    fontSize: 32,
    letterSpacing: -0.02 * 32,
    color: colors.ink,
    marginTop: 4,
    lineHeight: 38,
    fontVariant: ['tabular-nums'],
  },
  navMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  navChange: { fontFamily: fonts.mono, fontSize: 12, fontVariant: ['tabular-nums'] },
  navSep: { color: colors.hair2, fontSize: 12 },
  navLabel: { fontFamily: fonts.sans, fontSize: 12, color: colors.ink3 },

  // Ledger
  ledgerTable: {
    borderTopWidth: 1,
    borderTopColor: colors.ink,
  },
  sleeveRow: {
    paddingVertical: 2,
  },
  sleeveRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.hair,
  },
  sleeveRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  dotBtn: { marginRight: 10 },
  complianceDot: { width: 8, height: 8, borderRadius: 4 },
  sleeveRowLeft: { flex: 1 },
  sleeveName: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.ink },
  sleeveMeta: { fontFamily: fonts.mono, fontSize: 10, color: colors.ink3, marginTop: 2 },
  sleeveRowRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sleeveNav: { fontFamily: fonts.mono, fontSize: 13, fontVariant: ['tabular-nums'], color: colors.ink },
  sleeveDayPct: { fontFamily: fonts.mono, fontSize: 12, fontVariant: ['tabular-nums'] },
  chevron: { fontSize: 16, color: colors.ink3 },

  complianceExpanded: {
    marginLeft: 18,
    marginBottom: 10,
    gap: 6,
  },
  issueRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  issueDot: { width: 5, height: 5, borderRadius: 3, marginTop: 5, flexShrink: 0 },
  complianceText: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.ink2,
    lineHeight: 17,
  },

  // Import row
  importRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.hair,
    marginTop: 4,
  },
  importRowText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.accent,
  },

  // Empty
  emptyState: { alignItems: 'center', paddingTop: 80, gap: 10 },
  emptyTitle: { fontFamily: fonts.serif, fontSize: 20, color: colors.ink },
  emptyText: { fontFamily: fonts.sans, fontSize: 13, color: colors.ink3, textAlign: 'center', paddingHorizontal: 40 },

  // Modals
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(21,18,12,0.5)' },
  modalSheet: { backgroundColor: colors.card, borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 20 },
  modalHandle: { width: 36, height: 4, backgroundColor: colors.hair2, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitle: { fontFamily: fonts.serif, fontSize: 20, color: colors.ink, marginBottom: 16 },
  input: {
    backgroundColor: colors.bgInset,
    borderRadius: 2,
    padding: 14,
    color: colors.ink,
    fontFamily: fonts.sans,
    fontSize: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.hair2,
  },
  inputLabel: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: colors.ink3, marginBottom: 8 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  typeOption: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 2, borderWidth: 1,
    borderColor: colors.hair2,
  },
  typeSelected: { borderColor: colors.ink, backgroundColor: colors.bgInset },
  typeText: { fontFamily: fonts.sans, fontSize: 13, color: colors.ink2 },
  typeTextSelected: { color: colors.ink, fontFamily: fonts.sansMedium },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 2, borderWidth: 1, borderColor: colors.hair2, alignItems: 'center' },
  cancelText: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.ink2 },
  saveBtn: { flex: 2, padding: 14, borderRadius: 2, backgroundColor: colors.ink, alignItems: 'center' },
  saveBtnText: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: colors.card },
  deleteText: { fontFamily: fonts.sans, fontSize: 14, color: colors.ink2, marginBottom: 20, lineHeight: 20 },
  confirmBtn: { flex: 1, padding: 14, borderRadius: 2, alignItems: 'center' },
  confirmBtnText: { fontFamily: fonts.sansSemiBold, fontSize: 15 },
  menuOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(21,18,12,0.5)' },
  menuSheet: { backgroundColor: colors.card, borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 20 },
  menuTitle: { fontFamily: fonts.serif, fontSize: 17, color: colors.ink, marginBottom: 12 },
  menuItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  menuItemBorder: { borderTopWidth: 1, borderTopColor: colors.hair },
  menuItemText: { fontFamily: fonts.sansMedium, fontSize: 15, color: colors.ink },
  menuItemChevron: { fontSize: 18, color: colors.ink3 },
});
