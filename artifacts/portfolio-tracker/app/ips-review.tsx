import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator,
  LayoutAnimation, UIManager, Platform, Modal, TextInput, ScrollView,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { apiGet, apiPut } from '@/context/PortfolioContext';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const BUCKETS = ['core', 'swing', 'speculative', 'crypto', 'cash', 'def', 'anchor', 'inc', 'cut'];
const ACTIONS = ['hold', 'add', 'trim', 'cut', 'watch', 'exit', 'monitor'];
const BUCKET_COLORS: Record<string, string> = {
  core: '#00D4FF',
  swing: '#F5A623',
  speculative: '#FF6B35',
  crypto: '#9B59B6',
  cash: '#2ECC71',
  def: '#3498DB',
  anchor: '#1ABC9C',
  inc: '#F39C12',
  cut: '#FF4444',
};

interface ProposedFields {
  positionBucket?: string | null;
  ipsAction?: string | null;
  stopPrice?: number | null;
  addZoneLow?: number | null;
  addZoneHigh?: number | null;
  policyNote?: string | null;
  secondaryBucket?: string | null;
  splitRatio?: number | null;
}

interface PendingItem {
  id: number;
  proposalId: number;
  entityKey: string;
  proposedFields: ProposedFields;
  confidence: number | null;
  rationale: string | null;
  evidenceSnippet: string | null;
  ipsVersion: string | null;
}

function BucketChip({ bucket }: { bucket: string }) {
  const color = BUCKET_COLORS[bucket] ?? '#888';
  return (
    <View style={[styles.chip, { backgroundColor: color + '22', borderColor: color }]}>
      <Text style={[styles.chipText, { color }]}>{bucket}</Text>
    </View>
  );
}

interface CardProps {
  item: PendingItem;
  onAction: (id: number, status: 'approved' | 'rejected' | 'edited', fields?: ProposedFields) => void;
}

function ProposalCard({ item, onAction }: CardProps) {
  const f = item.proposedFields;
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [splitOn, setSplitOn] = useState(!!f.secondaryBucket);
  const [secondaryBucket, setSecondaryBucket] = useState(f.secondaryBucket ?? '');
  const [splitRatio, setSplitRatio] = useState(f.splitRatio ?? 0.5);
  const [editOpen, setEditOpen] = useState(false);
  const [editBucket, setEditBucket] = useState(f.positionBucket ?? '');
  const [editAction, setEditAction] = useState(f.ipsAction ?? '');
  const [editStop, setEditStop] = useState(f.stopPrice != null ? String(f.stopPrice) : '');
  const [editAddLow, setEditAddLow] = useState(f.addZoneLow != null ? String(f.addZoneLow) : '');
  const [editAddHigh, setEditAddHigh] = useState(f.addZoneHigh != null ? String(f.addZoneHigh) : '');
  const [editNote, setEditNote] = useState(f.policyNote ?? '');
  const [editSplitOn, setEditSplitOn] = useState(!!f.secondaryBucket);
  const [editSecondary, setEditSecondary] = useState(f.secondaryBucket ?? '');
  const [editRatio, setEditRatio] = useState(f.splitRatio ?? 0.5);

  const buildApproveFields = (): ProposedFields => ({
    ...f,
    ...(splitOn && secondaryBucket ? { secondaryBucket, splitRatio } : { secondaryBucket: null, splitRatio: null }),
  });

  const handleApprove = () => onAction(item.id, 'approved', buildApproveFields());

  const handleEditSave = () => {
    const fields: ProposedFields = {
      ...f,
      positionBucket: editBucket || null,
      ipsAction: editAction || null,
      stopPrice: editStop ? parseFloat(editStop) : null,
      addZoneLow: editAddLow ? parseFloat(editAddLow) : null,
      addZoneHigh: editAddHigh ? parseFloat(editAddHigh) : null,
      policyNote: editNote || null,
      secondaryBucket: editSplitOn && editSecondary ? editSecondary : null,
      splitRatio: editSplitOn && editSecondary ? editRatio : null,
    };
    onAction(item.id, 'edited', fields);
    setEditOpen(false);
  };

  const confPct = item.confidence != null ? Math.round(item.confidence * 100) : null;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.symbol}>{item.entityKey}</Text>
        <View style={styles.chipRow}>
          {f.positionBucket && <BucketChip bucket={f.positionBucket} />}
          {f.ipsAction && (
            <View style={styles.actionChip}>
              <Text style={styles.actionChipText}>{f.ipsAction}</Text>
            </View>
          )}
        </View>
      </View>

      {confPct != null && (
        <View style={styles.confRow}>
          <View style={styles.confTrack}>
            <View style={[styles.confFill, { width: `${confPct}%` as any }]} />
          </View>
          <Text style={styles.confLabel}>{confPct}% confident</Text>
        </View>
      )}

      {!!item.rationale && (
        <Text style={styles.rationale}>{item.rationale}</Text>
      )}

      {!!f.policyNote && (
        <Pressable onPress={() => setNoteExpanded(v => !v)} style={styles.noteRow}>
          <Feather name={noteExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
          <Text style={styles.noteToggle}>Policy note</Text>
          {noteExpanded && <Text style={styles.noteText}>{f.policyNote}</Text>}
        </Pressable>
      )}

      <Pressable style={styles.splitToggle} onPress={() => setSplitOn(v => !v)}>
        <View style={[styles.toggleBox, splitOn && styles.toggleBoxOn]}>
          {splitOn && <Feather name="check" size={11} color="#000" />}
        </View>
        <Text style={styles.splitLabel}>Split across two buckets</Text>
      </Pressable>

      {splitOn && (
        <View style={styles.splitConfig}>
          <Text style={styles.splitSectionLabel}>Secondary bucket</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {BUCKETS.filter(b => b !== f.positionBucket).map(b => (
              <Pressable
                key={b}
                onPress={() => setSecondaryBucket(b)}
                style={[styles.bucketOption, secondaryBucket === b && styles.bucketOptionSelected]}
              >
                <Text style={[styles.bucketOptionText, { color: BUCKET_COLORS[b] ?? '#888' }]}>{b}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={styles.splitSectionLabel}>
            {Math.round(splitRatio * 100)}% {f.positionBucket ?? 'primary'} / {Math.round((1 - splitRatio) * 100)}% {secondaryBucket || 'secondary'}
          </Text>
          <View style={styles.ratioButtons}>
            {[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(r => (
              <Pressable
                key={r}
                onPress={() => setSplitRatio(r)}
                style={[styles.ratioBtn, Math.abs(splitRatio - r) < 0.01 && styles.ratioBtnActive]}
              >
                <Text style={[styles.ratioBtnText, Math.abs(splitRatio - r) < 0.01 && styles.ratioBtnTextActive]}>
                  {Math.round(r * 100)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <View style={styles.actionRow}>
        <Pressable style={styles.approveBtn} onPress={handleApprove}>
          <Feather name="check" size={14} color="#000" />
          <Text style={styles.approveBtnText}>Approve</Text>
        </Pressable>
        <Pressable style={styles.editBtn} onPress={() => setEditOpen(true)}>
          <Feather name="edit-2" size={14} color={colors.textSecondary} />
          <Text style={styles.editBtnText}>Edit</Text>
        </Pressable>
        <Pressable style={styles.rejectBtn} onPress={() => onAction(item.id, 'rejected')}>
          <Feather name="x" size={14} color={colors.negative} />
          <Text style={styles.rejectBtnText}>Reject</Text>
        </Pressable>
      </View>

      <Modal visible={editOpen} animationType="slide" transparent presentationStyle="overFullScreen">
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalSheet} keyboardShouldPersistTaps="handled">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit {item.entityKey}</Text>
              <Pressable onPress={() => setEditOpen(false)}>
                <Feather name="x" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>Bucket</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {BUCKETS.map(b => (
                <Pressable
                  key={b}
                  onPress={() => setEditBucket(b)}
                  style={[styles.bucketOption, editBucket === b && styles.bucketOptionSelected]}
                >
                  <Text style={[styles.bucketOptionText, { color: BUCKET_COLORS[b] ?? '#888' }]}>{b}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <Text style={styles.fieldLabel}>Action</Text>
            <View style={styles.actionChipsFlex}>
              {ACTIONS.map(a => (
                <Pressable
                  key={a}
                  onPress={() => setEditAction(a)}
                  style={[styles.actionOption, editAction === a && styles.actionOptionSelected]}
                >
                  <Text style={[styles.actionOptionText, editAction === a && styles.actionOptionTextSelected]}>{a}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Stop price</Text>
            <TextInput
              style={styles.numInput}
              value={editStop}
              onChangeText={setEditStop}
              placeholder="e.g. 145.00"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
            />

            <Text style={styles.fieldLabel}>Add zone</Text>
            <View style={styles.rangeRow}>
              <TextInput
                style={[styles.numInput, { flex: 1 }]}
                value={editAddLow}
                onChangeText={setEditAddLow}
                placeholder="Low"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
              />
              <Text style={styles.rangeSep}>–</Text>
              <TextInput
                style={[styles.numInput, { flex: 1 }]}
                value={editAddHigh}
                onChangeText={setEditAddHigh}
                placeholder="High"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
              />
            </View>

            <Text style={styles.fieldLabel}>Policy note</Text>
            <TextInput
              style={styles.noteInput}
              value={editNote}
              onChangeText={setEditNote}
              placeholder="Optional policy note..."
              placeholderTextColor={colors.textMuted}
              multiline
            />

            <Pressable style={styles.splitToggle} onPress={() => setEditSplitOn(v => !v)}>
              <View style={[styles.toggleBox, editSplitOn && styles.toggleBoxOn]}>
                {editSplitOn && <Feather name="check" size={11} color="#000" />}
              </View>
              <Text style={styles.splitLabel}>Split across two buckets</Text>
            </Pressable>

            {editSplitOn && (
              <View style={styles.splitConfig}>
                <Text style={styles.splitSectionLabel}>Secondary bucket</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {BUCKETS.filter(b => b !== editBucket).map(b => (
                    <Pressable
                      key={b}
                      onPress={() => setEditSecondary(b)}
                      style={[styles.bucketOption, editSecondary === b && styles.bucketOptionSelected]}
                    >
                      <Text style={[styles.bucketOptionText, { color: BUCKET_COLORS[b] ?? '#888' }]}>{b}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <Text style={styles.splitSectionLabel}>
                  {Math.round(editRatio * 100)}% {editBucket || 'primary'} / {Math.round((1 - editRatio) * 100)}% {editSecondary || 'secondary'}
                </Text>
                <View style={styles.ratioButtons}>
                  {[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map(r => (
                    <Pressable
                      key={r}
                      onPress={() => setEditRatio(r)}
                      style={[styles.ratioBtn, Math.abs(editRatio - r) < 0.01 && styles.ratioBtnActive]}
                    >
                      <Text style={[styles.ratioBtnText, Math.abs(editRatio - r) < 0.01 && styles.ratioBtnTextActive]}>
                        {Math.round(r * 100)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            <Pressable style={styles.confirmBtn} onPress={handleEditSave}>
              <Text style={styles.confirmBtnText}>Save & Approve</Text>
            </Pressable>
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

export default function IpsReviewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<PendingItem[]>('/ips/proposals/pending-items')
      .then(data => {
        // Deduplicate by entityKey, keep latest (last in array)
        const seen = new Map<string, PendingItem>();
        for (const item of data) seen.set(item.entityKey, item);
        setItems([...seen.values()]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleAction = useCallback(async (
    id: number,
    status: 'approved' | 'rejected' | 'edited',
    editedFields?: ProposedFields,
  ) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    try {
      await apiPut(`/ips/proposals/${item.proposalId}/items/${id}`, {
        status,
        ...(editedFields ? { editedFields } : {}),
      });
    } catch {}
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setItems(prev => prev.filter(i => i.id !== id));
  }, [items]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>
          {loading
            ? 'IPS Proposals'
            : items.length > 0
            ? `${items.length} position${items.length === 1 ? '' : 's'} to review`
            : 'IPS Proposals'}
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Feather name="check-circle" size={48} color={colors.positive} />
          <Text style={styles.emptyTitle}>IPS fully committed</Text>
          <Text style={styles.emptyText}>No pending proposals to review.</Text>
          <Pressable style={styles.doneBtn} onPress={() => router.back()}>
            <Text style={styles.doneBtnText}>Back to AI</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.id.toString()}
          renderItem={({ item }) => <ProposalCard item={item} onAction={handleAction} />}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 24 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingVertical: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: colors.separator,
  },
  backBtn: { padding: 4 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20, color: colors.textPrimary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, color: colors.textPrimary },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textSecondary, textAlign: 'center' },
  doneBtn: { marginTop: 8, backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 24, paddingVertical: 12 },
  doneBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.background },

  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.separator },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  symbol: { fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.textPrimary },
  chipRow: { flexDirection: 'row', gap: 6 },
  chip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  chipText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  actionChip: {
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: colors.separator,
  },
  actionChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: colors.textSecondary },

  confRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  confTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.1)' },
  confFill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
  confLabel: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.textMuted, minWidth: 90, textAlign: 'right' },

  rationale: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textSecondary, lineHeight: 18, marginBottom: 10 },

  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 10, flexWrap: 'wrap' },
  noteToggle: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: colors.textMuted },
  noteText: { width: '100%', fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textSecondary, marginTop: 4, lineHeight: 17 },

  splitToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  toggleBox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: colors.separator, alignItems: 'center', justifyContent: 'center' },
  toggleBoxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  splitLabel: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textSecondary },

  splitConfig: { marginTop: 4, marginBottom: 8, paddingLeft: 26 },
  splitSectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: colors.textMuted, marginBottom: 6, marginTop: 8 },
  bucketOption: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.separator, marginRight: 6 },
  bucketOptionSelected: { borderColor: colors.primary, backgroundColor: 'rgba(0,212,255,0.1)' },
  bucketOptionText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },

  ratioButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ratioBtn: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: colors.separator },
  ratioBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  ratioBtnText: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textSecondary },
  ratioBtnTextActive: { color: '#000', fontFamily: 'Inter_600SemiBold' },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.separator },
  approveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 10 },
  approveBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#000' },
  editBtn: { flex: 0.7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: colors.separator },
  editBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.textSecondary },
  rejectBtn: { flex: 0.7, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: 'rgba(255,68,68,0.1)', borderRadius: 10, paddingVertical: 10, borderWidth: 1, borderColor: 'rgba(255,68,68,0.3)' },
  rejectBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.negative },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.textPrimary },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.textMuted, marginBottom: 8, marginTop: 16 },
  actionChipsFlex: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actionOption: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: colors.separator },
  actionOptionSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  actionOptionText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textSecondary },
  actionOptionTextSelected: { color: '#000', fontFamily: 'Inter_600SemiBold' },
  numInput: { backgroundColor: colors.background, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.textPrimary, fontFamily: 'Inter_400Regular', fontSize: 14, borderWidth: 1, borderColor: colors.separator },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rangeSep: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textMuted },
  noteInput: { backgroundColor: colors.background, borderRadius: 10, padding: 12, color: colors.textPrimary, fontFamily: 'Inter_400Regular', fontSize: 14, minHeight: 80, borderWidth: 1, borderColor: colors.separator },
  confirmBtn: { marginTop: 20, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: '#000' },
});
