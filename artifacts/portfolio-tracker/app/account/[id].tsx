import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Modal, TextInput, Alert, Platform, RefreshControl,
} from 'react-native';
import { useLocalSearchParams, router, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '@/constants/colors';
import { usePortfolio, apiGet, apiPost, apiDelete, apiPut, Position, Account } from '@/context/PortfolioContext';
import { Card } from '@/components/ui/Card';
import { PnlBadge, formatCurrency } from '@/components/ui/PnlBadge';
import { AccountTypeBadge } from '@/components/ui/AccountTypeBadge';
import { Skeleton } from '@/components/ui/Skeleton';

export default function AccountDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const accountId = parseInt(id);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { accounts, positions: allPositions, refreshAll } = usePortfolio();

  const account = accounts.find(a => a.id === accountId);
  const positions = allPositions.filter(p => p.accountId === accountId);

  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAddPos, setShowAddPos] = useState(false);
  const [form, setForm] = useState({ symbol: '', name: '', quantity: '', avgCost: '', sector: '', notes: '' });

  useEffect(() => {
    if (account) navigation.setOptions({ title: account.name });
  }, [account]);

  const totalValue = positions.reduce((s, p) => s + p.marketValue, 0) + (account?.currentBalance ?? 0);
  const totalPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
  const totalCost = positions.reduce((s, p) => s + p.quantity * p.avgCost, 0);
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  const handleAddPosition = async () => {
    if (!form.symbol || !form.name || !form.quantity || !form.avgCost) {
      Alert.alert('Missing fields', 'Fill in symbol, name, quantity and average cost');
      return;
    }
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await apiPost('/positions', {
        accountId,
        symbol: form.symbol.toUpperCase(),
        name: form.name,
        quantity: parseFloat(form.quantity),
        avgCost: parseFloat(form.avgCost),
        sector: form.sector || undefined,
        notes: form.notes || undefined,
      });
      setShowAddPos(false);
      setForm({ symbol: '', name: '', quantity: '', avgCost: '', sector: '', notes: '' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Refresh all so portfolio dashboard also updates immediately
      await refreshAll();
    } catch {
      Alert.alert('Error', 'Failed to add position');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeletePos = (posId: number, symbol: string) => {
    Alert.alert('Delete Position', `Remove ${symbol} from this account?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await apiDelete(`/positions/${posId}`);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            await refreshAll();
          } catch {
            Alert.alert('Error', 'Failed to delete');
          }
        }
      }
    ]);
  };

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={() => refreshPositions(accountId)}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={[styles.scroll, {
          paddingBottom: Platform.OS === 'web' ? 40 : (insets.bottom + 24)
        }]}
      >
        {/* Account Summary */}
        {account && (
          <Card style={styles.summaryCard}>
            <View style={styles.summaryTop}>
              <AccountTypeBadge type={account.accountType as any} />
              <Text style={styles.brokerName}>{account.broker}</Text>
            </View>
            <Text style={styles.navValue}>{formatCurrency(totalValue)}</Text>
            <View style={styles.pnlRow}>
              <PnlBadge value={totalPnl} percentage={totalPnlPct} size="md" />
              <Text style={styles.posCount}>{positions.length} positions</Text>
            </View>
            <View style={styles.cashRow}>
              <Text style={styles.cashLabel}>Cash</Text>
              <Text style={styles.cashValue}>{formatCurrency(account.currentBalance)}</Text>
            </View>
          </Card>
        )}

        {/* Positions */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Positions</Text>
          <Pressable
            style={styles.addBtn}
            onPress={() => { Haptics.selectionAsync(); setShowAddPos(true); }}
          >
            <Feather name="plus" size={16} color={colors.background} />
            <Text style={styles.addBtnText}>Add</Text>
          </Pressable>
        </View>

        {positions.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Feather name="layers" size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>No positions yet. Add a holding to get started.</Text>
          </Card>
        ) : (
          positions.map(pos => {
            const isPos = pos.unrealizedPnl >= 0;
            return (
              <Card
                key={pos.id}
                style={styles.posCard}
                onPress={() => router.push({ pathname: '/chart/[symbol]', params: { symbol: pos.symbol } })}
              >
                <View style={styles.posHeader}>
                  <View>
                    <Text style={styles.posSymbol}>{pos.symbol}</Text>
                    <Text style={styles.posName} numberOfLines={1}>{pos.name}</Text>
                  </View>
                  <View style={styles.posRight}>
                    <Text style={styles.posValue}>{formatCurrency(pos.marketValue)}</Text>
                    <Pressable onPress={() => handleDeletePos(pos.id, pos.symbol)} style={styles.deleteBtn}>
                      <Feather name="trash-2" size={13} color={colors.textMuted} />
                    </Pressable>
                  </View>
                </View>
                <View style={styles.posStats}>
                  <View style={styles.posStat}>
                    <Text style={styles.posStatLabel}>Qty</Text>
                    <Text style={styles.posStatVal}>{pos.quantity}</Text>
                  </View>
                  <View style={styles.posStat}>
                    <Text style={styles.posStatLabel}>Avg Cost</Text>
                    <Text style={styles.posStatVal}>${pos.avgCost.toFixed(2)}</Text>
                  </View>
                  <View style={styles.posStat}>
                    <Text style={styles.posStatLabel}>Last</Text>
                    <Text style={styles.posStatVal}>${pos.currentPrice.toFixed(2)}</Text>
                  </View>
                  <View style={styles.posStat}>
                    <Text style={styles.posStatLabel}>P&L</Text>
                    <Text style={[styles.posStatVal, { color: isPos ? colors.positive : colors.negative }]}>
                      {isPos ? '+' : ''}{pos.unrealizedPnlPct.toFixed(1)}%
                    </Text>
                  </View>
                </View>
                {pos.sector && <Text style={styles.sector}>{pos.sector}</Text>}
              </Card>
            );
          })
        )}
      </ScrollView>

      {/* Add Position Modal */}
      <Modal visible={showAddPos} animationType="slide" transparent presentationStyle="pageSheet">
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Add Position</Text>

            <View style={styles.inputRow}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Symbol" placeholderTextColor={colors.textMuted} autoCapitalize="characters" value={form.symbol} onChangeText={t => setForm(f => ({ ...f, symbol: t }))} />
              <TextInput style={[styles.input, { flex: 2, marginLeft: 8 }]} placeholder="Company name" placeholderTextColor={colors.textMuted} value={form.name} onChangeText={t => setForm(f => ({ ...f, name: t }))} />
            </View>
            <View style={styles.inputRow}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Quantity" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" value={form.quantity} onChangeText={t => setForm(f => ({ ...f, quantity: t }))} />
              <TextInput style={[styles.input, { flex: 1, marginLeft: 8 }]} placeholder="Avg cost ($)" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" value={form.avgCost} onChangeText={t => setForm(f => ({ ...f, avgCost: t }))} />
            </View>
            <TextInput style={styles.input} placeholder="Sector (optional)" placeholderTextColor={colors.textMuted} value={form.sector} onChangeText={t => setForm(f => ({ ...f, sector: t }))} />
            <TextInput style={styles.input} placeholder="Notes (optional)" placeholderTextColor={colors.textMuted} value={form.notes} onChangeText={t => setForm(f => ({ ...f, notes: t }))} />

            <View style={styles.modalButtons}>
              <Pressable style={styles.cancelBtn} onPress={() => setShowAddPos(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.saveBtn, isSubmitting && { opacity: 0.6 }]} onPress={handleAddPosition} disabled={isSubmitting}>
                <Text style={styles.saveText}>{isSubmitting ? 'Adding…' : 'Add Position'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 16 },
  summaryCard: { marginBottom: 20 },
  summaryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  brokerName: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textSecondary },
  navValue: { fontFamily: 'Inter_700Bold', fontSize: 36, color: colors.textPrimary },
  pnlRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  posCount: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textMuted },
  cashRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.separator },
  cashLabel: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textSecondary },
  cashValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.textPrimary },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: colors.textPrimary },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  addBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.background },
  emptyCard: { alignItems: 'center', padding: 32, gap: 12 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  posCard: { marginBottom: 10 },
  posHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  posSymbol: { fontFamily: 'Inter_700Bold', fontSize: 17, color: colors.textPrimary },
  posName: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textSecondary, marginTop: 1, maxWidth: 160 },
  posRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  posValue: { fontFamily: 'Inter_700Bold', fontSize: 16, color: colors.textPrimary },
  deleteBtn: { padding: 4 },
  posStats: { flexDirection: 'row' },
  posStat: { flex: 1 },
  posStatLabel: { fontFamily: 'Inter_400Regular', fontSize: 10, color: colors.textMuted, marginBottom: 2 },
  posStatVal: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.textPrimary },
  sector: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 8 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  modalHandle: { width: 36, height: 4, backgroundColor: colors.separator, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, color: colors.textPrimary, marginBottom: 16 },
  inputRow: { flexDirection: 'row', marginBottom: 0 },
  input: { backgroundColor: colors.surfaceElevated, borderRadius: 12, padding: 14, color: colors.textPrimary, fontFamily: 'Inter_400Regular', fontSize: 15, marginBottom: 12, borderWidth: 1, borderColor: colors.separator },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.separator, alignItems: 'center' },
  cancelText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.textSecondary },
  saveBtn: { flex: 2, padding: 16, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center' },
  saveText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.background },
});
