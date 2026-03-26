import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  Pressable, Modal, TextInput, Alert, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { colors } from '@/constants/colors';
import { usePortfolio, apiPost, apiDelete, Account } from '@/context/PortfolioContext';
import { Card } from '@/components/ui/Card';
import { AccountTypeBadge } from '@/components/ui/AccountTypeBadge';
import { formatCurrency } from '@/components/ui/PnlBadge';
import { Skeleton } from '@/components/ui/Skeleton';

const ACCOUNT_TYPES = [
  { key: 'long_term', label: 'Long Term' },
  { key: 'swing', label: 'Swing Trading' },
  { key: 'day_trading', label: 'Day Trading' },
  { key: 'savings', label: 'Savings / Cash' },
];

export default function AccountsScreen() {
  const insets = useSafeAreaInsets();
  const { accounts, positions, summary, isLoading, refreshAll } = usePortfolio();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [showAdd, setShowAdd] = useState(false);
  const [menuAccount, setMenuAccount] = useState<{ id: number; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: '',
    broker: '',
    accountType: 'long_term',
    currency: 'USD',
    initialBalance: '',
  });

  useEffect(() => {
    refreshAll();
  }, []);

  const canSubmit = !!(form.name.trim() && form.broker.trim());

  const handleAdd = async () => {
    if (!canSubmit || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await apiPost('/accounts', {
        name: form.name.trim(),
        broker: form.broker.trim(),
        accountType: form.accountType,
        currency: form.currency,
        initialBalance: parseFloat(form.initialBalance) || 0,
      });
      setShowAdd(false);
      setForm({ name: '', broker: '', accountType: 'long_term', currency: 'USD', initialBalance: '' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refreshAll();
    } catch (e) {
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

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Accounts</Text>
        <Pressable
          style={styles.addBtn}
          onPress={() => {
            Haptics.selectionAsync();
            setShowAdd(true);
          }}
        >
          <Feather name="plus" size={20} color={colors.background} />
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refreshAll} tintColor={colors.primary} />}
        contentContainerStyle={[styles.scroll, {
          paddingBottom: Platform.OS === 'web' ? 100 : (insets.bottom + 90)
        }]}
      >
        {isLoading && accounts.length === 0 ? (
          [1, 2, 3].map(i => (
            <View key={i} style={[styles.accountCard, { marginBottom: 12 }]}>
              <Skeleton height={14} width="30%" />
              <Skeleton height={20} width="50%" style={{ marginTop: 8 }} />
              <Skeleton height={12} width="70%" style={{ marginTop: 8 }} />
            </View>
          ))
        ) : accounts.length === 0 ? (
          <View style={styles.emptyState}>
            <Feather name="briefcase" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No accounts yet</Text>
            <Text style={styles.emptyText}>Add your trading or savings accounts to start tracking</Text>
          </View>
        ) : (
          accounts.map(account => {
            const accSummary = summary?.accounts.find(a => a.id === account.id);
            const posCount = positions.filter(p => p.accountId === account.id).length;
            const pos = (accSummary?.unrealizedPnl ?? 0) >= 0;
            return (
              <Card
                key={account.id}
                style={styles.accountCard}
                onPress={() => router.push({ pathname: '/account/[id]', params: { id: account.id } })}
              >
                <View style={styles.accountHeader}>
                  <AccountTypeBadge type={account.accountType as any} size="sm" />
                  <Pressable
                    onPress={(e) => {
                      if ('stopPropagation' in e) (e as any).stopPropagation();
                      setMenuAccount({ id: account.id, name: account.name });
                    }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Feather name="more-horizontal" size={18} color={colors.textMuted} />
                  </Pressable>
                </View>
                <Text style={styles.accountName}>{account.name}</Text>
                <Text style={styles.brokerName}>{account.broker}</Text>

                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>Current Value</Text>
                    <Text style={styles.statValue}>{formatCurrency(accSummary?.nav ?? account.currentBalance)}</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>Unrealized P&L</Text>
                    <Text style={[styles.statValue, { color: pos ? colors.positive : colors.negative }]}>
                      {pos ? '+' : ''}{formatCurrency(accSummary?.unrealizedPnl ?? 0)}
                    </Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>Positions</Text>
                    <Text style={styles.statValue}>{posCount}</Text>
                  </View>
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>

      {/* Add Account Modal */}
      <Modal visible={showAdd} animationType="slide" transparent presentationStyle="pageSheet">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>New Account</Text>

            <TextInput
              style={styles.input}
              placeholder="Account name"
              placeholderTextColor={colors.textMuted}
              value={form.name}
              onChangeText={t => setForm(f => ({ ...f, name: t }))}
            />
            <TextInput
              style={styles.input}
              placeholder="Broker / Institution"
              placeholderTextColor={colors.textMuted}
              value={form.broker}
              onChangeText={t => setForm(f => ({ ...f, broker: t }))}
            />

            <Text style={styles.inputLabel}>Account Type</Text>
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
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              value={form.initialBalance}
              onChangeText={t => setForm(f => ({ ...f, initialBalance: t }))}
            />

            <View style={styles.modalButtons}>
              <Pressable style={styles.cancelBtn} onPress={() => setShowAdd(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.saveBtn, (!canSubmit || isSubmitting) && { opacity: 0.4 }]} onPress={handleAdd} disabled={!canSubmit || isSubmitting}>
                <Text style={styles.saveText}>{isSubmitting ? 'Adding…' : 'Add Account'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Confirm delete modal */}
      <Modal visible={!!confirmDelete} animationType="fade" transparent>
        <View style={styles.menuOverlay}>
          <View style={[styles.menuSheet, { paddingBottom: insets.bottom + 8 }]}>
            <View style={styles.menuHandle} />
            <Text style={styles.menuTitle}>Delete Account</Text>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textSecondary, marginBottom: 20 }}>
              Delete "{confirmDelete?.name}" and all its positions and activities? This cannot be undone.
            </Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable style={[styles.confirmBtn, { flex: 1, backgroundColor: colors.surfaceElevated }]} onPress={() => setConfirmDelete(null)}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.textSecondary }}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.confirmBtn, { flex: 1, backgroundColor: colors.negative }]} onPress={doDelete}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 15, color: '#fff' }}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Account context menu */}
      <Modal visible={!!menuAccount} animationType="fade" transparent>
        <Pressable style={styles.menuOverlay} onPress={() => setMenuAccount(null)}>
          <View style={[styles.menuSheet, { paddingBottom: insets.bottom + 8 }]}>
            <View style={styles.menuHandle} />
            <Text style={styles.menuTitle}>{menuAccount?.name}</Text>
            <Pressable style={styles.menuItem} onPress={() => { setMenuAccount(null); router.push({ pathname: '/account/[id]', params: { id: menuAccount!.id } }); }}>
              <Feather name="eye" size={18} color={colors.textPrimary} />
              <Text style={styles.menuItemText}>View Details</Text>
            </Pressable>
            <Pressable style={[styles.menuItem, { borderTopWidth: 1, borderTopColor: colors.separator }]} onPress={() => { const a = menuAccount!; setMenuAccount(null); setConfirmDelete({ id: a.id, name: a.name }); }}>
              <Feather name="trash-2" size={18} color={colors.negative} />
              <Text style={[styles.menuItemText, { color: colors.negative }]}>Delete Account</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    paddingTop: 4,
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, color: colors.textPrimary },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { paddingHorizontal: 16 },
  accountCard: { marginBottom: 12 },
  accountHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  accountName: { fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.textPrimary },
  brokerName: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textSecondary, marginTop: 2, marginBottom: 12 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statItem: { flex: 1 },
  statLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted, marginBottom: 2 },
  statValue: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: colors.textPrimary },
  emptyState: { alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18, color: colors.textSecondary },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 40 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalContainer: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  modalHandle: { width: 36, height: 4, backgroundColor: colors.separator, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, color: colors.textPrimary, marginBottom: 16 },
  input: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 12,
    padding: 14,
    color: colors.textPrimary,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.separator,
  },
  inputLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.textSecondary, marginBottom: 8 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  typeOption: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surfaceElevated,
  },
  typeSelected: { borderColor: colors.primary, backgroundColor: 'rgba(0,212,255,0.1)' },
  typeText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.textSecondary },
  typeTextSelected: { color: colors.primary },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.separator, alignItems: 'center' },
  cancelText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.textSecondary },
  saveBtn: { flex: 2, padding: 16, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center' },
  saveText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.background },
  menuOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  menuSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  menuHandle: { width: 36, height: 4, backgroundColor: colors.separator, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  menuTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, color: colors.textPrimary, marginBottom: 12 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  menuItemText: { fontFamily: 'Inter_500Medium', fontSize: 16, color: colors.textPrimary },
  confirmBtn: { padding: 14, borderRadius: 12, alignItems: 'center' },
});
