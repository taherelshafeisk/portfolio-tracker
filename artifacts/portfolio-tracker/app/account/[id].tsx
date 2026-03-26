import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Modal, TextInput, Alert, Platform, RefreshControl,
  ActivityIndicator, Image,
} from 'react-native';
import { useLocalSearchParams, router, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '@/constants/colors';
import { usePortfolio, apiGet, apiPost, apiPut, apiDelete, Position, Account } from '@/context/PortfolioContext';
import { Card } from '@/components/ui/Card';
import { PnlBadge, formatCurrency } from '@/components/ui/PnlBadge';
import { AccountTypeBadge } from '@/components/ui/AccountTypeBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { StockLogo } from '@/components/ui/StockLogo';

const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? process.env.EXPO_PUBLIC_DOMAIN.includes('localhost')
    ? `http://${process.env.EXPO_PUBLIC_DOMAIN}/api`
    : `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`
  : '/api';

interface SymbolResult {
  symbol: string;
  name: string;
  type: string;
  exchange?: string;
}

interface ParsedPosition {
  _key: string;
  symbol: string;
  name: string;
  quantity: string;
  avgCost: string;
  sector: string;
  notes: string;
}

export default function AccountDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const accountId = parseInt(id);
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { accounts, positions: allPositions, refreshAll } = usePortfolio();

  const account = accounts.find(a => a.id === accountId);
  const positions = allPositions
    .filter(p => p.accountId === accountId)
    .sort((a, b) => b.marketValue - a.marketValue);

  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAddPos, setShowAddPos] = useState(false);
  const [form, setForm] = useState({ symbol: '', name: '', quantity: '', avgCost: '', sector: '', notes: '' });

  // Symbol search autocomplete
  const [symbolResults, setSymbolResults] = useState<SymbolResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Portfolio screenshot import
  const [showImport, setShowImport] = useState(false);
  const [importPositions, setImportPositions] = useState<ParsedPosition[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState<{ current: number; total: number } | null>(null);
  const [importImageUri, setImportImageUri] = useState<string | null>(null);
  const [importAccountHint, setImportAccountHint] = useState<string | null>(null);
  const [importCashBalance, setImportCashBalance] = useState<number | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [confirmPos, setConfirmPos] = useState<{ id: number; symbol: string } | null>(null);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [pendingValid, setPendingValid] = useState<ParsedPosition[]>([]);
  const [pendingDuplicates, setPendingDuplicates] = useState<ParsedPosition[]>([]);

  useEffect(() => {
    if (account) navigation.setOptions({ title: account.name });
  }, [account]);

  useEffect(() => {
    const q = form.symbol.trim();
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.length < 1) { setSymbolResults([]); return; }
    setIsSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const data = await apiGet<SymbolResult[]>(`/market/search?q=${encodeURIComponent(q)}`);
        setSymbolResults(data || []);
      } catch {
        setSymbolResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [form.symbol]);

  const selectSymbol = (result: SymbolResult) => {
    setForm(f => ({ ...f, symbol: result.symbol, name: result.name }));
    setSymbolResults([]);
  };

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
      setSymbolResults([]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refreshAll();
    } catch {
      Alert.alert('Error', 'Failed to add position');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeletePos = (posId: number, symbol: string) => {
    setConfirmPos({ id: posId, symbol });
  };

  const doDeletePos = async () => {
    if (!confirmPos) return;
    const { id } = confirmPos;
    setConfirmPos(null);
    try {
      await apiDelete(`/positions/${id}`);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await refreshAll();
    } catch {
      Alert.alert('Error', 'Failed to delete');
    }
  };

  // ─── Portfolio Screenshot Import ─────────────────────────────────────────────
  // Parse a list of image assets and merge into importPositions
  const parseAssets = async (assets: ImagePicker.ImagePickerAsset[], append = false) => {
    setIsParsing(true);
    setParseProgress({ current: 0, total: assets.length });

    const newPositions: ParsedPosition[] = [];
    let hint: string | null = null;
    let cash: number | null = null;

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      setParseProgress({ current: i + 1, total: assets.length });
      if (!asset.base64) continue;
      try {
        const resp = await fetch(`${API_BASE}/anthropic/parse-screenshot`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: asset.base64,
            mediaType: asset.mimeType || 'image/jpeg',
            parseType: 'positions',
          }),
        });
        const data = await resp.json();
        if (!resp.ok) continue;
        if (data.positions?.length) {
          newPositions.push(...data.positions.map((p: any, idx: number) => ({
            _key: `p${i}_${idx}_${Date.now()}`,
            symbol: p.symbol || '',
            name: p.name || '',
            quantity: p.quantity != null ? String(p.quantity) : '',
            avgCost: p.avgCost != null ? String(p.avgCost) : '',
            sector: p.sector || '',
            notes: p.notes || '',
          })));
        }
        if (!hint && data.accountHint) hint = data.accountHint;
        if (cash == null && data.cashBalance != null) cash = Number(data.cashBalance);
      } catch { /* skip failed image */ }
    }

    setIsParsing(false);
    setParseProgress(null);

    if (newPositions.length === 0 && !append) {
      Alert.alert('No positions found', 'Could not detect holdings. Try a clearer screenshot.');
      setShowImport(false);
      setImportImageUri(null);
      return;
    }

    if (append) {
      // Merge: new symbols overwrite existing ones with same symbol
      setImportPositions(prev => {
        const merged = [...prev];
        for (const np of newPositions) {
          const idx = merged.findIndex(p => p.symbol.toUpperCase() === np.symbol.toUpperCase());
          if (idx >= 0) merged[idx] = np; else merged.push(np);
        }
        return merged;
      });
    } else {
      // Deduplicate within the batch (last occurrence wins)
      const symbolMap = new Map<string, ParsedPosition>();
      for (const p of newPositions) symbolMap.set(p.symbol.toUpperCase(), p);
      setImportPositions(Array.from(symbolMap.values()));
      if (hint) setImportAccountHint(hint);
      if (cash != null) setImportCashBalance(cash);
    }
  };

  const handlePickPortfolioImage = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo access to upload portfolio screenshots.');
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.7,
      allowsMultipleSelection: true,
    });
    if (result.canceled || !result.assets.length) return;

    setImportImageUri(result.assets[0].uri);
    setImportPositions([]);
    setShowImport(true);
    await parseAssets(result.assets, false);
  };

  const handleAddMoreScreenshots = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      base64: true,
      quality: 0.7,
      allowsMultipleSelection: true,
    });
    if (result.canceled || !result.assets.length) return;
    await parseAssets(result.assets, true);
  };

  const updateImportPos = (key: string, field: keyof ParsedPosition, val: string) => {
    setImportPositions(ps => ps.map(p => p._key === key ? { ...p, [field]: val } : p));
  };

  const removeImportPos = (key: string) => {
    setImportPositions(ps => ps.filter(p => p._key !== key));
  };

  const doImport = async (posToImport: ParsedPosition[]) => {
    setIsImporting(true);
    try {
      for (const p of posToImport) {
        await apiPost('/positions', {
          accountId,
          symbol: p.symbol.toUpperCase(),
          name: p.name || p.symbol,
          quantity: parseFloat(p.quantity),
          avgCost: parseFloat(p.avgCost),
          sector: p.sector || undefined,
          notes: p.notes || undefined,
        });
      }
      if (importCashBalance != null) {
        await fetch(`${API_BASE}/accounts/${accountId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentBalance: importCashBalance }),
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowImport(false);
      setImportImageUri(null);
      setImportPositions([]);
      setImportCashBalance(null);
      await refreshAll();
    } catch {
      Alert.alert('Error', 'Failed to import some positions.');
    } finally {
      setIsImporting(false);
    }
  };

  const doImportWithOverwrite = async (allValid: ParsedPosition[], duplicates: ParsedPosition[]) => {
    setIsImporting(true);
    try {
      const dupSymbols = new Set(duplicates.map(d => d.symbol.toUpperCase()));
      // Overwrite existing positions
      for (const p of duplicates) {
        const existing = positions.find(pos => pos.symbol.toUpperCase() === p.symbol.toUpperCase());
        if (existing) {
          await apiPut(`/positions/${existing.id}`, {
            quantity: parseFloat(p.quantity),
            avgCost: parseFloat(p.avgCost),
          });
        }
      }
      // Create new positions
      for (const p of allValid.filter(p => !dupSymbols.has(p.symbol.toUpperCase()))) {
        await apiPost('/positions', {
          accountId,
          symbol: p.symbol.toUpperCase(),
          name: p.name || p.symbol,
          quantity: parseFloat(p.quantity),
          avgCost: parseFloat(p.avgCost),
          sector: p.sector || undefined,
          notes: p.notes || undefined,
        });
      }
      if (importCashBalance != null) {
        await fetch(`${API_BASE}/accounts/${accountId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentBalance: importCashBalance }),
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowImport(false);
      setImportImageUri(null);
      setImportPositions([]);
      setImportCashBalance(null);
      await refreshAll();
    } catch {
      Alert.alert('Error', 'Failed to import some positions.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportAll = () => {
    const valid = importPositions.filter(p => p.symbol && p.quantity && p.avgCost);
    if (valid.length === 0) {
      Alert.alert('Missing data', 'Each position needs at least a symbol, quantity, and average cost.');
      return;
    }
    if (isImporting) return;

    const existingSymbols = new Set(positions.map(p => p.symbol.toUpperCase()));
    const duplicates = valid.filter(p => existingSymbols.has(p.symbol.toUpperCase()));

    if (duplicates.length > 0) {
      setPendingValid(valid);
      setPendingDuplicates(duplicates);
      setShowDuplicateModal(true);
    } else {
      doImport(valid);
    }
  };

  // Computed import summary
  const importNav = importPositions.reduce((sum, p) => {
    const qty = parseFloat(p.quantity) || 0;
    const cost = parseFloat(p.avgCost) || 0;
    return sum + qty * cost;
  }, 0);
  const validImportCount = importPositions.filter(p => p.symbol && p.quantity && p.avgCost).length;

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refreshAll} tintColor={colors.primary} />}
        contentContainerStyle={[styles.scroll, { paddingBottom: Platform.OS === 'web' ? 40 : (insets.bottom + 24) }]}
      >
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

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Positions</Text>
          <View style={styles.sectionActions}>
            <Pressable style={styles.importBtn} onPress={handlePickPortfolioImage}>
              <Feather name="upload" size={14} color={colors.textSecondary} />
              <Text style={styles.importBtnText}>Import</Text>
            </Pressable>
            <Pressable style={styles.addBtn} onPress={() => { Haptics.selectionAsync(); setShowAddPos(true); }}>
              <Feather name="plus" size={16} color={colors.background} />
              <Text style={styles.addBtnText}>Add</Text>
            </Pressable>
          </View>
        </View>

        {positions.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Feather name="layers" size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>No positions yet.</Text>
            <Text style={styles.emptySubText}>Tap Import to scan your portfolio screenshot, or Add to enter manually.</Text>
          </Card>
        ) : (
          positions.map(pos => {
            const isPos = pos.unrealizedPnl >= 0;
            return (
              <Card key={pos.id} style={styles.posCard}>
                <View style={styles.posHeader}>
                  <Pressable
                    onPress={() => router.push({ pathname: '/chart/[symbol]', params: { symbol: pos.symbol } })}
                    style={styles.posLeft}
                  >
                    <StockLogo symbol={pos.symbol} size={38} />
                    <View>
                      <Text style={styles.posSymbol}>{pos.symbol}</Text>
                      <Text style={styles.posName} numberOfLines={1}>{pos.name}</Text>
                    </View>
                  </Pressable>
                  <View style={styles.posRight}>
                    <Text style={styles.posValue}>{formatCurrency(pos.marketValue)}</Text>
                    <Pressable
                      onPress={() => handleDeletePos(pos.id, pos.symbol)}
                      style={styles.deleteBtn}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Feather name="trash-2" size={14} color={colors.textMuted} />
                    </Pressable>
                  </View>
                </View>
                <View style={styles.posStats}>
                  <View style={styles.posStat}><Text style={styles.posStatLabel}>Qty</Text><Text style={styles.posStatVal}>{pos.quantity}</Text></View>
                  <View style={styles.posStat}><Text style={styles.posStatLabel}>Avg Cost</Text><Text style={styles.posStatVal}>${pos.avgCost.toFixed(2)}</Text></View>
                  <View style={styles.posStat}><Text style={styles.posStatLabel}>Last</Text><Text style={styles.posStatVal}>${pos.currentPrice.toFixed(2)}</Text></View>
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

      {/* ── Confirm Delete Position ────────────────────────────────────────── */}
      <Modal visible={!!confirmPos} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { paddingBottom: insets.bottom + 16, borderRadius: 20 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Remove Position</Text>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textSecondary, marginBottom: 20 }}>
              Remove {confirmPos?.symbol} from this account? This cannot be undone.
            </Text>
            <View style={styles.modalButtons}>
              <Pressable style={styles.cancelBtn} onPress={() => setConfirmPos(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.saveBtn, { backgroundColor: colors.negative }]} onPress={doDeletePos}>
                <Text style={styles.saveText}>Remove</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Add Position Modal ─────────────────────────────────────────────── */}
      <Modal visible={showAddPos} animationType="slide" transparent presentationStyle="pageSheet">
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Add Position</Text>

            <View style={styles.symbolWrapper}>
              <View style={styles.symbolInputRow}>
                <TextInput
                  style={[styles.input, styles.symbolInput]}
                  placeholder="Symbol (e.g. AAPL)"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="characters"
                  value={form.symbol}
                  onChangeText={t => setForm(f => ({ ...f, symbol: t, name: t ? f.name : '' }))}
                />
                {isSearching && <ActivityIndicator size="small" color={colors.primary} style={styles.searchSpinner} />}
              </View>
              {symbolResults.length > 0 && (
                <View style={styles.dropdown}>
                  {symbolResults.map(r => (
                    <Pressable key={r.symbol} style={styles.dropdownItem} onPress={() => selectSymbol(r)}>
                      <Text style={styles.dropdownSymbol}>{r.symbol}</Text>
                      <Text style={styles.dropdownName} numberOfLines={1}>{r.name}</Text>
                      <Text style={styles.dropdownType}>{r.type}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            <TextInput style={styles.input} placeholder="Company name" placeholderTextColor={colors.textMuted} value={form.name} onChangeText={t => setForm(f => ({ ...f, name: t }))} />
            <View style={styles.inputRow}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Quantity" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" value={form.quantity} onChangeText={t => setForm(f => ({ ...f, quantity: t }))} />
              <TextInput style={[styles.input, { flex: 1, marginLeft: 8 }]} placeholder="Avg cost ($)" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" value={form.avgCost} onChangeText={t => setForm(f => ({ ...f, avgCost: t }))} />
            </View>
            <TextInput style={styles.input} placeholder="Sector (optional)" placeholderTextColor={colors.textMuted} value={form.sector} onChangeText={t => setForm(f => ({ ...f, sector: t }))} />
            <TextInput style={styles.input} placeholder="Notes (optional)" placeholderTextColor={colors.textMuted} value={form.notes} onChangeText={t => setForm(f => ({ ...f, notes: t }))} />

            <View style={styles.modalButtons}>
              <Pressable style={styles.cancelBtn} onPress={() => { setShowAddPos(false); setSymbolResults([]); }}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.saveBtn, isSubmitting && { opacity: 0.6 }]} onPress={handleAddPosition} disabled={isSubmitting}>
                <Text style={styles.saveText}>{isSubmitting ? 'Adding…' : 'Add Position'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Portfolio Import Modal ─────────────────────────────────────────── */}
      <Modal visible={showImport} animationType="slide" transparent presentationStyle="pageSheet">
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { paddingBottom: insets.bottom + 16, maxHeight: '90%' }]}>
            <View style={styles.modalHandle} />
            <View style={styles.importModalHeader}>
              <Text style={styles.modalTitle}>
                {isParsing ? 'Scanning Portfolio…' : `${importPositions.length} Position${importPositions.length !== 1 ? 's' : ''} Found`}
              </Text>
              <Pressable style={styles.closeBtn} onPress={() => { setShowImport(false); setImportImageUri(null); }}>
                <Feather name="x" size={20} color={colors.textMuted} />
              </Pressable>
            </View>

            {isParsing ? (
              <View style={styles.parsingState}>
                {importImageUri && <Image source={{ uri: importImageUri }} style={styles.parsingThumb} />}
                <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 20 }} />
                <Text style={styles.parsingText}>
                  {parseProgress && parseProgress.total > 1
                    ? `Scanning screenshot ${parseProgress.current} of ${parseProgress.total}…`
                    : 'Claude is reading your portfolio…'}
                </Text>
              </View>
            ) : isImporting ? (
              <View style={styles.parsingState}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.parsingText}>Importing positions… Sit tight</Text>
                <Text style={[styles.parsingText, { fontSize: 12, opacity: 0.6, marginTop: 4 }]}>
                  This may take a moment
                </Text>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {importImageUri && (
                  <View style={styles.previewRow}>
                    <Image source={{ uri: importImageUri }} style={styles.previewThumb} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.previewLabel}>Portfolio screenshot</Text>
                      {importAccountHint && (
                        <Text style={styles.detectedHint}>
                          <Feather name="cpu" size={11} color={colors.primary} /> Detected: {importAccountHint}
                        </Text>
                      )}
                    </View>
                  </View>
                )}

                {/* Import Summary Card */}
                {importPositions.length > 0 && (
                  <View style={styles.importSummaryCard}>
                    <View style={styles.importSummaryStat}>
                      <Text style={styles.importSummaryLabel}>Positions</Text>
                      <Text style={styles.importSummaryVal}>{validImportCount}</Text>
                    </View>
                    <View style={styles.importSummaryDivider} />
                    <View style={styles.importSummaryStat}>
                      <Text style={styles.importSummaryLabel}>Cost Basis</Text>
                      <Text style={styles.importSummaryVal}>{formatCurrency(importNav)}</Text>
                    </View>
                    <View style={styles.importSummaryDivider} />
                    <View style={styles.importSummaryStat}>
                      <Text style={styles.importSummaryLabel}>Cash</Text>
                      <Text style={styles.importSummaryVal}>
                        {importCashBalance != null ? formatCurrency(importCashBalance) : '—'}
                      </Text>
                    </View>
                  </View>
                )}

                <Text style={styles.reviewLabel}>Review & edit before importing</Text>

                {importPositions.map(p => (
                  <View key={p._key} style={styles.importCard}>
                    <View style={styles.importCardHeader}>
                      <Text style={styles.importSymbol}>{p.symbol || 'No symbol'}</Text>
                      <Pressable onPress={() => removeImportPos(p._key)} style={styles.removeBtn}>
                        <Feather name="x" size={15} color={colors.negative} />
                      </Pressable>
                    </View>
                    <TextInput style={styles.importInput} placeholder="Symbol" placeholderTextColor={colors.textMuted} autoCapitalize="characters" value={p.symbol} onChangeText={v => updateImportPos(p._key, 'symbol', v)} />
                    <TextInput style={styles.importInput} placeholder="Company name" placeholderTextColor={colors.textMuted} value={p.name} onChangeText={v => updateImportPos(p._key, 'name', v)} />
                    <View style={styles.importRow}>
                      <TextInput style={[styles.importInput, { flex: 1 }]} placeholder="Quantity" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" value={p.quantity} onChangeText={v => updateImportPos(p._key, 'quantity', v)} />
                      <TextInput style={[styles.importInput, { flex: 1, marginLeft: 8 }]} placeholder="Avg cost ($)" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" value={p.avgCost} onChangeText={v => updateImportPos(p._key, 'avgCost', v)} />
                    </View>
                    <TextInput style={styles.importInput} placeholder="Sector (optional)" placeholderTextColor={colors.textMuted} value={p.sector} onChangeText={v => updateImportPos(p._key, 'sector', v)} />
                  </View>
                ))}

                <View style={styles.modalButtons}>
                  <Pressable style={styles.cancelBtn} onPress={() => { setShowImport(false); setImportImageUri(null); }}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={[styles.cancelBtn, { flexDirection: 'row', gap: 4 }]} onPress={handleAddMoreScreenshots}>
                    <Feather name="plus" size={14} color={colors.textSecondary} />
                    <Text style={styles.cancelText}>Add More</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.saveBtn, (isImporting || importPositions.length === 0) && { opacity: 0.6 }]}
                    onPress={handleImportAll}
                    disabled={isImporting || importPositions.length === 0}
                  >
                    <Text style={styles.saveText}>
                      {isImporting ? 'Importing…' : `Import ${importPositions.length}`}
                    </Text>
                  </Pressable>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Duplicate Resolution Modal (rendered last so it appears on top) ── */}
      <Modal visible={showDuplicateModal} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { paddingBottom: insets.bottom + 16, borderRadius: 20 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Duplicate Positions</Text>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textSecondary, marginBottom: 16 }}>
              {pendingDuplicates.length} symbol{pendingDuplicates.length !== 1 ? 's' : ''} already exist:{' '}
              <Text style={{ color: colors.primary }}>{pendingDuplicates.map(d => d.symbol).join(', ')}</Text>
            </Text>
            <Pressable style={styles.dupOption} onPress={() => { setShowDuplicateModal(false); doImport(pendingValid); }}>
              <Text style={styles.dupOptionTitle}>Proceed As-Is</Text>
              <Text style={styles.dupOptionDesc}>Add all positions, including duplicates</Text>
            </Pressable>
            <Pressable style={styles.dupOption} onPress={() => { setShowDuplicateModal(false); const s = new Set(pendingDuplicates.map(d => d.symbol.toUpperCase())); doImport(pendingValid.filter(p => !s.has(p.symbol.toUpperCase()))); }}>
              <Text style={styles.dupOptionTitle}>Skip Duplicates</Text>
              <Text style={styles.dupOptionDesc}>Only add new positions</Text>
            </Pressable>
            <Pressable style={[styles.dupOption, { borderColor: colors.negative }]} onPress={() => { setShowDuplicateModal(false); doImportWithOverwrite(pendingValid, pendingDuplicates); }}>
              <Text style={[styles.dupOptionTitle, { color: colors.negative }]}>Overwrite Existing</Text>
              <Text style={styles.dupOptionDesc}>Update qty & avg cost for duplicates</Text>
            </Pressable>
            <Pressable style={[styles.cancelBtn, { marginTop: 8 }]} onPress={() => setShowDuplicateModal(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
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
  sectionActions: { flexDirection: 'row', gap: 8 },
  importBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.separator },
  importBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.textSecondary },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  addBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.background },
  emptyCard: { alignItems: 'center', padding: 32, gap: 8 },
  emptyText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: colors.textSecondary },
  emptySubText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  posCard: { marginBottom: 10 },
  posHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  posLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  posSymbol: { fontFamily: 'Inter_700Bold', fontSize: 17, color: colors.textPrimary },
  posName: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textSecondary, marginTop: 1, maxWidth: 160 },
  posRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  posValue: { fontFamily: 'Inter_700Bold', fontSize: 16, color: colors.textPrimary },
  deleteBtn: { padding: 8 },
  posStats: { flexDirection: 'row' },
  posStat: { flex: 1 },
  posStatLabel: { fontFamily: 'Inter_400Regular', fontSize: 10, color: colors.textMuted, marginBottom: 2 },
  posStatVal: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.textPrimary },
  sector: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 8 },
  // Modals
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  modalHandle: { width: 36, height: 4, backgroundColor: colors.separator, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, color: colors.textPrimary, marginBottom: 16, flex: 1 },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.separator, alignItems: 'center' },
  cancelText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.textSecondary },
  saveBtn: { flex: 2, padding: 16, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center' },
  saveText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.background },
  // Add Position
  symbolWrapper: { position: 'relative', zIndex: 10 },
  symbolInputRow: { flexDirection: 'row', alignItems: 'center' },
  symbolInput: { flex: 1 },
  searchSpinner: { position: 'absolute', right: 14 },
  dropdown: { backgroundColor: colors.surfaceElevated, borderRadius: 12, borderWidth: 1, borderColor: colors.separator, overflow: 'hidden', marginBottom: 12, marginTop: -8 },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.separator },
  dropdownSymbol: { fontFamily: 'Inter_700Bold', fontSize: 14, color: colors.primary, width: 64 },
  dropdownName: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textPrimary, flex: 1 },
  dropdownType: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted, marginLeft: 8 },
  inputRow: { flexDirection: 'row' },
  input: { backgroundColor: colors.surfaceElevated, borderRadius: 12, padding: 14, color: colors.textPrimary, fontFamily: 'Inter_400Regular', fontSize: 15, marginBottom: 12, borderWidth: 1, borderColor: colors.separator },
  // Import modal
  importModalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  closeBtn: { padding: 4 },
  parsingState: { alignItems: 'center', paddingVertical: 40 },
  parsingThumb: { width: 120, height: 120, borderRadius: 12, backgroundColor: colors.surfaceElevated },
  parsingText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textSecondary, marginTop: 12 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,212,255,0.06)', borderRadius: 10, padding: 10, marginBottom: 12 },
  previewThumb: { width: 52, height: 52, borderRadius: 6, backgroundColor: colors.surfaceElevated },
  previewLabel: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textSecondary },
  detectedHint: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.primary, marginTop: 2 },
  importSummaryCard: { flexDirection: 'row', backgroundColor: colors.surfaceElevated, borderRadius: 12, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: colors.separator },
  importSummaryStat: { flex: 1, alignItems: 'center' },
  importSummaryLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted, marginBottom: 4 },
  importSummaryVal: { fontFamily: 'Inter_700Bold', fontSize: 15, color: colors.textPrimary },
  importSummaryDivider: { width: 1, backgroundColor: colors.separator },
  reviewLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, color: colors.textSecondary, marginBottom: 10 },
  importCard: { backgroundColor: colors.surfaceElevated, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.separator },
  importCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  importSymbol: { fontFamily: 'Inter_700Bold', fontSize: 15, color: colors.primary },
  removeBtn: { padding: 4 },
  importInput: { backgroundColor: colors.surface, borderRadius: 8, padding: 10, color: colors.textPrimary, fontFamily: 'Inter_400Regular', fontSize: 14, borderWidth: 1, borderColor: colors.separator, marginBottom: 8 },
  importRow: { flexDirection: 'row' },
  dupOption: { borderWidth: 1, borderColor: colors.separator, borderRadius: 12, padding: 14, marginBottom: 10 },
  dupOptionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.textPrimary, marginBottom: 2 },
  dupOptionDesc: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textMuted },
});
