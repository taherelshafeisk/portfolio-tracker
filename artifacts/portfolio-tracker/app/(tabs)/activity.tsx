import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl,
  Pressable, Modal, TextInput, Alert, Platform, Image,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '@/constants/colors';
import { usePortfolio, apiPost, apiDelete, TradeActivity } from '@/context/PortfolioContext';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';

const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? process.env.EXPO_PUBLIC_DOMAIN.includes('localhost')
    ? `http://${process.env.EXPO_PUBLIC_DOMAIN}/api`
    : `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`
  : '/api';

const ACTIVITY_ICONS: Record<string, { icon: any; color: string }> = {
  buy: { icon: 'arrow-down-circle', color: colors.positive },
  sell: { icon: 'arrow-up-circle', color: colors.negative },
  dividend: { icon: 'dollar-sign', color: colors.primary },
  deposit: { icon: 'plus-circle', color: colors.longTerm },
  withdrawal: { icon: 'minus-circle', color: colors.swing },
  note: { icon: 'file-text', color: colors.textSecondary },
};

const ACTIVITY_TYPES = ['buy', 'sell', 'dividend', 'deposit', 'withdrawal', 'note'];

interface ParsedTrade {
  _key: string;
  activityType: string;
  symbol: string;
  quantity: string;
  price: string;
  notes: string;
  tradeDate: string;
}

// Safely parse date from AI response, avoiding UTC midnight day-shift
const parseDateSafe = (d: string | undefined): string => {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (!d) return todayStr;
  const clean = d.split('T')[0].trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  try {
    const p = new Date(d);
    if (!isNaN(p.getTime())) {
      return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}-${String(p.getDate()).padStart(2, '0')}`;
    }
  } catch { }
  return todayStr;
};

// Treat date as noon UTC so timezone can't shift the day
const dateToAPI = (d: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00.000Z` : new Date(d).toISOString();

export default function ActivityScreen() {
  const insets = useSafeAreaInsets();
  const { accounts, activities, isLoading, refreshAll } = usePortfolio();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  // Modal step: 'account' → pick account first, then 'manual' or 'review'
  type Step = 'account' | 'manual' | 'review';
  const [showAdd, setShowAdd] = useState(false);
  const [step, setStep] = useState<Step>('account');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [detectedAccount, setDetectedAccount] = useState<string | null>(null);

  // Multi-trade review state
  const [parsedTrades, setParsedTrades] = useState<ParsedTrade[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Manual single-trade form
  const emptyManual: ParsedTrade = {
    _key: 'manual',
    activityType: 'buy',
    symbol: '',
    quantity: '',
    price: '',
    notes: '',
    tradeDate: parseDateSafe(undefined),
  };
  const [manualForm, setManualForm] = useState<ParsedTrade>(emptyManual);

  useEffect(() => { refreshAll(); }, []);

  const openModal = () => {
    setStep('account');
    setSelectedAccountId('');
    setParsedTrades([]);
    setManualForm(emptyManual);
    setPreviewUri(null);
    setDetectedAccount(null);
    setShowAdd(true);
  };

  const closeModal = () => {
    setShowAdd(false);
  };

  const handlePickImage = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo access to upload trade screenshots.');
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (!asset.base64) return;

    setIsParsing(true);
    setPreviewUri(asset.uri);
    setStep('review');

    try {
      const resp = await fetch(`${API_BASE}/anthropic/parse-screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: asset.base64,
          mediaType: asset.mimeType || 'image/jpeg',
          parseType: 'activities',
        }),
      });
      const data = await resp.json();

      if (!resp.ok) {
        Alert.alert('Error', data.error || 'Failed to parse screenshot.');
        setStep('account');
        setPreviewUri(null);
        return;
      }

      const trades: any[] = data.trades || [];
      const hint: string | null = data.accountHint || null;
      setDetectedAccount(hint);

      // If account hint matches one of the accounts, auto-select it
      if (hint && !selectedAccountId) {
        const match = accounts.find(a =>
          a.name.toLowerCase().includes(hint.toLowerCase()) ||
          hint.toLowerCase().includes(a.name.toLowerCase()) ||
          (a.broker && a.broker.toLowerCase().includes(hint.toLowerCase()))
        );
        if (match) setSelectedAccountId(match.id.toString());
      }

      if (trades.length === 0) {
        Alert.alert('No trades found', 'Claude could not detect trades in this image. Try a clearer screenshot or enter manually.');
        setStep('account');
        setPreviewUri(null);
      } else {
        setParsedTrades(trades.map((t: any, i: number) => ({
          _key: `t${i}_${Date.now()}`,
          activityType: t.activityType || 'buy',
          symbol: t.symbol || '',
          quantity: t.quantity != null ? String(t.quantity) : '',
          price: t.price != null ? String(t.price) : '',
          notes: t.notes || '',
          tradeDate: parseDateSafe(t.tradeDate),
        })));
      }
    } catch {
      Alert.alert('Error', 'Failed to parse screenshot.');
      setStep('account');
      setPreviewUri(null);
    } finally {
      setIsParsing(false);
    }
  };

  const updateParsedTrade = (key: string, field: keyof ParsedTrade, val: string) => {
    setParsedTrades(ts => ts.map(t => t._key === key ? { ...t, [field]: val } : t));
  };

  const removeParsedTrade = (key: string) => {
    setParsedTrades(ts => ts.filter(t => t._key !== key));
  };

  const submitTrades = async (trades: ParsedTrade[], accountId: string) => {
    if (!accountId) {
      Alert.alert('Select account', 'Please select which account these trades belong to.');
      return;
    }
    if (trades.length === 0) {
      Alert.alert('No trades', 'Add at least one trade to submit.');
      return;
    }
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      for (const t of trades) {
        await apiPost('/activities', {
          accountId: parseInt(accountId),
          symbol: t.symbol.trim().toUpperCase() || undefined,
          activityType: t.activityType,
          quantity: t.quantity ? parseFloat(t.quantity) : undefined,
          price: t.price ? parseFloat(t.price) : undefined,
          notes: t.notes || undefined,
          tradeDate: dateToAPI(t.tradeDate),
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      closeModal();
      await refreshAll();
    } catch {
      Alert.alert('Error', 'Failed to log some activities. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = (id: number) => {
    Alert.alert('Delete Activity', 'Remove this activity log?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await apiDelete(`/activities/${id}`);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            await refreshAll();
          } catch { Alert.alert('Error', 'Failed to delete'); }
        }
      }
    ]);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getAccountName = (id: number) => accounts.find(a => a.id === id)?.name || 'Unknown';

  const renderItem = ({ item }: { item: TradeActivity }) => {
    const cfg = ACTIVITY_ICONS[item.activityType] || ACTIVITY_ICONS.note;
    return (
      <Card style={styles.activityCard}>
        <View style={styles.activityRow}>
          <View style={[styles.iconWrapper, { backgroundColor: `${cfg.color}20` }]}>
            <Feather name={cfg.icon} size={18} color={cfg.color} />
          </View>
          <View style={styles.activityInfo}>
            <View style={styles.activityTopRow}>
              <Text style={styles.activityType}>{item.activityType.toUpperCase()}</Text>
              {item.symbol && <Text style={styles.activitySymbol}>{item.symbol}</Text>}
              <Text style={styles.activityDate}>{formatDate(item.tradeDate)}</Text>
            </View>
            <Text style={styles.accountName}>{getAccountName(item.accountId)}</Text>
            {(item.quantity || item.price) && (
              <Text style={styles.activityDetails}>
                {item.quantity && `${item.quantity} shares`}
                {item.quantity && item.price && ' @ '}
                {item.price && `$${item.price.toFixed(2)}`}
                {item.totalAmount && ` = $${item.totalAmount.toFixed(2)}`}
              </Text>
            )}
            {item.notes && <Text style={styles.activityNotes}>{item.notes}</Text>}
          </View>
          <Pressable onPress={() => handleDelete(item.id)} style={styles.deleteBtn}>
            <Feather name="trash-2" size={15} color={colors.textMuted} />
          </Pressable>
        </View>
      </Card>
    );
  };

  // ─── Render parsed trade card (editable) ────────────────────────────────────
  const renderTradeCard = (t: ParsedTrade) => (
    <View key={t._key} style={styles.tradeCard}>
      <View style={styles.tradeCardHeader}>
        <View style={styles.typeRow}>
          {ACTIVITY_TYPES.map(type => (
            <Pressable
              key={type}
              style={[styles.typeChip, t.activityType === type && styles.typeChipSelected]}
              onPress={() => updateParsedTrade(t._key, 'activityType', type)}
            >
              <Text style={[styles.typeChipText, t.activityType === type && styles.typeChipTextSelected]}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => removeParsedTrade(t._key)} style={styles.tradeDeleteBtn}>
          <Feather name="x" size={16} color={colors.negative} />
        </Pressable>
      </View>
      <View style={styles.tradeInputRow}>
        <TextInput
          style={[styles.tradeInput, { flex: 1 }]}
          placeholder="Symbol"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          value={t.symbol}
          onChangeText={v => updateParsedTrade(t._key, 'symbol', v)}
        />
        <TextInput
          style={[styles.tradeInput, { flex: 1, marginLeft: 8 }]}
          placeholder="Date (YYYY-MM-DD)"
          placeholderTextColor={colors.textMuted}
          value={t.tradeDate}
          onChangeText={v => updateParsedTrade(t._key, 'tradeDate', v)}
        />
      </View>
      <View style={styles.tradeInputRow}>
        <TextInput
          style={[styles.tradeInput, { flex: 1 }]}
          placeholder="Qty"
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          value={t.quantity}
          onChangeText={v => updateParsedTrade(t._key, 'quantity', v)}
        />
        <TextInput
          style={[styles.tradeInput, { flex: 1, marginLeft: 8 }]}
          placeholder="Price $"
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          value={t.price}
          onChangeText={v => updateParsedTrade(t._key, 'price', v)}
        />
      </View>
      <TextInput
        style={styles.tradeInput}
        placeholder="Notes (optional)"
        placeholderTextColor={colors.textMuted}
        value={t.notes}
        onChangeText={v => updateParsedTrade(t._key, 'notes', v)}
      />
    </View>
  );

  // ─── Shared account picker (used in both steps) ───────────────────────────
  const AccountPicker = () => (
    <View>
      <Text style={styles.stepLabel}>Select Account</Text>
      {detectedAccount && (
        <Text style={styles.detectedHint}>
          <Feather name="cpu" size={11} color={colors.primary} /> Detected: {detectedAccount}
        </Text>
      )}
      <View style={styles.accountChips}>
        {accounts.map(a => (
          <Pressable
            key={a.id}
            style={[styles.accountChip, selectedAccountId === a.id.toString() && styles.accountChipSelected]}
            onPress={() => setSelectedAccountId(a.id.toString())}
          >
            <Text style={[styles.accountChipText, selectedAccountId === a.id.toString() && styles.accountChipTextSelected]}>
              {a.name}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Activity</Text>
        <Pressable style={styles.addBtn} onPress={() => { Haptics.selectionAsync(); openModal(); }}>
          <Feather name="plus" size={20} color={colors.background} />
        </Pressable>
      </View>

      {isLoading && activities.length === 0 ? (
        <View style={{ paddingHorizontal: 16 }}>
          {[1, 2, 3].map(i => <View key={i} style={{ marginBottom: 10 }}><Skeleton height={72} /></View>)}
        </View>
      ) : (
        <FlatList
          data={activities}
          keyExtractor={item => item.id.toString()}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refreshAll} tintColor={colors.primary} />}
          contentContainerStyle={[styles.list, { paddingBottom: Platform.OS === 'web' ? 100 : (insets.bottom + 90) }]}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="activity" size={48} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No activity logged</Text>
              <Text style={styles.emptyText}>Log your trades, deposits and dividends</Text>
            </View>
          }
        />
      )}

      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />

            {/* ── Step: Account Selection ── */}
            {step === 'account' && (
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <View style={styles.modalTitleRow}>
                  <Text style={styles.modalTitle}>Log Activity</Text>
                  <Pressable style={styles.closeBtn} onPress={closeModal}>
                    <Feather name="x" size={20} color={colors.textMuted} />
                  </Pressable>
                </View>

                <AccountPicker />

                <View style={styles.actionButtons}>
                  <Pressable
                    style={[styles.actionBtn, styles.actionBtnSecondary]}
                    onPress={() => { setStep('manual'); setManualForm(emptyManual); }}
                  >
                    <Feather name="edit-3" size={18} color={colors.textSecondary} />
                    <Text style={styles.actionBtnSecondaryText}>Manual Entry</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.actionBtn, styles.actionBtnPrimary]}
                    onPress={handlePickImage}
                  >
                    <Feather name="camera" size={18} color={colors.background} />
                    <Text style={styles.actionBtnPrimaryText}>Scan Screenshot</Text>
                  </Pressable>
                </View>
              </ScrollView>
            )}

            {/* ── Step: Manual Entry ── */}
            {step === 'manual' && (
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <View style={styles.modalTitleRow}>
                  <Pressable onPress={() => setStep('account')} style={styles.backBtn}>
                    <Feather name="arrow-left" size={18} color={colors.textSecondary} />
                  </Pressable>
                  <Text style={styles.modalTitle}>Manual Entry</Text>
                  <Pressable style={styles.closeBtn} onPress={closeModal}>
                    <Feather name="x" size={20} color={colors.textMuted} />
                  </Pressable>
                </View>

                <AccountPicker />

                <Text style={styles.fieldLabel}>Type</Text>
                <View style={styles.pickerRow}>
                  {ACTIVITY_TYPES.map(t => (
                    <Pressable
                      key={t}
                      style={[styles.chip, manualForm.activityType === t && styles.chipSelected]}
                      onPress={() => setManualForm(f => ({ ...f, activityType: t }))}
                    >
                      <Text style={[styles.chipText, manualForm.activityType === t && styles.chipTextSelected]}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <TextInput style={styles.input} placeholder="Symbol (e.g. AAPL)" placeholderTextColor={colors.textMuted} autoCapitalize="characters" value={manualForm.symbol} onChangeText={v => setManualForm(f => ({ ...f, symbol: v }))} />
                <View style={styles.row}>
                  <TextInput style={[styles.input, { flex: 1 }]} placeholder="Qty" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" value={manualForm.quantity} onChangeText={v => setManualForm(f => ({ ...f, quantity: v }))} />
                  <TextInput style={[styles.input, { flex: 1, marginLeft: 8 }]} placeholder="Price $" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" value={manualForm.price} onChangeText={v => setManualForm(f => ({ ...f, price: v }))} />
                </View>
                <TextInput style={styles.input} placeholder="Notes (optional)" placeholderTextColor={colors.textMuted} value={manualForm.notes} onChangeText={v => setManualForm(f => ({ ...f, notes: v }))} />
                <TextInput style={styles.input} placeholder="Date (YYYY-MM-DD)" placeholderTextColor={colors.textMuted} value={manualForm.tradeDate} onChangeText={v => setManualForm(f => ({ ...f, tradeDate: v }))} />

                <View style={styles.modalButtons}>
                  <Pressable style={styles.cancelBtn} onPress={() => setStep('account')}>
                    <Text style={styles.cancelText}>Back</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.saveBtn, isSubmitting && { opacity: 0.6 }]}
                    onPress={() => submitTrades([manualForm], selectedAccountId)}
                    disabled={isSubmitting}
                  >
                    <Text style={styles.saveText}>{isSubmitting ? 'Logging…' : 'Log Activity'}</Text>
                  </Pressable>
                </View>
              </ScrollView>
            )}

            {/* ── Step: Review Parsed Trades ── */}
            {step === 'review' && (
              <View style={{ flex: 1 }}>
                <View style={styles.modalTitleRow}>
                  <Pressable onPress={() => { setStep('account'); setPreviewUri(null); }} style={styles.backBtn}>
                    <Feather name="arrow-left" size={18} color={colors.textSecondary} />
                  </Pressable>
                  <Text style={styles.modalTitle}>
                    {isParsing ? 'Scanning…' : `${parsedTrades.length} Trade${parsedTrades.length !== 1 ? 's' : ''} Found`}
                  </Text>
                  <Pressable style={styles.closeBtn} onPress={closeModal}>
                    <Feather name="x" size={20} color={colors.textMuted} />
                  </Pressable>
                </View>

                {isParsing ? (
                  <View style={styles.parsingState}>
                    {previewUri && <Image source={{ uri: previewUri }} style={styles.parsingThumb} />}
                    <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 20 }} />
                    <Text style={styles.parsingText}>Claude is reading your screenshot…</Text>
                  </View>
                ) : (
                  <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                    {previewUri && (
                      <View style={styles.previewRow}>
                        <Image source={{ uri: previewUri }} style={styles.previewThumb} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.previewLabel}>Scanned screenshot</Text>
                          {detectedAccount && (
                            <Text style={styles.detectedHint}>
                              <Feather name="cpu" size={11} color={colors.primary} /> Detected: {detectedAccount}
                            </Text>
                          )}
                        </View>
                      </View>
                    )}

                    <AccountPicker />

                    <Text style={styles.fieldLabel}>Review & Edit Trades</Text>
                    {parsedTrades.map(t => renderTradeCard(t))}

                    <Pressable
                      style={styles.addTradeBtn}
                      onPress={() => setParsedTrades(ts => [...ts, { ...emptyManual, _key: `new_${Date.now()}` }])}
                    >
                      <Feather name="plus" size={14} color={colors.primary} />
                      <Text style={styles.addTradeBtnText}>Add another trade</Text>
                    </Pressable>

                    <View style={styles.modalButtons}>
                      <Pressable style={styles.cancelBtn} onPress={() => { setStep('account'); setPreviewUri(null); }}>
                        <Text style={styles.cancelText}>Back</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.saveBtn, (isSubmitting || parsedTrades.length === 0) && { opacity: 0.6 }]}
                        onPress={() => submitTrades(parsedTrades, selectedAccountId)}
                        disabled={isSubmitting || parsedTrades.length === 0}
                      >
                        <Text style={styles.saveText}>
                          {isSubmitting ? 'Importing…' : `Import ${parsedTrades.length} Trade${parsedTrades.length !== 1 ? 's' : ''}`}
                        </Text>
                      </Pressable>
                    </View>
                  </ScrollView>
                )}
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12, paddingTop: 4 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, color: colors.textPrimary },
  addBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 16 },
  activityCard: { marginBottom: 8, padding: 12 },
  activityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconWrapper: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  activityInfo: { flex: 1 },
  activityTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  activityType: { fontFamily: 'Inter_700Bold', fontSize: 12, color: colors.textPrimary, letterSpacing: 0.5 },
  activitySymbol: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.primary },
  activityDate: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted },
  accountName: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  activityDetails: { fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.textPrimary, marginTop: 2 },
  activityNotes: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textMuted, marginTop: 2 },
  deleteBtn: { padding: 4 },
  emptyState: { alignItems: 'center', paddingTop: 100, gap: 12 },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18, color: colors.textSecondary },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textMuted, textAlign: 'center', paddingHorizontal: 40 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' },
  modalHandle: { width: 36, height: 4, backgroundColor: colors.separator, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, color: colors.textPrimary, flex: 1, textAlign: 'center' },
  backBtn: { padding: 4, marginRight: 4 },
  closeBtn: { padding: 4 },
  // Account picker
  stepLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: colors.textSecondary, marginBottom: 10 },
  accountChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  accountChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: colors.separator, backgroundColor: colors.surfaceElevated },
  accountChipSelected: { borderColor: colors.primary, backgroundColor: 'rgba(0,212,255,0.12)' },
  accountChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: colors.textSecondary },
  accountChipTextSelected: { color: colors.primary },
  detectedHint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.primary, marginBottom: 12 },
  // Action buttons
  actionButtons: { flexDirection: 'row', gap: 10, marginTop: 20 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: 14 },
  actionBtnSecondary: { borderWidth: 1, borderColor: colors.separator, backgroundColor: colors.surfaceElevated },
  actionBtnPrimary: { backgroundColor: colors.primary },
  actionBtnSecondaryText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: colors.textSecondary },
  actionBtnPrimaryText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: colors.background },
  // Parsing state
  parsingState: { alignItems: 'center', paddingVertical: 40 },
  parsingThumb: { width: 120, height: 120, borderRadius: 12, backgroundColor: colors.surfaceElevated },
  parsingText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textSecondary, marginTop: 12 },
  // Preview row
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,212,255,0.06)', borderRadius: 10, padding: 10, marginBottom: 16 },
  previewThumb: { width: 52, height: 52, borderRadius: 6, backgroundColor: colors.surfaceElevated },
  previewLabel: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textSecondary },
  // Trade review cards
  tradeCard: { backgroundColor: colors.surfaceElevated, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.separator },
  tradeCardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, flex: 1 },
  typeChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 16, borderWidth: 1, borderColor: colors.separator },
  typeChipSelected: { borderColor: colors.primary, backgroundColor: 'rgba(0,212,255,0.12)' },
  typeChipText: { fontFamily: 'Inter_500Medium', fontSize: 11, color: colors.textMuted },
  typeChipTextSelected: { color: colors.primary },
  tradeDeleteBtn: { padding: 4, marginLeft: 4 },
  tradeInputRow: { flexDirection: 'row', marginBottom: 8 },
  tradeInput: { backgroundColor: colors.surface, borderRadius: 8, padding: 10, color: colors.textPrimary, fontFamily: 'Inter_400Regular', fontSize: 14, borderWidth: 1, borderColor: colors.separator, marginBottom: 8 },
  addTradeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', paddingVertical: 10, marginBottom: 12 },
  addTradeBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.primary },
  // Manual form
  fieldLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.textSecondary, marginBottom: 8, marginTop: 4 },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.separator, backgroundColor: colors.surfaceElevated },
  chipSelected: { borderColor: colors.primary, backgroundColor: 'rgba(0,212,255,0.1)' },
  chipText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.textSecondary },
  chipTextSelected: { color: colors.primary },
  input: { backgroundColor: colors.surfaceElevated, borderRadius: 12, padding: 14, color: colors.textPrimary, fontFamily: 'Inter_400Regular', fontSize: 15, marginBottom: 12, borderWidth: 1, borderColor: colors.separator },
  row: { flexDirection: 'row' },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 8, marginBottom: 8 },
  cancelBtn: { flex: 1, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.separator, alignItems: 'center' },
  cancelText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.textSecondary },
  saveBtn: { flex: 2, padding: 16, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center' },
  saveText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.background },
});
