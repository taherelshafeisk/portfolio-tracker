import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  TextInput, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { colors } from '@/constants/colors';
import { usePortfolio, apiPost, type MacroPosture } from '@/context/PortfolioContext';

// ─── Label config ─────────────────────────────────────────────────────────────

type PostureLabel = 'bull' | 'late-cycle' | 'distribution' | 'stagflation' | 'war-escalation' | 'recession' | 'neutral';

const LABEL_CONFIG: Record<PostureLabel, { color: string; bg: string; display: string }> = {
  bull:             { color: '#00E676', bg: 'rgba(0,230,118,0.15)',   display: 'Bull' },
  'late-cycle':     { color: '#F59E0B', bg: 'rgba(245,158,11,0.15)',  display: 'Late-Cycle' },
  distribution:     { color: '#FF9800', bg: 'rgba(255,152,0,0.15)',   display: 'Distribution' },
  stagflation:      { color: '#FF6B35', bg: 'rgba(255,107,53,0.15)',  display: 'Stagflation' },
  'war-escalation': { color: '#C0392B', bg: 'rgba(192,57,43,0.15)',   display: 'War Escalation' },
  recession:        { color: '#FF4757', bg: 'rgba(255,71,87,0.15)',   display: 'Recession' },
  neutral:          { color: '#8899AA', bg: 'rgba(136,153,170,0.15)', display: 'Neutral' },
};

const ALL_LABELS: PostureLabel[] = [
  'bull', 'late-cycle', 'distribution', 'stagflation', 'war-escalation', 'recession', 'neutral',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function PostureChip({ label, selected, onPress }: {
  label: PostureLabel;
  selected: boolean;
  onPress: () => void;
}) {
  const cfg = LABEL_CONFIG[label];
  return (
    <Pressable
      onPress={onPress}
      style={[
        chipStyles.chip,
        { borderColor: cfg.color, backgroundColor: selected ? cfg.bg : 'transparent' },
      ]}
    >
      <Text style={[chipStyles.chipText, { color: selected ? cfg.color : colors.textSecondary }]}>
        {cfg.display}
      </Text>
    </Pressable>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  chipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
});

// ─── Current posture display ──────────────────────────────────────────────────

function CurrentPostureDisplay({ posture }: { posture: MacroPosture | null }) {
  if (!posture || !posture.label) {
    return (
      <View style={styles.currentSection}>
        <Text style={styles.sectionTitle}>Current Posture</Text>
        <View style={styles.currentCard}>
          <Text style={styles.noPostureText}>No posture set</Text>
        </View>
      </View>
    );
  }

  const label = posture.label as PostureLabel;
  const cfg = LABEL_CONFIG[label] ?? { color: colors.textSecondary, bg: 'transparent', display: label };

  return (
    <View style={styles.currentSection}>
      <Text style={styles.sectionTitle}>Current Posture</Text>
      <View style={styles.currentCard}>
        <View style={[styles.labelChip, { backgroundColor: cfg.bg, borderColor: cfg.color }]}>
          <Text style={[styles.labelChipText, { color: cfg.color }]}>{cfg.display}</Text>
        </View>
        {posture.notes ? (
          <Text style={styles.currentNotes}>{posture.notes}</Text>
        ) : null}
        {posture.cryptoView ? (
          <View style={styles.cryptoRow}>
            <Text style={styles.cryptoLabel}>Crypto view</Text>
            <Text style={styles.cryptoValue}>{posture.cryptoView}</Text>
          </View>
        ) : null}
        {posture.setAt ? (
          <Text style={styles.setAt}>Set {formatDate(posture.setAt)}</Text>
        ) : null}
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MacroPostureScreen() {
  const insets = useSafeAreaInsets();
  const { macroPosture, fetchMacroPosture } = usePortfolio();

  const [selectedLabel, setSelectedLabel] = useState<PostureLabel | null>(null);
  const [notes, setNotes] = useState('');
  const [cryptoView, setCryptoView] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!selectedLabel) {
      Alert.alert('Select a posture', 'Please choose a market posture label before saving.');
      return;
    }
    setSaving(true);
    try {
      await apiPost('/macro-posture', {
        label: selectedLabel,
        notes: notes.trim() || undefined,
        cryptoView: cryptoView.trim() || undefined,
      });
      await fetchMacroPosture();
      setSelectedLabel(null);
      setNotes('');
      setCryptoView('');
      router.back();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save posture');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === 'web' ? 67 : insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Feather name="chevron-left" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Market Posture</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Current posture */}
        <CurrentPostureDisplay posture={macroPosture} />

        {/* Form */}
        <View style={styles.formSection}>
          <Text style={styles.sectionTitle}>Set New Posture</Text>

          {/* Label chips */}
          <Text style={styles.fieldLabel}>Market Regime</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
            {ALL_LABELS.map(label => (
              <PostureChip
                key={label}
                label={label}
                selected={selectedLabel === label}
                onPress={() => setSelectedLabel(label)}
              />
            ))}
          </ScrollView>

          {/* Notes */}
          <Text style={styles.fieldLabel}>Thesis</Text>
          <TextInput
            style={styles.textArea}
            placeholder="What's driving your view?"
            placeholderTextColor={colors.textMuted}
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />

          {/* Crypto view */}
          <Text style={styles.fieldLabel}>Crypto View</Text>
          <TextInput
            style={styles.textArea}
            placeholder="Your crypto cycle thesis..."
            placeholderTextColor={colors.textMuted}
            value={cryptoView}
            onChangeText={setCryptoView}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          {/* Save button */}
          <Pressable
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Posture'}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 4,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    color: colors.textPrimary,
  },
  scroll: {
    paddingHorizontal: 16,
    gap: 24,
  },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    color: colors.textPrimary,
    marginBottom: 12,
  },
  currentSection: {
    marginTop: 8,
  },
  currentCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    gap: 10,
  },
  labelChip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  labelChipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  currentNotes: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  cryptoRow: {
    gap: 2,
  },
  cryptoLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cryptoValue: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
  },
  setAt: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: colors.textMuted,
  },
  noPostureText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 8,
  },
  formSection: {
    gap: 12,
  },
  fieldLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  chipScroll: {
    marginBottom: 4,
  },
  textArea: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    padding: 12,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.textPrimary,
    minHeight: 88,
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: colors.background,
  },
});
