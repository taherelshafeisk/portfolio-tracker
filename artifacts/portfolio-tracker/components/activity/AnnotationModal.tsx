import React, { useState, useEffect } from 'react';
import {
  Modal, View, Text, TextInput, StyleSheet,
  Pressable, ScrollView, ActivityIndicator, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { apiGet, apiPut, TradeActivity, Position } from '@/context/PortfolioContext';

export type Verdict = 'right_decision' | 'wrong_decision' | 'too_early_to_tell';

export interface TradeAnnotationData {
  id?: number;
  activityId: number;
  thesis: string | null;
  ipsAligned: boolean | null;
  plannedExit: string | null;
  verdict: Verdict | null;
  verdictNote: string | null;
}

const VERDICT_OPTIONS: { key: Verdict | null; label: string }[] = [
  { key: null,                label: 'Not set'           },
  { key: 'right_decision',    label: 'Right decision'    },
  { key: 'wrong_decision',    label: 'Wrong decision'    },
  { key: 'too_early_to_tell', label: 'Too early to tell' },
];

interface Props {
  activity: TradeActivity | null;
  visible: boolean;
  onClose: () => void;
  onSaved: (activityId: number) => void;
  /** Positions from context — used to infer default ips_aligned */
  positions: Position[];
}

interface FormState {
  thesis: string;
  ipsAligned: boolean | null;
  tradePlan: string;
  verdict: Verdict | null;
  verdictNote: string;
}

const emptyForm = (): FormState => ({
  thesis: '',
  ipsAligned: null,
  tradePlan: '',
  verdict: null,
  verdictNote: '',
});

function inferIpsAligned(activity: TradeActivity, positions: Position[]): boolean | null {
  if (!activity.symbol) return null;
  const match = positions.find(
    p => p.symbol === activity.symbol && p.accountId === activity.accountId,
  );
  if (!match) return null;
  return (match.positionBucket != null || match.ipsAction != null) ? true : null;
}

function tradePlanPlaceholder(activityType: string): string {
  if (activityType === 'buy')  return 'Stop $X, target $Y, add only below $Z';
  if (activityType === 'sell') return 'Trim on strength, de-risk, thesis changed, or full exit condition';
  return 'Rule or condition that guided this trade';
}

export function AnnotationModal({ activity, visible, onClose, onSaved, positions }: Props) {
  const insets = useSafeAreaInsets();
  const [form, setForm] = useState<FormState>(emptyForm());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [hasExisting, setHasExisting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !activity) return;
    setSaveError(null);

    const load = async () => {
      setLoading(true);
      try {
        const existing = await apiGet<TradeAnnotationData | null>(`/activities/${activity.id}/annotation`);
        if (existing) {
          setHasExisting(true);
          setForm({
            thesis:      existing.thesis      ?? '',
            ipsAligned:  existing.ipsAligned  ?? null,
            tradePlan:   existing.plannedExit ?? '',
            verdict:     existing.verdict     ?? null,
            verdictNote: existing.verdictNote ?? '',
          });
        } else {
          setHasExisting(false);
          setForm({ ...emptyForm(), ipsAligned: inferIpsAligned(activity, positions) });
        }
      } catch (err) {
        console.error('[AnnotationModal] load failed:', err);
        setForm(emptyForm());
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [visible, activity?.id]);

  const set = <K extends keyof FormState>(field: K) => (value: FormState[K]) =>
    setForm(f => ({ ...f, [field]: value }));

  const handleSave = async () => {
    if (!activity || submitting) return;
    setSaveError(null);
    setSubmitting(true);
    try {
      await apiPut(`/activities/${activity.id}/annotation`, {
        thesis:       form.thesis.trim()     || null,
        ips_aligned:  form.ipsAligned,
        planned_exit: form.tradePlan.trim()  || null,
        verdict:      form.verdict,
        verdict_note: form.verdictNote.trim() || null,
      });
      onSaved(activity.id);
      onClose();
    } catch (err) {
      console.error('[AnnotationModal] save failed:', err);
      setSaveError('Failed to save. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!activity) return null;

  const tradeLabel = activity.symbol
    ? `${activity.activityType.toUpperCase()} ${activity.symbol}`
    : activity.activityType.toUpperCase();

  const bottomPad = Platform.OS === 'web' ? 24 : insets.bottom + 16;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Feather name="x" size={20} color={colors.textSecondary} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Feather name="book-open" size={14} color={colors.primary} />
            <Text style={styles.headerTitle}>Trade Journal</Text>
          </View>
          <Text style={styles.headerSub}>{tradeLabel}</Text>
        </View>

        {/* ── Body — save button lives inside ScrollView to avoid web overflow issue ── */}
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Thesis */}
            <Text style={styles.label}>Why did I make this trade?</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder="Thesis…"
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={3}
              value={form.thesis}
              onChangeText={set('thesis')}
            />

            {/* IPS Aligned */}
            <Text style={styles.label}>IPS Aligned</Text>
            <Text style={styles.labelSub}>Did this trade follow my policy at the time?</Text>
            <View style={styles.toggleGroup}>
              {([true, false] as const).map(val => {
                const active = form.ipsAligned === val;
                const activeColor = val ? colors.positive : colors.negative;
                return (
                  <Pressable
                    key={String(val)}
                    style={[
                      styles.toggleChip,
                      active && { borderColor: activeColor, backgroundColor: activeColor + '22' },
                    ]}
                    onPress={() => set('ipsAligned')(active ? null : val)}
                  >
                    <Text style={[styles.toggleChipText, active && { color: activeColor }]}>
                      {val ? 'Yes' : 'No'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Trade Plan */}
            <Text style={[styles.label, { marginTop: 20 }]}>Trade Plan</Text>
            <TextInput
              style={styles.input}
              placeholder={tradePlanPlaceholder(activity.activityType)}
              placeholderTextColor={colors.textMuted}
              value={form.tradePlan}
              onChangeText={set('tradePlan')}
            />

            {/* Verdict */}
            <Text style={styles.label}>Verdict</Text>
            <Text style={styles.labelSub}>You can leave this unset and review later.</Text>
            <View style={styles.chipRow}>
              {VERDICT_OPTIONS.map(opt => {
                const active = form.verdict === opt.key;
                let activeColor = colors.primary;
                if (opt.key === 'right_decision')    activeColor = colors.positive;
                if (opt.key === 'wrong_decision')    activeColor = colors.negative;
                if (opt.key === 'too_early_to_tell') activeColor = '#F5A623';
                return (
                  <Pressable
                    key={String(opt.key)}
                    style={[
                      styles.chip,
                      active && { borderColor: activeColor, backgroundColor: activeColor + '22' },
                    ]}
                    onPress={() => set('verdict')(opt.key)}
                  >
                    <Text style={[styles.chipText, active && { color: activeColor }]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Verdict Note — only when verdict is set */}
            {form.verdict !== null && (
              <>
                <Text style={styles.label}>Reflection</Text>
                <TextInput
                  style={[styles.input, styles.multiline]}
                  placeholder="What would I do differently? What did I learn?"
                  placeholderTextColor={colors.textMuted}
                  multiline
                  numberOfLines={3}
                  value={form.verdictNote}
                  onChangeText={set('verdictNote')}
                />
              </>
            )}

            {/* Inline error — visible on all platforms */}
            {saveError !== null && (
              <View style={styles.errorBanner}>
                <Feather name="alert-circle" size={13} color={colors.negative} />
                <Text style={styles.errorText}>{saveError}</Text>
              </View>
            )}

            {/* Save — inside ScrollView so it can never be covered by scroll overflow */}
            <Pressable
              style={[styles.saveBtn, submitting && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={submitting}
            >
              {submitting
                ? <ActivityIndicator color={colors.background} size="small" />
                : <Text style={styles.saveBtnText}>
                    {hasExisting ? 'Update Journal Entry' : 'Save Journal Entry'}
                  </Text>
              }
            </Pressable>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  headerTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: colors.textPrimary,
  },
  headerSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  labelSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 10,
  },
  input: {
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
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  toggleGroup: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  toggleChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
  },
  toggleChipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.textMuted,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
  },
  chipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.textSecondary,
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
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: colors.background,
  },
});
