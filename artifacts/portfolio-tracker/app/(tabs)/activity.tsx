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

const API_BASE = `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;

const ACTIVITY_ICONS: Record<string, { icon: any; color: string }> = {
  buy: { icon: 'arrow-down-circle', color: colors.positive },
  sell: { icon: 'arrow-up-circle', color: colors.negative },
  dividend: { icon: 'dollar-sign', color: colors.primary },
  deposit: { icon: 'plus-circle', color: colors.longTerm },
  withdrawal: { icon: 'minus-circle', color: colors.swing },
  note: { icon: 'file-text', color: colors.textSecondary },
};

const ACTIVITY_TYPES = ['buy', 'sell', 'dividend', 'deposit', 'withdrawal', 'note'];

export default function ActivityScreen() {
  const insets = useSafeAreaInsets();
  const { accounts, activities, isLoading, refreshAll } = usePortfolio();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const [showAdd, setShowAdd] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedImage, setParsedImage] = useState<string | null>(null);
  const emptyForm = {
    accountId: '',
    symbol: '',
    activityType: 'buy',
    quantity: '',
    price: '',
    notes: '',
    tradeDate: new Date().toISOString().split('T')[0],
  };
  const [form, setForm] = useState(emptyForm);

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to upload trade screenshots.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (!asset.base64) return;
    setIsParsing(true);
    setParsedImage(asset.uri);
    try {
      const resp = await fetch(`${API_BASE}/anthropic/parse-screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: asset.base64,
          mediaType: asset.mimeType || 'image/jpeg',
        }),
      });
      const data = await resp.json();
      const trades: any[] = data.trades || [];
      if (trades.length > 0) {
        const t = trades[0];
        setForm(f => ({
          ...f,
          symbol: t.symbol || f.symbol,
          activityType: t.activityType || f.activityType,
          quantity: t.quantity ? String(t.quantity) : f.quantity,
          price: t.price ? String(t.price) : f.price,
          notes: t.notes || f.notes,
          tradeDate: t.tradeDate || f.tradeDate,
        }));
        if (trades.length > 1) {
          Alert.alert('Multiple trades found', `Found ${trades.length} trades. Showing the first one. Add it and repeat for others.`);
        }
      } else {
        Alert.alert('No trades found', 'Claude could not extract trade details from this image. Try a clearer screenshot.');
      }
    } catch {
      Alert.alert('Error', 'Failed to parse screenshot.');
    } finally {
      setIsParsing(false);
    }
  };

  useEffect(() => {
    refreshAll();
  }, []);

  const handleAdd = async () => {
    if (!form.accountId || !form.activityType) {
      Alert.alert('Missing fields', 'Please select an account and activity type');
      return;
    }
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      await apiPost('/activities', {
        accountId: parseInt(form.accountId),
        symbol: form.symbol || undefined,
        activityType: form.activityType,
        quantity: form.quantity ? parseFloat(form.quantity) : undefined,
        price: form.price ? parseFloat(form.price) : undefined,
        notes: form.notes || undefined,
        tradeDate: new Date(form.tradeDate).toISOString(),
      });
      setShowAdd(false);
      setForm(emptyForm);
      setParsedImage(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refreshAll();
    } catch {
      Alert.alert('Error', 'Failed to log activity');
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
          } catch {
            Alert.alert('Error', 'Failed to delete');
          }
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

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Activity</Text>
        <Pressable style={styles.addBtn} onPress={() => { Haptics.selectionAsync(); setShowAdd(true); }}>
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

      <Modal visible={showAdd} animationType="slide" transparent presentationStyle="pageSheet">
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalTitleRow}>
              <Text style={styles.modalTitle}>Log Activity</Text>
              <Pressable style={styles.scanBtn} onPress={handlePickImage} disabled={isParsing}>
                {isParsing
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <><Feather name="camera" size={15} color={colors.primary} /><Text style={styles.scanBtnText}>Scan</Text></>
                }
              </Pressable>
            </View>

            {parsedImage && (
              <View style={styles.parsedImageRow}>
                <Image source={{ uri: parsedImage }} style={styles.parsedThumb} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.parsedLabel}>
                    {isParsing ? 'Parsing with AI…' : 'Form pre-filled from screenshot'}
                  </Text>
                  <Pressable onPress={() => { setParsedImage(null); }}>
                    <Text style={styles.parsedClear}>Clear</Text>
                  </Pressable>
                </View>
              </View>
            )}

            <Text style={styles.fieldLabel}>Account</Text>
            <View style={styles.pickerRow}>
              {accounts.map(a => (
                <Pressable
                  key={a.id}
                  style={[styles.chip, form.accountId === a.id.toString() && styles.chipSelected]}
                  onPress={() => setForm(f => ({ ...f, accountId: a.id.toString() }))}
                >
                  <Text style={[styles.chipText, form.accountId === a.id.toString() && styles.chipTextSelected]}>
                    {a.name}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Type</Text>
            <View style={styles.pickerRow}>
              {ACTIVITY_TYPES.map(t => (
                <Pressable
                  key={t}
                  style={[styles.chip, form.activityType === t && styles.chipSelected]}
                  onPress={() => setForm(f => ({ ...f, activityType: t }))}
                >
                  <Text style={[styles.chipText, form.activityType === t && styles.chipTextSelected]}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <TextInput style={styles.input} placeholder="Symbol (e.g. AAPL)" placeholderTextColor={colors.textMuted} autoCapitalize="characters" value={form.symbol} onChangeText={t => setForm(f => ({ ...f, symbol: t }))} />
            <View style={styles.row}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Qty" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" value={form.quantity} onChangeText={t => setForm(f => ({ ...f, quantity: t }))} />
              <TextInput style={[styles.input, { flex: 1, marginLeft: 8 }]} placeholder="Price" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" value={form.price} onChangeText={t => setForm(f => ({ ...f, price: t }))} />
            </View>
            <TextInput style={styles.input} placeholder="Notes (optional)" placeholderTextColor={colors.textMuted} value={form.notes} onChangeText={t => setForm(f => ({ ...f, notes: t }))} />
            <TextInput style={styles.input} placeholder="Date (YYYY-MM-DD)" placeholderTextColor={colors.textMuted} value={form.tradeDate} onChangeText={t => setForm(f => ({ ...f, tradeDate: t }))} />

            <View style={styles.modalButtons}>
              <Pressable style={styles.cancelBtn} onPress={() => setShowAdd(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.saveBtn, isSubmitting && { opacity: 0.6 }]} onPress={handleAdd} disabled={isSubmitting}>
                <Text style={styles.saveText}>{isSubmitting ? 'Logging…' : 'Log Activity'}</Text>
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
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  modalHandle: { width: 36, height: 4, backgroundColor: colors.separator, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, color: colors.textPrimary },
  scanBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.primary },
  scanBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.primary },
  parsedImageRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,212,255,0.06)', borderRadius: 10, padding: 10, marginBottom: 12 },
  parsedThumb: { width: 52, height: 52, borderRadius: 6, backgroundColor: colors.surfaceElevated },
  parsedLabel: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textSecondary },
  parsedClear: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: colors.primary, marginTop: 4 },
  fieldLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.textSecondary, marginBottom: 8 },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.separator, backgroundColor: colors.surfaceElevated },
  chipSelected: { borderColor: colors.primary, backgroundColor: 'rgba(0,212,255,0.1)' },
  chipText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.textSecondary },
  chipTextSelected: { color: colors.primary },
  input: { backgroundColor: colors.surfaceElevated, borderRadius: 12, padding: 14, color: colors.textPrimary, fontFamily: 'Inter_400Regular', fontSize: 15, marginBottom: 12, borderWidth: 1, borderColor: colors.separator },
  row: { flexDirection: 'row' },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.separator, alignItems: 'center' },
  cancelText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.textSecondary },
  saveBtn: { flex: 2, padding: 16, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center' },
  saveText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.background },
});
