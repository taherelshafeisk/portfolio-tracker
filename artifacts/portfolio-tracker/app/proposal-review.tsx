import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  StyleSheet,
  Animated,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';

// ─── Constants ────────────────────────────────────────────────────────────────

const SCREEN_BG = '#0D1117';
const CARD_BG = '#161B22';
const CARD_BORDER = '#30363D';
const ACCENT_GREEN = '#1D9E75';
const ACCENT_AMBER = '#EF9F27';
const ACCENT_RED = '#E24B4A';

// ─── Types ────────────────────────────────────────────────────────────────────

type Bucket = 'core' | 'swing' | 'speculative';
type Action = 'hold' | 'add' | 'trim' | 'cut' | 'watch';
type ChipType = 'stop' | 'add' | 'trim' | 'watch';
type CardStatus = 'pending' | 'approved' | 'rejected';

interface PriceChip {
  type: ChipType;
  value: string;
}

interface Flag {
  question: string;
  resolvedAnswer?: string;
}

interface Position {
  id: string;
  ticker: string;
  bucket: Bucket;
  action: Action;
  sleeve: string;
  priceChips: PriceChip[];
  confidence: number;
  policyNote?: string;
  flag?: Flag;
}

interface EditValues {
  bucket: string;
  action: string;
  stopPrice: string;
  addZoneLow: string;
  addZoneHigh: string;
  trimZoneLow: string;
  trimZoneHigh: string;
  policyNote: string;
}

interface CardState {
  status: CardStatus;
  edit: EditValues;
}

// ─── Hard-coded proposal data ─────────────────────────────────────────────────

const TAB1_POSITIONS: Position[] = [
  { id: 'msft',  ticker: 'MSFT',  bucket: 'core',        action: 'hold', sleeve: 'Both', priceChips: [{ type: 'add',  value: '370–380' }], confidence: 97 },
  { id: 'googl', ticker: 'GOOGL', bucket: 'core',        action: 'hold', sleeve: 'Both', priceChips: [],                                   confidence: 98 },
  { id: 'aapl',  ticker: 'AAPL',  bucket: 'core',        action: 'hold', sleeve: 'Both', priceChips: [],                                   confidence: 98 },
  { id: 'avgo',  ticker: 'AVGO',  bucket: 'core',        action: 'add',  sleeve: 'Both', priceChips: [{ type: 'add',  value: '290–310' }], confidence: 97 },
  { id: 'mu',    ticker: 'MU',    bucket: 'core',        action: 'add',  sleeve: 'IBKR', priceChips: [{ type: 'add',  value: '420–440' }], confidence: 95 },
  { id: 'tsm',   ticker: 'TSM',   bucket: 'core',        action: 'add',  sleeve: 'IBKR', priceChips: [{ type: 'add',  value: '280–300' }], confidence: 95 },
  { id: 'crwd',  ticker: 'CRWD',  bucket: 'core',        action: 'hold', sleeve: 'Wio',  priceChips: [],                                   confidence: 97 },
  { id: 'nvts',  ticker: 'NVTS',  bucket: 'core',        action: 'hold', sleeve: 'Wio',  priceChips: [],                                   confidence: 97 },
  { id: 'ionq',  ticker: 'IONQ',  bucket: 'speculative', action: 'cut',  sleeve: 'Wio',  priceChips: [{ type: 'stop', value: '28'      }], confidence: 95 },
  { id: 'qbts',  ticker: 'QBTS',  bucket: 'speculative', action: 'trim', sleeve: 'Both', priceChips: [{ type: 'trim', value: '19–20'   }], confidence: 93 },
  { id: 'voo',   ticker: 'VOO',   bucket: 'core',        action: 'hold', sleeve: 'Wio',  priceChips: [],                                   confidence: 88, policyNote: 'Never sell' },
  { id: 'gold',  ticker: 'GOLD',  bucket: 'core',        action: 'add',  sleeve: 'Wio',  priceChips: [],                                   confidence: 82, policyNote: 'Accumulate dips' },
];

const TAB2_POSITIONS: Position[] = [
  {
    id: 'nvda', ticker: 'NVDA', bucket: 'core', action: 'watch',
    sleeve: 'IBKR: watch · Wio: hold',
    priceChips: [{ type: 'stop', value: '180' }], confidence: 82,
    flag: { question: '$180 — what kind of level?', resolvedAnswer: 'Downside stop / support break' },
  },
  {
    id: 'meta', ticker: 'META', bucket: 'core', action: 'watch',
    sleeve: 'IBKR',
    priceChips: [{ type: 'stop', value: '600' }], confidence: 80,
    flag: { question: '$600 — trim target, add trigger, or stop?', resolvedAnswer: 'Stop / next support · RSI 30' },
  },
  {
    id: 'orcl', ticker: 'ORCL', bucket: 'swing', action: 'trim',
    sleeve: 'Both',
    priceChips: [{ type: 'stop', value: '145' }, { type: 'watch', value: '166' }], confidence: 78,
    flag: { question: '$166 and $145 — confirm', resolvedAnswer: '$166 EMA 50 watch · $145 cut stop' },
  },
  {
    id: 'rklb', ticker: 'RKLB', bucket: 'speculative', action: 'trim',
    sleeve: 'IBKR: trim · Wio: hold',
    priceChips: [], confidence: 75,
    flag: { question: 'Sleeve conflict', resolvedAnswer: 'Maintain independently per sleeve' },
  },
  {
    id: 'uber', ticker: 'UBER', bucket: 'speculative', action: 'cut',
    sleeve: 'Both',
    priceChips: [{ type: 'stop', value: '68' }], confidence: 88,
    flag: { question: "'CUT' bucket — which bucket applies?", resolvedAnswer: 'Speculative' },
  },
  {
    id: 'wmt', ticker: 'WMT', bucket: 'core', action: 'hold',
    sleeve: 'IBKR',
    priceChips: [], confidence: 78,
    flag: { question: "'DEF' bucket — resolved: mapped to core", resolvedAnswer: 'Fold into core' },
  },
  {
    id: 'xle', ticker: 'XLE', bucket: 'core', action: 'hold',
    sleeve: 'IBKR',
    priceChips: [], confidence: 78,
    flag: { question: "'DEF' bucket — resolved: mapped to core", resolvedAnswer: 'Fold into core' },
  },
  {
    id: 'nbis', ticker: 'NBIS', bucket: 'speculative', action: 'watch',
    sleeve: 'Wio',
    priceChips: [{ type: 'stop', value: '110' }], confidence: 85,
    policyNote: 'Trailing stop — stored as $110 snapshot',
    flag: { question: 'Trailing stop — stored as static $110 snapshot', resolvedAnswer: 'Static snapshot' },
  },
  {
    id: 'nflx', ticker: 'NFLX', bucket: 'swing', action: 'trim',
    sleeve: 'Wio',
    priceChips: [], confidence: 88,
    flag: { question: "Trim trigger is '+3–4% day' — no fixed price", resolvedAnswer: 'policyNote only' },
  },
  {
    id: 'amzn', ticker: 'AMZN', bucket: 'swing', action: 'watch',
    sleeve: 'IBKR',
    priceChips: [], confidence: 80,
  },
];

const ALL_POSITIONS = [...TAB1_POSITIONS, ...TAB2_POSITIONS];
const TOTAL = ALL_POSITIONS.length;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseRange(val?: string): [string, string] {
  if (!val) return ['', ''];
  const parts = val.split('–');
  return [parts[0] ?? '', parts[1] ?? ''];
}

function initEditValues(pos: Position): EditValues {
  const stopChip = pos.priceChips.find(c => c.type === 'stop');
  const addChip  = pos.priceChips.find(c => c.type === 'add');
  const trimChip = pos.priceChips.find(c => c.type === 'trim');
  const [addLow,  addHigh]  = parseRange(addChip?.value);
  const [trimLow, trimHigh] = parseRange(trimChip?.value);
  return {
    bucket:      pos.bucket,
    action:      pos.action,
    stopPrice:   stopChip?.value ?? '',
    addZoneLow:  addLow,
    addZoneHigh: addHigh,
    trimZoneLow: trimLow,
    trimZoneHigh:trimHigh,
    policyNote:  pos.policyNote ?? '',
  };
}

function buildInitialStates(): Record<string, CardState> {
  return Object.fromEntries(
    ALL_POSITIONS.map(p => [p.id, { status: 'pending' as CardStatus, edit: initEditValues(p) }])
  );
}

// ─── Style derivation ─────────────────────────────────────────────────────────

function bucketColors(b: Bucket) {
  switch (b) {
    case 'core':        return { bg: '#E6F1FB', text: '#185FA5' };
    case 'swing':       return { bg: '#EEEDFE', text: '#534AB7' };
    case 'speculative': return { bg: '#FAEEDA', text: '#854F0B' };
  }
}

function actionColors(a: Action) {
  switch (a) {
    case 'hold':  return { bg: '#EAF3DE', text: '#3B6D11' };
    case 'add':   return { bg: '#E1F5EE', text: '#0F6E56' };
    case 'trim':  return { bg: '#FAEEDA', text: '#854F0B' };
    case 'cut':   return { bg: '#FCEBEB', text: '#A32D2D' };
    case 'watch': return { bg: '#F1EFE8', text: '#5F5E5A' };
  }
}

function priceChipColors(t: ChipType) {
  switch (t) {
    case 'stop':  return { bg: '#FCEBEB', border: '#F5BFBF', text: '#A32D2D' };
    case 'add':   return { bg: '#E1F5EE', border: '#A7DFC8', text: '#0F6E56' };
    case 'trim':  return { bg: '#FAEEDA', border: '#FAC775', text: '#854F0B' };
    case 'watch': return { bg: '#EEF3FB', border: '#AFC4E8', text: '#185FA5' };
  }
}

function priceChipLabel(t: ChipType) {
  switch (t) {
    case 'stop':  return 'Stop';
    case 'add':   return 'Add';
    case 'trim':  return 'Trim';
    case 'watch': return 'Watch';
  }
}

function dotColor(conf: number) {
  if (conf >= 90) return ACCENT_GREEN;
  if (conf >= 75) return ACCENT_AMBER;
  return ACCENT_RED;
}

// ─── Badge pill ───────────────────────────────────────────────────────────────

function BadgePill({ label, bg, text }: { label: string; bg: string; text: string }) {
  return (
    <View style={[bp.pill, { backgroundColor: bg }]}>
      <Text style={[bp.text, { color: text }]}>{label}</Text>
    </View>
  );
}

const bp = StyleSheet.create({
  pill: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginRight: 4 },
  text: { fontSize: 10, fontWeight: '600', letterSpacing: 0.2 },
});

// ─── Sleeve tag ───────────────────────────────────────────────────────────────

function SleeveTag({ label }: { label: string }) {
  return (
    <View style={st.tag}>
      <Text style={st.text} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  tag:  { borderRadius: 4, borderWidth: 0.75, borderColor: CARD_BORDER, paddingHorizontal: 5, paddingVertical: 2, maxWidth: 120 },
  text: { fontSize: 10, color: '#8B949E' },
});

// ─── Price chip ───────────────────────────────────────────────────────────────

function PriceChipPill({ chip }: { chip: PriceChip }) {
  const c = priceChipColors(chip.type);
  return (
    <View style={[pc.chip, { backgroundColor: c.bg, borderColor: c.border }]}>
      <Text style={[pc.text, { color: c.text }]}>{priceChipLabel(chip.type)} {chip.value}</Text>
    </View>
  );
}

const pc = StyleSheet.create({
  chip: { borderRadius: 4, borderWidth: 0.75, paddingHorizontal: 5, paddingVertical: 2, marginLeft: 3 },
  text: { fontSize: 9, fontWeight: '600' },
});

// ─── Flag block ───────────────────────────────────────────────────────────────

function FlagBlock({ flag }: { flag: Flag }) {
  return (
    <View style={fb.container}>
      <Text style={fb.question}>{flag.question}</Text>
      {flag.resolvedAnswer && (
        <View style={fb.row}>
          <View style={fb.resolvedPill}>
            <Text style={fb.resolvedText}>{flag.resolvedAnswer}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const fb = StyleSheet.create({
  container:    { backgroundColor: '#FAEEDA', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginTop: 8, marginBottom: 4 },
  question:     { fontSize: 12, color: '#854F0B', fontWeight: '500', marginBottom: 6 },
  row:          { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  resolvedPill: { backgroundColor: '#EF9F27', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 0.5, borderColor: '#FAC775' },
  resolvedText: { fontSize: 11, fontWeight: '600', color: '#fff' },
});

// ─── Edit panel ───────────────────────────────────────────────────────────────

const BUCKETS: Bucket[] = ['core', 'swing', 'speculative'];
const ACTIONS: Action[] = ['hold', 'add', 'trim', 'cut', 'watch'];

function EditPanel({
  edit,
  onChange,
  onSaveAndApprove,
}: {
  edit: EditValues;
  onChange: (field: keyof EditValues, value: string) => void;
  onSaveAndApprove: () => void;
}) {
  return (
    <View style={ep.panel}>
      {/* Bucket selector */}
      <Text style={ep.groupLabel}>Bucket</Text>
      <View style={ep.pillRow}>
        {BUCKETS.map(b => {
          const on = edit.bucket === b;
          return (
            <Pressable key={b} onPress={() => onChange('bucket', b)}
              style={[ep.pill, on && ep.pillOn]}>
              <Text style={[ep.pillText, on && ep.pillTextOn]}>{b}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Action selector */}
      <Text style={ep.groupLabel}>Action</Text>
      <View style={ep.pillRow}>
        {ACTIONS.map(a => {
          const on = edit.action === a;
          return (
            <Pressable key={a} onPress={() => onChange('action', a)}
              style={[ep.pill, on && ep.pillOn]}>
              <Text style={[ep.pillText, on && ep.pillTextOn]}>{a}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Stop / policy note */}
      <View style={ep.row}>
        <View style={ep.half}>
          <Text style={ep.fieldLabel}>Stop price</Text>
          <TextInput style={ep.input} value={edit.stopPrice}
            onChangeText={v => onChange('stopPrice', v)}
            keyboardType="decimal-pad" placeholder="—" placeholderTextColor="#555" />
        </View>
        <View style={ep.gap} />
        <View style={ep.half}>
          <Text style={ep.fieldLabel}>Policy note</Text>
          <TextInput style={ep.input} value={edit.policyNote}
            onChangeText={v => onChange('policyNote', v)}
            placeholder="—" placeholderTextColor="#555" />
        </View>
      </View>

      {/* Add zone */}
      <View style={ep.row}>
        <View style={ep.half}>
          <Text style={ep.fieldLabel}>Add zone low</Text>
          <TextInput style={ep.input} value={edit.addZoneLow}
            onChangeText={v => onChange('addZoneLow', v)}
            keyboardType="decimal-pad" placeholder="—" placeholderTextColor="#555" />
        </View>
        <View style={ep.gap} />
        <View style={ep.half}>
          <Text style={ep.fieldLabel}>Add zone high</Text>
          <TextInput style={ep.input} value={edit.addZoneHigh}
            onChangeText={v => onChange('addZoneHigh', v)}
            keyboardType="decimal-pad" placeholder="—" placeholderTextColor="#555" />
        </View>
      </View>

      {/* Trim zone */}
      <View style={ep.row}>
        <View style={ep.half}>
          <Text style={ep.fieldLabel}>Trim zone low</Text>
          <TextInput style={ep.input} value={edit.trimZoneLow}
            onChangeText={v => onChange('trimZoneLow', v)}
            keyboardType="decimal-pad" placeholder="—" placeholderTextColor="#555" />
        </View>
        <View style={ep.gap} />
        <View style={ep.half}>
          <Text style={ep.fieldLabel}>Trim zone high</Text>
          <TextInput style={ep.input} value={edit.trimZoneHigh}
            onChangeText={v => onChange('trimZoneHigh', v)}
            keyboardType="decimal-pad" placeholder="—" placeholderTextColor="#555" />
        </View>
      </View>

      <Pressable style={ep.saveBtn} onPress={onSaveAndApprove}>
        <Text style={ep.saveBtnText}>Save & approve</Text>
      </Pressable>
    </View>
  );
}

const ep = StyleSheet.create({
  panel:       { marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: CARD_BORDER },
  groupLabel:  { fontSize: 10, fontWeight: '600', color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 8 },
  pillRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 2 },
  pill:        { borderRadius: 6, borderWidth: 0.75, borderColor: CARD_BORDER, paddingHorizontal: 10, paddingVertical: 4 },
  pillOn:      { backgroundColor: ACCENT_GREEN, borderColor: ACCENT_GREEN },
  pillText:    { fontSize: 12, color: '#888', fontWeight: '500' },
  pillTextOn:  { color: '#fff', fontWeight: '600' },
  row:         { flexDirection: 'row', marginTop: 10 },
  half:        { flex: 1 },
  gap:         { width: 8 },
  fieldLabel:  { fontSize: 10, color: '#666', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 },
  input:       { backgroundColor: SCREEN_BG, borderWidth: 0.75, borderColor: CARD_BORDER, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, fontSize: 13, color: '#E6EDF3' },
  saveBtn:     { backgroundColor: ACCENT_GREEN, borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 14 },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});

// ─── Position card ────────────────────────────────────────────────────────────

function PositionCard({
  pos,
  state,
  expanded,
  onExpand,
  onApprove,
  onReject,
  onChange,
  onSaveAndApprove,
  showFlag,
}: {
  pos: Position;
  state: CardState;
  expanded: boolean;
  onExpand: () => void;
  onApprove: () => void;
  onReject: () => void;
  onChange: (field: keyof EditValues, value: string) => void;
  onSaveAndApprove: () => void;
  showFlag: boolean;
}) {
  const { status, edit } = state;
  const bc = bucketColors(pos.bucket);
  const ac = actionColors(pos.action);
  const dc = dotColor(pos.confidence);

  const borderLeft = status === 'approved'
    ? { borderLeftWidth: 3, borderLeftColor: ACCENT_GREEN }
    : status === 'rejected'
    ? { borderLeftWidth: 3, borderLeftColor: ACCENT_RED }
    : {};

  return (
    <View style={[card.wrap, borderLeft, status !== 'pending' && { opacity: 0.6 }]}>
      {/* Header row */}
      <View style={card.header}>
        <Text style={card.ticker}>{pos.ticker}</Text>
        <BadgePill label={pos.bucket} bg={bc.bg} text={bc.text} />
        <BadgePill label={pos.action} bg={ac.bg} text={ac.text} />
        <SleeveTag label={pos.sleeve} />
        <View style={card.spacer} />
        {pos.priceChips.map((chip, i) => <PriceChipPill key={i} chip={chip} />)}
        <View style={[card.dot, { backgroundColor: dc }]} />
      </View>

      {/* Flag block — tab 2 only */}
      {showFlag && pos.flag && <FlagBlock flag={pos.flag} />}

      {/* Action row */}
      <View style={card.actionRow}>
        <Pressable style={[card.btn, card.approveBtn]} onPress={onApprove}>
          <Text style={[card.btnText, { color: ACCENT_GREEN }]}>Approve</Text>
        </Pressable>
        <Pressable style={[card.btn, card.editBtn, expanded && card.editBtnOpen]} onPress={onExpand}>
          <Text style={card.btnText}>{expanded ? 'Cancel' : 'Edit'}</Text>
        </Pressable>
        <Pressable style={[card.btn, card.rejectBtn]} onPress={onReject}>
          <Text style={[card.btnText, { color: ACCENT_RED }]}>Reject</Text>
        </Pressable>
      </View>

      {/* Inline edit panel */}
      {expanded && (
        <EditPanel edit={edit} onChange={onChange} onSaveAndApprove={onSaveAndApprove} />
      )}
    </View>
  );
}

const card = StyleSheet.create({
  wrap:       { backgroundColor: CARD_BG, borderWidth: 0.5, borderColor: CARD_BORDER, borderRadius: 12, padding: 14, marginBottom: 8 },
  header:     { flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap' },
  ticker:     { fontSize: 15, fontWeight: '500', color: '#E6EDF3', marginRight: 6, minWidth: 38 },
  spacer:     { flex: 1, minWidth: 4 },
  dot:        { width: 8, height: 8, borderRadius: 4, marginLeft: 6, flexShrink: 0 },
  actionRow:  { flexDirection: 'row', gap: 6, marginTop: 10 },
  btn:        { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 7 },
  btnText:    { fontSize: 13, fontWeight: '500', color: '#E6EDF3' },
  approveBtn: { backgroundColor: 'rgba(29,158,117,0.14)' },
  editBtn:    { backgroundColor: 'transparent', borderWidth: 0.75, borderColor: CARD_BORDER },
  editBtnOpen:{ borderColor: '#666' },
  rejectBtn:  { backgroundColor: 'rgba(226,75,74,0.12)' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProposalReviewScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [activeTab, setActiveTab]     = useState<0 | 1>(0);
  const [cardStates, setCardStates]   = useState<Record<string, CardState>>(buildInitialStates);
  const [expandedEdit, setExpandedEdit] = useState<string | null>(null);

  // ── Progress ──────────────────────────────────────────────────────────────

  const reviewedCount = useMemo(
    () => ALL_POSITIONS.filter(p => cardStates[p.id]?.status !== 'pending').length,
    [cardStates],
  );

  const [trackWidth, setTrackWidth] = useState(0);
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: reviewedCount / TOTAL,
      duration: 350,
      useNativeDriver: false,
    }).start();
  }, [reviewedCount]);

  const fillWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, trackWidth],
  });

  // ── Tab badge counts ──────────────────────────────────────────────────────

  const tab1Pending = useMemo(
    () => TAB1_POSITIONS.filter(p => cardStates[p.id]?.status === 'pending').length,
    [cardStates],
  );
  const tab2Pending = useMemo(
    () => TAB2_POSITIONS.filter(p => cardStates[p.id]?.status === 'pending').length,
    [cardStates],
  );

  // ── Card actions ──────────────────────────────────────────────────────────

  const setStatus = useCallback((id: string, status: CardStatus) => {
    setCardStates(prev => ({ ...prev, [id]: { ...prev[id], status } }));
    setExpandedEdit(null);
  }, []);

  const setField = useCallback((id: string, field: keyof EditValues, value: string) => {
    setCardStates(prev => ({
      ...prev,
      [id]: { ...prev[id], edit: { ...prev[id].edit, [field]: value } },
    }));
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedEdit(prev => prev === id ? null : id);
  }, []);

  const approveAllTab1 = useCallback(() => {
    setCardStates(prev => {
      const next = { ...prev };
      TAB1_POSITIONS.forEach(p => {
        if (next[p.id].status === 'pending') next[p.id] = { ...next[p.id], status: 'approved' };
      });
      return next;
    });
    setExpandedEdit(null);
  }, []);

  const positions = activeTab === 0 ? TAB1_POSITIONS : TAB2_POSITIONS;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[s.container, { paddingTop: topPad }]}>
      {/* Nav header */}
      <View style={s.navHeader}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={s.backBtn}>
          <Feather name="chevron-left" size={22} color="#E6EDF3" />
        </Pressable>
        <Text style={s.navTitle}>IPS Proposal Review</Text>
      </View>

      {/* Progress bar */}
      <View style={s.progressSection}>
        <View style={s.progressLabels}>
          <Text style={s.progressLeft}>{reviewedCount} of {TOTAL} reviewed</Text>
          <Text style={s.progressRight}>{Math.round((reviewedCount / TOTAL) * 100)}%</Text>
        </View>
        <View style={s.track} onLayout={e => setTrackWidth(e.nativeEvent.layout.width)}>
          <Animated.View style={[s.fill, { width: fillWidth }]} />
        </View>
      </View>

      {/* Tab bar */}
      <View style={s.tabBar}>
        {(['Ready to approve', 'Needs review'] as const).map((label, i) => {
          const active = activeTab === i;
          const badgeBg = i === 0 ? ACCENT_GREEN : ACCENT_AMBER;
          const pending  = i === 0 ? tab1Pending : tab2Pending;
          return (
            <Pressable key={i} style={[s.tab, active && s.tabActive]}
              onPress={() => setActiveTab(i as 0 | 1)}>
              <Text style={[s.tabText, active && s.tabTextActive]}>{label}</Text>
              <View style={[s.tabBadge, { backgroundColor: badgeBg }]}>
                <Text style={s.tabBadgeText}>{pending}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[
          s.scrollContent,
          { paddingBottom: Platform.OS === 'web' ? 100 : insets.bottom + 90 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Bulk action bar — tab 1 only */}
        {activeTab === 0 && (
          <View style={s.bulkBar}>
            <Text style={s.bulkText}>
              {TAB1_POSITIONS.length} positions · high confidence · no flags
            </Text>
            <Pressable
              style={[s.approveAllBtn, tab1Pending === 0 && { opacity: 0.4 }]}
              onPress={approveAllTab1}
              disabled={tab1Pending === 0}
            >
              <Text style={s.approveAllBtnText}>
                Approve all{tab1Pending > 0 ? ` ${tab1Pending}` : ''}
              </Text>
            </Pressable>
          </View>
        )}

        {/* Cards */}
        {positions.map(pos => (
          <PositionCard
            key={pos.id}
            pos={pos}
            state={cardStates[pos.id]}
            expanded={expandedEdit === pos.id}
            onExpand={() => toggleExpand(pos.id)}
            onApprove={() => setStatus(pos.id, 'approved')}
            onReject={() => setStatus(pos.id, 'rejected')}
            onChange={(field, value) => setField(pos.id, field, value)}
            onSaveAndApprove={() => setStatus(pos.id, 'approved')}
            showFlag={activeTab === 1}
          />
        ))}
      </ScrollView>
    </View>
  );
}

// ─── Screen styles ────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: SCREEN_BG },
  navHeader:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, paddingTop: 4 },
  backBtn:         { marginRight: 8 },
  navTitle:        { fontSize: 20, fontWeight: '700', color: '#E6EDF3' },

  progressSection: { paddingHorizontal: 16, marginBottom: 14 },
  progressLabels:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLeft:    { fontSize: 12, color: '#8B949E' },
  progressRight:   { fontSize: 12, color: '#8B949E', fontWeight: '600' },
  track:           { height: 3, backgroundColor: '#21262D', borderRadius: 2, overflow: 'hidden' },
  fill:            { height: '100%', backgroundColor: ACCENT_GREEN, borderRadius: 2 },

  tabBar:          { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: CARD_BORDER, paddingHorizontal: 16, marginBottom: 12 },
  tab:             { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 4, marginRight: 20, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive:       { borderBottomColor: ACCENT_GREEN },
  tabText:         { fontSize: 14, fontWeight: '500', color: '#8B949E' },
  tabTextActive:   { color: '#E6EDF3', fontWeight: '600' },
  tabBadge:        { borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1, minWidth: 18, alignItems: 'center' },
  tabBadgeText:    { fontSize: 10, fontWeight: '700', color: '#fff' },

  scroll:          { flex: 1 },
  scrollContent:   { paddingHorizontal: 16 },

  bulkBar:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CARD_BG, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, borderWidth: 0.5, borderColor: CARD_BORDER },
  bulkText:        { fontSize: 12, color: '#8B949E', flex: 1, flexShrink: 1 },
  approveAllBtn:   { backgroundColor: ACCENT_GREEN, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, marginLeft: 10 },
  approveAllBtnText:{ fontSize: 13, fontWeight: '600', color: '#fff' },
});
