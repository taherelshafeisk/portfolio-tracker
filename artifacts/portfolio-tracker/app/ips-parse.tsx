import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Platform, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { apiPost, apiPut } from '@/context/PortfolioContext';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProposedFields {
  positionBucket?: string | null;
  ipsAction?: string | null;
  stopPrice?: number | null;
  addZoneLow?: number | null;
  addZoneHigh?: number | null;
  policyNote?: string | null;
}

interface ProposalItem {
  id: number;
  proposalId: number;
  entityType: string;
  entityKey: string;
  proposedFields: ProposedFields;
  confidence: number | null;
  rationale: string | null;
  evidenceSnippet: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'edited';
}

interface ParseResponse {
  id: number;
  ipsVersion: string | null;
  sourceFilename: string | null;
  status: string;
  createdAt: string;
  items: ProposalItem[];
  globalQuestions: string[];
  unmatched: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BUCKET_OPTIONS = ['core', 'swing', 'speculative', 'crypto', 'cash'];
const ACTION_OPTIONS = ['hold', 'add', 'trim', 'cut', 'watch'];

const BUCKET_COLOR: Record<string, string> = {
  core:        colors.positive,
  swing:       colors.primary,
  speculative: '#F5A623',
  crypto:      '#9B59B6',
  cash:        colors.textMuted,
};
const ACTION_COLOR: Record<string, string> = {
  hold:  colors.textMuted,
  add:   colors.positive,
  trim:  '#F5A623',
  cut:   colors.negative,
  watch: colors.primary,
};

// ── Main screen ───────────────────────────────────────────────────────────────

export default function IpsParsScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  // Step state
  const [step, setStep] = useState<'input' | 'reviewing' | 'done'>('input');

  // Input step
  const [ipsText, setIpsText] = useState('');
  const [ipsVersion, setIpsVersion] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Review step
  const [proposalId, setProposalId] = useState<number | null>(null);
  const [items, setItems] = useState<ProposalItem[]>([]);
  const [globalQuestions, setGlobalQuestions] = useState<string[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);

  // Per-item UI state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<ProposedFields>({});
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  // ── Derived stats ─────────────────────────────────────────────────────────

  const reviewed  = items.filter(i => i.status !== 'pending').length;
  const approved  = items.filter(i => i.status === 'approved' || i.status === 'edited').length;
  const rejected  = items.filter(i => i.status === 'rejected').length;
  const skipped   = items.filter(i => i.status === 'pending').length;

  // ── Parse ─────────────────────────────────────────────────────────────────

  const handleParse = useCallback(async () => {
    if (!ipsText.trim()) return;
    setParsing(true);
    setParseError(null);
    try {
      const result = await apiPost<ParseResponse>('/ips/parse', {
        text:       ipsText.trim(),
        ipsVersion: ipsVersion.trim() || undefined,
      });
      setProposalId(result.id);
      setItems(result.items);
      setGlobalQuestions(result.globalQuestions);
      setUnmatched(result.unmatched);
      setStep('reviewing');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Parse failed');
    } finally {
      setParsing(false);
    }
  }, [ipsText, ipsVersion]);

  // ── Item actions ──────────────────────────────────────────────────────────

  const applyAction = useCallback(async (
    item: ProposalItem,
    status: 'approved' | 'rejected' | 'edited',
    editedFields?: ProposedFields,
  ) => {
    if (!proposalId) return;
    setActionLoading(item.id);
    try {
      const updated = await apiPut<ProposalItem>(
        `/ips/proposals/${proposalId}/items/${item.id}`,
        { status, editedFields },
      );
      setItems(prev => prev.map(i => i.id === item.id ? updated : i));
      if (editingId === item.id) setEditingId(null);
    } catch (err) {
      console.error('[IpsParse] action failed:', err);
    } finally {
      setActionLoading(null);
    }
  }, [proposalId, editingId]);

  const startEdit = useCallback((item: ProposalItem) => {
    setEditDraft({ ...item.proposedFields });
    setEditingId(item.id);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditDraft({});
  }, []);

  const applyEdit = useCallback((item: ProposalItem) => {
    applyAction(item, 'edited', editDraft);
    setEditDraft({});
  }, [applyAction, editDraft]);

  // ── Render: input step ────────────────────────────────────────────────────

  if (step === 'input') {
    return (
      <View style={[styles.container, { paddingTop: topPad }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Feather name="arrow-left" size={20} color={colors.textSecondary} />
          </Pressable>
          <Text style={styles.headerTitle}>Parse IPS</Text>
          <View style={styles.backBtn} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.inputScroll, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.sectionLabel}>IPS Version</Text>
          <TextInput
            style={styles.versionInput}
            placeholder="e.g. v2.3 — Jan 2026"
            placeholderTextColor={colors.textMuted}
            value={ipsVersion}
            onChangeText={setIpsVersion}
          />

          <Text style={styles.sectionLabel}>Paste IPS text</Text>
          <Text style={styles.sectionHint}>
            Paste the position table or rules section — not session notes. Include rows with symbols, buckets, stop prices, and actions.
          </Text>
          <TextInput
            style={styles.textArea}
            placeholder="AAPL — Core position. Add below $170. Stop $145. Trim above $220..."
            placeholderTextColor={colors.textMuted}
            multiline
            value={ipsText}
            onChangeText={setIpsText}
            textAlignVertical="top"
          />

          {parseError && (
            <View style={styles.errorBanner}>
              <Feather name="alert-circle" size={13} color={colors.negative} />
              <Text style={styles.errorText}>{parseError}</Text>
            </View>
          )}

          <Pressable
            style={[styles.parseBtn, (!ipsText.trim() || parsing) && styles.parseBtnDisabled]}
            onPress={handleParse}
            disabled={!ipsText.trim() || parsing}
          >
            {parsing
              ? <ActivityIndicator color={colors.background} size="small" />
              : <>
                  <Feather name="cpu" size={16} color={colors.background} />
                  <Text style={styles.parseBtnText}>Parse with AI</Text>
                </>
            }
          </Pressable>

          <Pressable
            style={styles.secondaryBtn}
            onPress={() => router.push('/proposal-review')}
          >
            <Text style={styles.secondaryBtnText}>Review proposals</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── Render: done step ─────────────────────────────────────────────────────

  if (step === 'done') {
    return (
      <View style={[styles.container, { paddingTop: topPad }]}>
        <View style={styles.header}>
          <View style={styles.backBtn} />
          <Text style={styles.headerTitle}>Review Complete</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.doneWrap}>
          <Feather name="check-circle" size={56} color={colors.positive} />
          <Text style={styles.doneTitle}>Proposal applied</Text>
          <View style={styles.doneStats}>
            <View style={styles.doneStat}>
              <Text style={[styles.doneStatVal, { color: colors.positive }]}>{approved}</Text>
              <Text style={styles.doneStatLabel}>approved</Text>
            </View>
            <View style={styles.doneStatDivider} />
            <View style={styles.doneStat}>
              <Text style={[styles.doneStatVal, { color: colors.negative }]}>{rejected}</Text>
              <Text style={styles.doneStatLabel}>rejected</Text>
            </View>
            <View style={styles.doneStatDivider} />
            <View style={styles.doneStat}>
              <Text style={[styles.doneStatVal, { color: colors.textMuted }]}>{skipped}</Text>
              <Text style={styles.doneStatLabel}>skipped</Text>
            </View>
          </View>
          <Pressable style={styles.parseBtn} onPress={() => router.replace('/(tabs)')}>
            <Feather name="pie-chart" size={16} color={colors.background} />
            <Text style={styles.parseBtnText}>View Portfolio</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryBtn}
            onPress={() => {
              setStep('input');
              setIpsText('');
              setIpsVersion('');
              setItems([]);
              setGlobalQuestions([]);
              setProposalId(null);
            }}
          >
            <Text style={styles.secondaryBtnText}>Parse another document</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Render: review step ───────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => setStep('input')} style={styles.backBtn} hitSlop={8}>
          <Feather name="arrow-left" size={20} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.headerTitle}>Review Proposals</Text>
        <Pressable
          style={styles.doneBtn}
          onPress={() => setStep('done')}
        >
          <Text style={styles.doneBtnText}>Finish</Text>
        </Pressable>
      </View>

      {/* Progress bar */}
      <View style={styles.progressRow}>
        <Text style={styles.progressText}>
          {reviewed} of {items.length} reviewed
        </Text>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: items.length > 0 ? `${(reviewed / items.length) * 100}%` : '0%' },
            ]}
          />
        </View>
      </View>

      <FlatList
        data={items}
        keyExtractor={i => String(i.id)}
        contentContainerStyle={[
          styles.reviewList,
          { paddingBottom: Platform.OS === 'web' ? 100 : insets.bottom + 90 },
        ]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {/* Global questions banner */}
            {globalQuestions.length > 0 && (
              <View style={styles.questionsBanner}>
                <View style={styles.questionsBannerHeader}>
                  <Feather name="help-circle" size={14} color="#F5A623" />
                  <Text style={styles.questionsBannerTitle}>
                    AI flagged {globalQuestions.length} question{globalQuestions.length > 1 ? 's' : ''}
                  </Text>
                </View>
                {globalQuestions.map((q, i) => (
                  <Text key={i} style={styles.questionItem}>· {q}</Text>
                ))}
              </View>
            )}

            {/* Unmatched symbols */}
            {unmatched.length > 0 && (
              <View style={styles.unmatchedBanner}>
                <Text style={styles.unmatchedText}>
                  Not in portfolio: {unmatched.join(', ')}
                </Text>
              </View>
            )}
          </>
        }
        renderItem={({ item }) => (
          <ProposalCard
            item={item}
            isEditing={editingId === item.id}
            editDraft={editDraft}
            setEditDraft={setEditDraft}
            actionLoading={actionLoading === item.id}
            onApprove={() => applyAction(item, 'approved')}
            onReject={() => applyAction(item, 'rejected')}
            onStartEdit={() => startEdit(item)}
            onApplyEdit={() => applyEdit(item)}
            onCancelEdit={cancelEdit}
          />
        )}
      />
    </View>
  );
}

// ── ProposalCard ──────────────────────────────────────────────────────────────

interface CardProps {
  item: ProposalItem;
  isEditing: boolean;
  editDraft: ProposedFields;
  setEditDraft: React.Dispatch<React.SetStateAction<ProposedFields>>;
  actionLoading: boolean;
  onApprove: () => void;
  onReject: () => void;
  onStartEdit: () => void;
  onApplyEdit: () => void;
  onCancelEdit: () => void;
}

function ProposalCard({
  item, isEditing, editDraft, setEditDraft, actionLoading,
  onApprove, onReject, onStartEdit, onApplyEdit, onCancelEdit,
}: CardProps) {
  const done = item.status !== 'pending';
  const bucketColor = item.proposedFields.positionBucket
    ? (BUCKET_COLOR[item.proposedFields.positionBucket] ?? colors.textMuted)
    : null;
  const actionColor = item.proposedFields.ipsAction
    ? (ACTION_COLOR[item.proposedFields.ipsAction] ?? colors.textMuted)
    : null;
  const lowConf = item.confidence != null && item.confidence < 0.6;

  const statusColor = item.status === 'approved' || item.status === 'edited'
    ? colors.positive
    : item.status === 'rejected'
    ? colors.negative
    : colors.textMuted;
  const statusLabel =
    item.status === 'approved' ? 'Approved'
    : item.status === 'edited' ? 'Approved (edited)'
    : item.status === 'rejected' ? 'Rejected'
    : null;

  return (
    <View style={[styles.card, done && styles.cardDone]}>
      {/* Card header */}
      <View style={styles.cardHeaderRow}>
        <Text style={styles.cardSymbol}>{item.entityKey}</Text>
        <View style={styles.cardBadges}>
          {item.proposedFields.positionBucket && bucketColor && (
            <View style={[styles.badge, { backgroundColor: bucketColor + '22', borderColor: bucketColor + '55' }]}>
              <Text style={[styles.badgeText, { color: bucketColor }]}>
                {item.proposedFields.positionBucket.toUpperCase()}
              </Text>
            </View>
          )}
          {item.proposedFields.ipsAction && actionColor && (
            <View style={[styles.badge, { backgroundColor: actionColor + '22', borderColor: actionColor + '55' }]}>
              <Text style={[styles.badgeText, { color: actionColor }]}>
                {item.proposedFields.ipsAction.toUpperCase()}
              </Text>
            </View>
          )}
          {lowConf && (
            <View style={[styles.badge, { backgroundColor: colors.negative + '18', borderColor: colors.negative + '44' }]}>
              <Feather name="alert-triangle" size={9} color={colors.negative} />
              <Text style={[styles.badgeText, { color: colors.negative }]}>LOW CONF</Text>
            </View>
          )}
        </View>
        {statusLabel && (
          <Text style={[styles.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
        )}
      </View>

      {/* Confidence bar */}
      {item.confidence != null && (
        <View style={styles.confRow}>
          <Text style={styles.confLabel}>Confidence</Text>
          <View style={styles.confTrack}>
            <View
              style={[
                styles.confFill,
                {
                  width: `${Math.round(item.confidence * 100)}%` as any,
                  backgroundColor: lowConf ? colors.negative : colors.positive,
                },
              ]}
            />
          </View>
          <Text style={styles.confPct}>{Math.round(item.confidence * 100)}%</Text>
        </View>
      )}

      {/* Proposed numeric fields */}
      {(item.proposedFields.stopPrice != null ||
        item.proposedFields.addZoneLow != null ||
        item.proposedFields.addZoneHigh != null) && (
        <View style={styles.priceRow}>
          {item.proposedFields.stopPrice != null && (
            <View style={styles.priceChip}>
              <Text style={styles.priceChipLabel}>Stop</Text>
              <Text style={styles.priceChipVal}>${item.proposedFields.stopPrice}</Text>
            </View>
          )}
          {(item.proposedFields.addZoneLow != null || item.proposedFields.addZoneHigh != null) && (
            <View style={styles.priceChip}>
              <Text style={styles.priceChipLabel}>Add zone</Text>
              <Text style={styles.priceChipVal}>
                ${item.proposedFields.addZoneLow ?? '?'} – ${item.proposedFields.addZoneHigh ?? '?'}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Policy note */}
      {item.proposedFields.policyNote && (
        <Text style={styles.policyNote}>{item.proposedFields.policyNote}</Text>
      )}

      {/* Evidence snippet */}
      {item.evidenceSnippet && (
        <Text style={styles.evidence}>"{item.evidenceSnippet}"</Text>
      )}

      {/* Rationale */}
      {item.rationale && (
        <Text style={styles.rationale}>{item.rationale}</Text>
      )}

      {/* Edit form */}
      {isEditing && (
        <EditForm
          draft={editDraft}
          onChange={setEditDraft}
          onApply={onApplyEdit}
          onCancel={onCancelEdit}
          loading={actionLoading}
        />
      )}

      {/* Action buttons — hidden once done or while editing */}
      {!done && !isEditing && (
        <View style={styles.actionRow}>
          <Pressable
            style={[styles.actionBtn, styles.approveBtn]}
            onPress={onApprove}
            disabled={actionLoading}
          >
            {actionLoading
              ? <ActivityIndicator color={colors.background} size="small" />
              : <>
                  <Feather name="check" size={14} color={colors.background} />
                  <Text style={styles.approveBtnText}>Approve</Text>
                </>
            }
          </Pressable>
          <Pressable
            style={[styles.actionBtn, styles.editBtn]}
            onPress={onStartEdit}
            disabled={actionLoading}
          >
            <Feather name="edit-2" size={14} color={colors.primary} />
            <Text style={styles.editBtnText}>Edit</Text>
          </Pressable>
          <Pressable
            style={[styles.actionBtn, styles.rejectBtn]}
            onPress={onReject}
            disabled={actionLoading}
          >
            <Feather name="x" size={14} color={colors.negative} />
            <Text style={styles.rejectBtnText}>Reject</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ── EditForm ──────────────────────────────────────────────────────────────────

interface EditFormProps {
  draft: ProposedFields;
  onChange: React.Dispatch<React.SetStateAction<ProposedFields>>;
  onApply: () => void;
  onCancel: () => void;
  loading: boolean;
}

function EditForm({ draft, onChange, onApply, onCancel, loading }: EditFormProps) {
  const set = <K extends keyof ProposedFields>(k: K) => (v: ProposedFields[K]) =>
    onChange(d => ({ ...d, [k]: v }));

  return (
    <View style={styles.editForm}>
      <View style={styles.editDivider} />

      {/* Bucket chips */}
      <Text style={styles.editLabel}>Bucket</Text>
      <View style={styles.chipRow}>
        {BUCKET_OPTIONS.map(b => {
          const active = draft.positionBucket === b;
          const c = BUCKET_COLOR[b] ?? colors.textMuted;
          return (
            <Pressable
              key={b}
              style={[styles.chip, active && { borderColor: c, backgroundColor: c + '22' }]}
              onPress={() => set('positionBucket')(active ? null : b)}
            >
              <Text style={[styles.chipText, active && { color: c }]}>
                {b}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Action chips */}
      <Text style={styles.editLabel}>Action</Text>
      <View style={styles.chipRow}>
        {ACTION_OPTIONS.map(a => {
          const active = draft.ipsAction === a;
          const c = ACTION_COLOR[a] ?? colors.textMuted;
          return (
            <Pressable
              key={a}
              style={[styles.chip, active && { borderColor: c, backgroundColor: c + '22' }]}
              onPress={() => set('ipsAction')(active ? null : a)}
            >
              <Text style={[styles.chipText, active && { color: c }]}>
                {a}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Stop price */}
      <Text style={styles.editLabel}>Stop price</Text>
      <TextInput
        style={styles.editInput}
        placeholder="e.g. 145.00"
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
        value={draft.stopPrice != null ? String(draft.stopPrice) : ''}
        onChangeText={v => set('stopPrice')(v ? parseFloat(v) : null)}
      />

      {/* Add zone */}
      <Text style={styles.editLabel}>Add zone (low – high)</Text>
      <View style={styles.priceRange}>
        <TextInput
          style={[styles.editInput, styles.editInputHalf]}
          placeholder="Low"
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          value={draft.addZoneLow != null ? String(draft.addZoneLow) : ''}
          onChangeText={v => set('addZoneLow')(v ? parseFloat(v) : null)}
        />
        <Text style={styles.rangeDash}>–</Text>
        <TextInput
          style={[styles.editInput, styles.editInputHalf]}
          placeholder="High"
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          value={draft.addZoneHigh != null ? String(draft.addZoneHigh) : ''}
          onChangeText={v => set('addZoneHigh')(v ? parseFloat(v) : null)}
        />
      </View>

      {/* Policy note */}
      <Text style={styles.editLabel}>Policy note</Text>
      <TextInput
        style={[styles.editInput, styles.editInputMultiline]}
        placeholder="Optional note"
        placeholderTextColor={colors.textMuted}
        multiline
        value={draft.policyNote ?? ''}
        onChangeText={v => set('policyNote')(v || null)}
        textAlignVertical="top"
      />

      {/* Apply / cancel */}
      <View style={styles.editActions}>
        <Pressable style={styles.applyBtn} onPress={onApply} disabled={loading}>
          {loading
            ? <ActivityIndicator color={colors.background} size="small" />
            : <Text style={styles.applyBtnText}>Apply & Approve</Text>
          }
        </Pressable>
        <Pressable style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  headerTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    color: colors.textPrimary,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.primary + '22',
  },
  doneBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.primary,
  },

  // Input step
  inputScroll: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  sectionLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  sectionHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 8,
  },
  versionInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: 20,
  },
  textArea: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textPrimary,
    minHeight: 200,
    marginBottom: 16,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.negative + '18',
    borderWidth: 1,
    borderColor: colors.negative + '44',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  errorText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.negative,
    flex: 1,
  },
  parseBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  parseBtnDisabled: { opacity: 0.4 },
  parseBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: colors.background,
  },
  secondaryBtn: {
    padding: 14,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: colors.textMuted,
  },

  // Review step
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  progressText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: colors.textMuted,
    minWidth: 90,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.separator,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: colors.positive,
  },
  reviewList: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },

  // Banners
  questionsBanner: {
    backgroundColor: '#F5A623' + '14',
    borderWidth: 1,
    borderColor: '#F5A623' + '44',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    gap: 4,
  },
  questionsBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  questionsBannerTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#F5A623',
  },
  questionItem: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  unmatchedBanner: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  unmatchedText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: colors.textMuted,
  },

  // Card
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.separator,
    padding: 14,
    gap: 8,
    marginBottom: 2,
  },
  cardDone: { opacity: 0.6 },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  cardSymbol: {
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    color: colors.textPrimary,
    marginRight: 2,
  },
  cardBadges: {
    flexDirection: 'row',
    gap: 5,
    flexWrap: 'wrap',
    flex: 1,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
  },
  badgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
    letterSpacing: 0.3,
  },
  statusLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    marginLeft: 'auto',
  },

  // Confidence bar
  confRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  confLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    color: colors.textMuted,
    width: 64,
  },
  confTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.separator,
    overflow: 'hidden',
  },
  confFill: {
    height: '100%',
    borderRadius: 2,
  },
  confPct: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    color: colors.textMuted,
    width: 30,
    textAlign: 'right',
  },

  // Price chips
  priceRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  priceChip: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  priceChipLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 9,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  priceChipVal: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.textPrimary,
  },

  // Text fields
  policyNote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textSecondary,
  },
  evidence: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: colors.textMuted,
    fontStyle: 'italic',
    borderLeftWidth: 2,
    borderLeftColor: colors.separator,
    paddingLeft: 8,
  },
  rationale: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: colors.textMuted,
  },

  // Action buttons
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  approveBtn: {
    backgroundColor: colors.positive,
    borderColor: colors.positive,
    flex: 2,
  },
  approveBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.background,
  },
  editBtn: {
    backgroundColor: colors.primary + '18',
    borderColor: colors.primary + '44',
  },
  editBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.primary,
  },
  rejectBtn: {
    backgroundColor: colors.negative + '14',
    borderColor: colors.negative + '44',
  },
  rejectBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.negative,
  },

  // Edit form
  editForm: { gap: 8 },
  editDivider: {
    height: 1,
    backgroundColor: colors.separator,
    marginVertical: 4,
  },
  editLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.background,
  },
  chipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: colors.textMuted,
  },
  editInput: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.separator,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  editInputHalf: { flex: 1 },
  editInputMultiline: { minHeight: 60, textAlignVertical: 'top' },
  priceRange: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  rangeDash: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.textMuted,
  },
  editActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  applyBtn: {
    flex: 2,
    backgroundColor: colors.positive,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  applyBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.background,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.separator,
  },
  cancelBtnText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.textMuted,
  },

  // Done step
  doneWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  doneTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
    color: colors.textPrimary,
  },
  doneStats: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.separator,
    paddingVertical: 16,
    paddingHorizontal: 24,
    gap: 0,
    width: '100%',
    justifyContent: 'space-around',
  },
  doneStat: { alignItems: 'center', gap: 4 },
  doneStatVal: { fontFamily: 'Inter_700Bold', fontSize: 28 },
  doneStatLabel: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.textMuted },
  doneStatDivider: { width: 1, height: 40, backgroundColor: colors.separator },
});
