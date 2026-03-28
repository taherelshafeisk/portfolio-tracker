import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Modal, TextInput, Alert, Platform, RefreshControl,
  ActivityIndicator, Image, Share,
} from 'react-native';
import { useLocalSearchParams, router, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '@/constants/colors';
import { ASSET_TYPES, getAssetType } from '@/constants/assetTypes';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePortfolio, apiGet, apiPost, apiPut, apiDelete, apiPatch, Position, Account } from '@/context/PortfolioContext';
import { Card } from '@/components/ui/Card';
import { PnlBadge, formatCurrency } from '@/components/ui/PnlBadge';
import { AccountTypeBadge } from '@/components/ui/AccountTypeBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import { StockLogo } from '@/components/ui/StockLogo';
import { OrderSuggestion } from '@/components/home/OrderSuggestionsPreview';
import { SuggestionCard } from '@/components/home/SuggestionCard';

const API_BASE = process.env.EXPO_PUBLIC_DOMAIN
  ? process.env.EXPO_PUBLIC_DOMAIN.includes('localhost')
    ? `http://${process.env.EXPO_PUBLIC_DOMAIN}/api`
    : `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`
  : '/api';

// Must match the server-side sets in routes/positions.ts
const CRYPTO_SYMBOLS = new Set([
  'BTC', 'ETH', 'SOL', 'ADA', 'XRP', 'DOGE', 'AVAX', 'DOT', 'MATIC',
  'LINK', 'UNI', 'ATOM', 'LTC', 'BCH', 'XLM', 'ALGO', 'VET', 'FIL',
  'TRX', 'SHIB', 'BNB', 'NEAR', 'FTM', 'SAND', 'MANA', 'THETA', 'HBAR',
  'ICP', 'ETC', 'FLOW', 'CHZ', 'APE', 'CRO', 'GRT', 'ENJ', 'BAT',
  'ZEC', 'DASH', 'NEO', 'EOS', 'PEPE', 'WIF', 'BONK', 'ARB', 'OP',
  'SUI', 'APT', 'INJ', 'TIA', 'SEI', 'RUNE', 'CRV', 'AAVE', 'COMP',
  'MKR', 'SNX', 'YFI', 'SUSHI', 'ZRX',
]);
const SYMBOL_OVERRIDES: Record<string, string> = {
  'GC=F': 'GOLD', 'XAUUSD=X': 'GOLD',
  'SI=F': 'SILVER', 'XAGUSD=X': 'SILVER',
};

/** Normalise a raw symbol from an external CSV to our canonical form. */
function normalizeSymbol(raw: string): string {
  const upper = raw.toUpperCase().trim();
  // Reverse-map Yahoo Finance tickers (e.g. GC=F → GOLD)
  if (SYMBOL_OVERRIDES[upper]) return SYMBOL_OVERRIDES[upper];
  // Strip -USD suffix from known crypto symbols (e.g. BTC-USD → BTC)
  if (upper.endsWith('-USD')) {
    const base = upper.slice(0, -4);
    if (CRYPTO_SYMBOLS.has(base)) return base;
  }
  // Strip USDT suffix (e.g. BTCUSDT → BTC)
  if (upper.endsWith('USDT')) {
    const base = upper.slice(0, -4);
    if (CRYPTO_SYMBOLS.has(base)) return base;
  }
  return upper;
}

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

  // ─── Filter / Sort / Search ───────────────────────────────────────────────
  type FilterType = 'all' | 'risers' | 'losers';
  type SortField = 'value' | 'pct' | 'pnl' | 'name' | 'symbol';
  const [filter, setFilter] = useState<FilterType>('all');
  const [sortBy, setSortBy] = useState<SortField>('value');
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState('');
  const [showSortMenu, setShowSortMenu] = useState(false);

  const displayPositions = useMemo(() => {
    let list = [...positions];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p => p.symbol.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
    }
    if (filter === 'risers') list = list.filter(p => (p.dayChangePct ?? 0) > 0);
    if (filter === 'losers') list = list.filter(p => (p.dayChangePct ?? 0) < 0);
    list.sort((a, b) => {
      let diff = 0;
      if (sortBy === 'value') diff = a.marketValue - b.marketValue;
      else if (sortBy === 'pct') diff = a.unrealizedPnlPct - b.unrealizedPnlPct;
      else if (sortBy === 'pnl') diff = a.unrealizedPnl - b.unrealizedPnl;
      else if (sortBy === 'name') diff = a.name.localeCompare(b.name);
      else if (sortBy === 'symbol') diff = a.symbol.localeCompare(b.symbol);
      return sortAsc ? diff : -diff;
    });
    return list;
  }, [positions, filter, sortBy, sortAsc, search]);

  const SORT_LABELS: Record<SortField, string> = {
    value: 'Market Value', pct: 'P&L %', pnl: 'P&L $', name: 'Name', symbol: 'Symbol',
  };

  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAddPos, setShowAddPos] = useState(false);
  const [form, setForm] = useState({ symbol: '', name: '', quantity: '', avgCost: '', assetType: '', sector: '', notes: '' });

  // 3-dot context menu
  const [menuPos, setMenuPos] = useState<Position | null>(null);
  // Edit position modal
  const [editPos, setEditPos] = useState<Position | null>(null);
  const [editForm, setEditForm] = useState({ quantity: '', avgCost: '', assetType: '', notes: '' });
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);

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

  // Leverage: only meaningful when cash is negative (margin/borrowed funds)
  const positionsValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const cashBalance = account?.currentBalance ?? 0;
  const equity = positionsValue + cashBalance;
  const leverageRatio = cashBalance < 0 && equity > 0 ? positionsValue / equity : null;

  const exportCSV = () => {
    const header = 'Symbol,Name,Qty,Avg Cost,Current Price,Market Value,Unrealized P&L,P&L %';
    const rows = positions.map(p =>
      `${p.symbol},"${p.name}",${p.quantity},${p.avgCost.toFixed(4)},${p.currentPrice.toFixed(4)},${p.marketValue.toFixed(2)},${p.unrealizedPnl.toFixed(2)},${p.unrealizedPnlPct.toFixed(2)}`
    );
    const csv = [header, ...rows].join('\n');
    const filename = `${account?.name ?? 'positions'}_${new Date().toISOString().slice(0, 10)}.csv`;
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
        assetType: form.assetType || undefined,
        sector: form.sector || undefined,
        notes: form.notes || undefined,
      });
      setShowAddPos(false);
      setForm({ symbol: '', name: '', quantity: '', avgCost: '', assetType: '', sector: '', notes: '' });
      setSymbolResults([]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refreshAll();
    } catch {
      Alert.alert('Error', 'Failed to add position');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditPos = (pos: Position) => {
    setMenuPos(null);
    setEditForm({ quantity: String(pos.quantity), avgCost: String(pos.avgCost), assetType: pos.assetType ?? '', notes: pos.notes ?? '' });
    setEditPos(pos);
  };

  const handleEditPosition = async () => {
    if (!editPos || isEditSubmitting) return;
    if (!editForm.quantity || !editForm.avgCost) {
      Alert.alert('Missing fields', 'Quantity and average cost are required');
      return;
    }
    setIsEditSubmitting(true);
    try {
      await apiPut(`/positions/${editPos.id}`, {
        quantity: parseFloat(editForm.quantity),
        avgCost: parseFloat(editForm.avgCost),
        assetType: editForm.assetType || undefined,
        notes: editForm.notes || undefined,
      });
      setEditPos(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refreshAll();
    } catch {
      Alert.alert('Error', 'Failed to update position');
    } finally {
      setIsEditSubmitting(false);
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

  const parseCSVIntoPositions = (text: string): ParsedPosition[] => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    return lines.slice(1).map((line, idx) => {
      const fields: string[] = [];
      let current = '';
      let inQuote = false;
      for (const char of line) {
        if (char === '"') { inQuote = !inQuote; }
        else if (char === ',' && !inQuote) { fields.push(current.trim()); current = ''; }
        else { current += char; }
      }
      fields.push(current.trim());
      const rawSymbol = fields[0]?.replace(/^"|"$/g, '');
      const name = fields[1]?.replace(/^"|"$/g, '');
      const qty = parseFloat(fields[2]);
      const avgCost = parseFloat(fields[3]);
      if (!rawSymbol || isNaN(qty) || isNaN(avgCost)) return null;
      const symbol = normalizeSymbol(rawSymbol);
      return { _key: `csv_${idx}_${Date.now()}`, symbol, name: name || symbol, quantity: String(qty), avgCost: String(avgCost), sector: '', notes: '' };
    }).filter(Boolean) as ParsedPosition[];
  };

  const handlePickPortfolioImage = async () => {
    if (Platform.OS === 'web') {
      const input = (document as any).createElement('input');
      input.type = 'file';
      input.accept = 'image/*,.csv,text/csv';
      input.onchange = async (e: any) => {
        const file = e.target?.files?.[0];
        if (!file) return;
        const isCSV = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv' || file.type === 'application/vnd.ms-excel';
        if (isCSV) {
          const reader = new FileReader();
          reader.onload = (ev: any) => {
            const parsed = parseCSVIntoPositions(ev.target?.result ?? '');
            if (parsed.length === 0) {
              Alert.alert('No positions found', 'Could not parse CSV. Expected columns: Symbol, Name, Qty, Avg Cost');
              return;
            }
            setImportPositions(parsed);
            setImportImageUri(null);
            setShowImport(true);
          };
          reader.readAsText(file);
        } else {
          const reader = new FileReader();
          reader.onload = async (ev: any) => {
            const dataUrl = ev.target?.result as string;
            const base64 = dataUrl.split(',')[1];
            setImportImageUri(dataUrl);
            setImportPositions([]);
            setShowImport(true);
            await parseAssets([{ base64, mimeType: file.type || 'image/jpeg', uri: dataUrl } as any], false);
          };
          reader.readAsDataURL(file);
        }
      };
      input.click();
      return;
    }

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo access to upload portfolio screenshots.');
      return;
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

  // ─── Order suggestions for this account ──────────────────────────────────
  const queryClient = useQueryClient();

  const { data: allSuggestions } = useQuery({
    queryKey: ['order-suggestions'],
    queryFn: () => apiGet<OrderSuggestion[]>('/order-suggestions'),
    staleTime: Infinity,
    enabled: !!account,
  });

  const accountSuggestions = (allSuggestions ?? []).filter(
    s => s.status === 'pending' && s.accountId === accountId,
  );

  const { mutate: updateSuggestionStatus, isPending: isSuggestionUpdating } = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'dismissed' | 'executed' }) =>
      apiPatch<OrderSuggestion>(`/order-suggestions/${id}`, { status }),
    onSuccess: (updated) => {
      queryClient.setQueryData<OrderSuggestion[]>(['order-suggestions'], prev =>
        (prev ?? []).map(s => s.id === updated.id ? updated : s),
      );
    },
    onError: () => {
      Alert.alert('Error', 'Failed to update suggestion. Please try again.');
    },
  });

  const handleSuggestionDismiss = useCallback((s: OrderSuggestion) => {
    Alert.alert(
      'Dismiss suggestion',
      `Dismiss ${s.side.toUpperCase()} ${s.symbol}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dismiss',
          style: 'destructive',
          onPress: () => updateSuggestionStatus({ id: s.id, status: 'dismissed' }),
        },
      ],
    );
  }, [updateSuggestionStatus]);

  const handleSuggestionExecuted = useCallback((s: OrderSuggestion) => {
    Alert.alert(
      'Mark as executed',
      `Mark ${s.side.toUpperCase()} ${s.symbol} as executed?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Executed',
          onPress: () => updateSuggestionStatus({ id: s.id, status: 'executed' }),
        },
      ],
    );
  }, [updateSuggestionStatus]);

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
              <Text style={[styles.cashValue, cashBalance < 0 && { color: colors.negative }]}>
                {formatCurrency(cashBalance)}
              </Text>
            </View>
            {leverageRatio !== null && (
              <View style={[styles.cashRow, { borderTopWidth: 0, marginTop: 4 }]}>
                <Text style={styles.cashLabel}>Leverage</Text>
                <Text style={[styles.cashValue, { color: leverageRatio > 2 ? colors.negative : '#F5A623' }]}>
                  {leverageRatio.toFixed(2)}x
                </Text>
              </View>
            )}
          </Card>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Positions</Text>
          <View style={styles.sectionActions}>
            {positions.length > 0 && (
              <Pressable style={styles.importBtn} onPress={exportCSV}>
                <Feather name="download" size={14} color={colors.textSecondary} />
                <Text style={styles.importBtnText}>Export</Text>
              </Pressable>
            )}
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

        {positions.length > 0 && (
          <>
            {/* Search */}
            <View style={styles.searchRow}>
              <Feather name="search" size={14} color={colors.textMuted} style={{ marginRight: 6 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search symbol or name…"
                placeholderTextColor={colors.textMuted}
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
              />
              {search.length > 0 && (
                <Pressable onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Feather name="x" size={14} color={colors.textMuted} />
                </Pressable>
              )}
            </View>

            {/* Filter chips + Sort */}
            <View style={styles.filterRow}>
              {(['all', 'risers', 'losers'] as FilterType[]).map(f => (
                <Pressable
                  key={f}
                  style={[styles.filterChip, filter === f && styles.filterChipActive]}
                  onPress={() => setFilter(f)}
                >
                  <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>
                    {f === 'all' ? 'All' : f === 'risers' ? '↑ Risers' : '↓ Losers'}
                  </Text>
                </Pressable>
              ))}
              <Pressable style={[styles.filterChip, { marginLeft: 'auto', flexDirection: 'row', gap: 4 }]} onPress={() => setShowSortMenu(true)}>
                <Feather name="sliders" size={12} color={colors.textSecondary} />
                <Text style={styles.filterChipText}>{SORT_LABELS[sortBy]}</Text>
                <Feather name={sortAsc ? 'arrow-up' : 'arrow-down'} size={11} color={colors.textMuted} />
              </Pressable>
            </View>
          </>
        )}

        {positions.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Feather name="layers" size={32} color={colors.textMuted} />
            <Text style={styles.emptyText}>No positions yet.</Text>
            <Text style={styles.emptySubText}>Tap Import to scan your portfolio screenshot, or Add to enter manually.</Text>
          </Card>
        ) : displayPositions.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Feather name="filter" size={28} color={colors.textMuted} />
            <Text style={styles.emptyText}>No matches</Text>
          </Card>
        ) : (
          displayPositions.map(pos => {
            const isOverallPos = pos.unrealizedPnl >= 0;
            const isDayPos = (pos.dayChangePct ?? 0) >= 0;
            const assetCfg = getAssetType(pos.assetType);
            return (
              <Card key={pos.id} style={styles.posCard}>
                <View style={styles.posHeader}>
                  <Pressable
                    onPress={() => router.push({ pathname: '/chart/[symbol]', params: { symbol: pos.symbol, avgCost: String(pos.avgCost), accountId: String(accountId) } })}
                    style={styles.posLeft}
                  >
                    <StockLogo symbol={pos.symbol} size={36} />
                    <View style={{ flex: 1 }}>
                      <View style={styles.posSymbolRow}>
                        <Text style={styles.posSymbol}>{pos.symbol}</Text>
                        <View style={[styles.assetTypeBadge, { backgroundColor: assetCfg.color + '22', borderColor: assetCfg.color + '44' }]}>
                          <Feather name={assetCfg.icon as any} size={9} color={assetCfg.color} />
                          <Text style={[styles.assetTypeLabel, { color: assetCfg.color }]}>{assetCfg.label}</Text>
                        </View>
                      </View>
                      <Text style={styles.posName} numberOfLines={1}>{pos.name}</Text>
                    </View>
                  </Pressable>
                  <View style={styles.posRight}>
                    <Text style={styles.posValue}>{formatCurrency(pos.marketValue)}</Text>
                    <Pressable
                      onPress={() => setMenuPos(pos)}
                      style={styles.menuBtn}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Feather name="more-vertical" size={16} color={colors.textMuted} />
                    </Pressable>
                  </View>
                </View>
                <View style={styles.posStats}>
                  <View style={styles.posStat}><Text style={styles.posStatLabel}>Qty</Text><Text style={styles.posStatVal}>{pos.quantity}</Text></View>
                  <View style={styles.posStat}><Text style={styles.posStatLabel}>Avg Cost</Text><Text style={styles.posStatVal}>${pos.avgCost.toFixed(2)}</Text></View>
                  <View style={styles.posStat}><Text style={styles.posStatLabel}>Last</Text><Text style={styles.posStatVal}>${pos.currentPrice.toFixed(2)}</Text></View>
                  <View style={styles.posStat}>
                    <Text style={styles.posStatLabel}>P&L</Text>
                    <Text style={[styles.posStatVal, { color: isOverallPos ? colors.positive : colors.negative }]}>
                      {isOverallPos ? '+' : ''}{pos.unrealizedPnlPct.toFixed(1)}%
                    </Text>
                  </View>
                </View>
                <View style={styles.posDayRow}>
                  <Feather name={isDayPos ? 'trending-up' : 'trending-down'} size={11} color={isDayPos ? colors.positive : colors.negative} />
                  <Text style={[styles.posDayLabel, { color: isDayPos ? colors.positive : colors.negative }]}>
                    Today {isDayPos ? '+' : ''}{formatCurrency(pos.dayChange ?? 0)} ({isDayPos ? '+' : ''}{(pos.dayChangePct ?? 0).toFixed(2)}%)
                  </Text>
                </View>
              </Card>
            );
          })
        )}

        {/* Suggestions for this account */}
        {accountSuggestions.length > 0 && (
          <View style={styles.suggestionsSection}>
            <Text style={styles.suggestionsTitle}>Suggested Orders</Text>
            {accountSuggestions.map(s => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                isUpdating={isSuggestionUpdating}
                onDismiss={() => handleSuggestionDismiss(s)}
                onExecuted={() => handleSuggestionExecuted(s)}
              />
            ))}
          </View>
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
      <Modal visible={showAddPos} animationType="slide" presentationStyle="pageSheet">
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
            <Text style={styles.pickerLabel}>Asset Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.assetPickerRow} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
              {ASSET_TYPES.map(at => (
                <Pressable
                  key={at.key}
                  style={[styles.assetPickerChip, form.assetType === at.key && { borderColor: at.color, backgroundColor: at.color + '22' }]}
                  onPress={() => setForm(f => ({ ...f, assetType: f.assetType === at.key ? '' : at.key }))}
                >
                  <Feather name={at.icon as any} size={11} color={form.assetType === at.key ? at.color : colors.textSecondary} />
                  <Text style={[styles.assetPickerLabel, form.assetType === at.key && { color: at.color }]}>{at.label}</Text>
                </Pressable>
              ))}
            </ScrollView>

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
      <Modal visible={showImport} animationType="slide" presentationStyle="pageSheet">
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

      {/* ── Position Context Menu (3-dot) ─────────────────────────────────── */}
      <Modal visible={!!menuPos} animationType="fade" transparent>
        <Pressable style={styles.menuOverlay} onPress={() => setMenuPos(null)}>
          <View style={[styles.menuSheet, { paddingBottom: insets.bottom + 8 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>{menuPos?.symbol}</Text>
            <Pressable style={styles.sortItem} onPress={() => menuPos && openEditPos(menuPos)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Feather name="edit-2" size={16} color={colors.primary} />
                <Text style={[styles.sortItemText, { color: colors.primary }]}>Edit Position</Text>
              </View>
            </Pressable>
            <Pressable style={styles.sortItem} onPress={() => { setMenuPos(null); if (menuPos) handleDeletePos(menuPos.id, menuPos.symbol); }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Feather name="trash-2" size={16} color={colors.negative} />
                <Text style={[styles.sortItemText, { color: colors.negative }]}>Delete Position</Text>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* ── Edit Position Modal ───────────────────────────────────────────── */}
      <Modal visible={!!editPos} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Edit {editPos?.symbol}</Text>
            <View style={styles.inputRow}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Quantity" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" value={editForm.quantity} onChangeText={t => setEditForm(f => ({ ...f, quantity: t }))} />
              <TextInput style={[styles.input, { flex: 1, marginLeft: 8 }]} placeholder="Avg cost ($)" placeholderTextColor={colors.textMuted} keyboardType="decimal-pad" value={editForm.avgCost} onChangeText={t => setEditForm(f => ({ ...f, avgCost: t }))} />
            </View>
            <Text style={styles.pickerLabel}>Asset Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.assetPickerRow} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
              {ASSET_TYPES.map(at => (
                <Pressable
                  key={at.key}
                  style={[styles.assetPickerChip, editForm.assetType === at.key && { borderColor: at.color, backgroundColor: at.color + '22' }]}
                  onPress={() => setEditForm(f => ({ ...f, assetType: f.assetType === at.key ? '' : at.key }))}
                >
                  <Feather name={at.icon as any} size={11} color={editForm.assetType === at.key ? at.color : colors.textSecondary} />
                  <Text style={[styles.assetPickerLabel, editForm.assetType === at.key && { color: at.color }]}>{at.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <TextInput style={styles.input} placeholder="Notes (optional)" placeholderTextColor={colors.textMuted} value={editForm.notes} onChangeText={t => setEditForm(f => ({ ...f, notes: t }))} />
            <View style={styles.modalButtons}>
              <Pressable style={styles.cancelBtn} onPress={() => setEditPos(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.saveBtn, isEditSubmitting && { opacity: 0.6 }]} onPress={handleEditPosition} disabled={isEditSubmitting}>
                <Text style={styles.saveText}>{isEditSubmitting ? 'Saving…' : 'Save Changes'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Sort Menu ─────────────────────────────────────────────────────── */}
      <Modal visible={showSortMenu} animationType="fade" transparent>
        <Pressable style={styles.menuOverlay} onPress={() => setShowSortMenu(false)}>
          <View style={[styles.menuSheet, { paddingBottom: insets.bottom + 8 }]}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Sort By</Text>
            {(Object.keys(SORT_LABELS) as SortField[]).map(field => (
              <Pressable
                key={field}
                style={styles.sortItem}
                onPress={() => {
                  if (sortBy === field) setSortAsc(a => !a);
                  else { setSortBy(field); setSortAsc(false); }
                  setShowSortMenu(false);
                }}
              >
                <Text style={[styles.sortItemText, sortBy === field && { color: colors.primary }]}>
                  {SORT_LABELS[field]}
                </Text>
                {sortBy === field && (
                  <Feather name={sortAsc ? 'arrow-up' : 'arrow-down'} size={14} color={colors.primary} />
                )}
              </Pressable>
            ))}
          </View>
        </Pressable>
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
  posCard: { marginBottom: 8 },
  posHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  posLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  posSymbolRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  posSymbol: { fontFamily: 'Inter_700Bold', fontSize: 15, color: colors.textPrimary },
  assetTypeBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  assetTypeLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 9 },
  posName: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textSecondary, marginTop: 1, maxWidth: 180 },
  posRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  posValue: { fontFamily: 'Inter_700Bold', fontSize: 15, color: colors.textPrimary },
  menuBtn: { padding: 6 },
  posStats: { flexDirection: 'row', marginBottom: 6 },
  posStat: { flex: 1 },
  posStatLabel: { fontFamily: 'Inter_400Regular', fontSize: 10, color: colors.textMuted, marginBottom: 2 },
  posStatVal: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: colors.textPrimary },
  posDayRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.separator },
  posDayLabel: { fontFamily: 'Inter_500Medium', fontSize: 11 },
  sector: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted, marginTop: 6 },
  pickerLabel: { fontFamily: 'Inter_500Medium', fontSize: 12, color: colors.textSecondary, marginBottom: 6 },
  assetPickerRow: { marginBottom: 12 },
  assetPickerChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: colors.separator, backgroundColor: colors.surfaceElevated },
  assetPickerLabel: { fontFamily: 'Inter_500Medium', fontSize: 11, color: colors.textSecondary },
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
  // Search + filter
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surfaceElevated, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    marginBottom: 10, borderWidth: 1, borderColor: colors.separator,
  },
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textPrimary },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'nowrap' },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: colors.separator, backgroundColor: colors.surfaceElevated,
  },
  filterChipActive: { borderColor: colors.primary, backgroundColor: 'rgba(0,212,255,0.12)' },
  filterChipText: { fontFamily: 'Inter_500Medium', fontSize: 12, color: colors.textSecondary },
  filterChipTextActive: { color: colors.primary },
  // Sort menu
  menuOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  menuSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  sortItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.separator },
  sortItemText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: colors.textPrimary },
  suggestionsSection: { marginTop: 8 },
  suggestionsTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.textPrimary, marginBottom: 10 },
});
