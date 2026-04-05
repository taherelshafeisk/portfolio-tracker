import React, { useState, useEffect } from 'react';
import {
  Modal, View, Text, TextInput, StyleSheet,
  Pressable, ScrollView, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { colors } from '@/constants/colors';
import { apiPut, Position } from '@/context/PortfolioContext';

const POSITION_BUCKETS = [
  { key: 'core',   label: 'Core'   },
  { key: 'swing',  label: 'Swing'  },
  { key: 'spec',   label: 'Spec'   },
  { key: 'def',    label: 'Def'    },
  { key: 'anchor', label: 'Anchor' },
  { key: 'inc',    label: 'Inc'    },
  { key: 'cut',    label: 'Cut'    },
];

const IPS_ACTIONS = [
  { key: 'hold',    label: 'Hold'    },
  { key: 'add',     label: 'Add'     },
  { key: 'trim',    label: 'Trim'    },
  { key: 'monitor', label: 'Monitor' },
  { key: 'cut',     label: 'Cut'     },
  { key: 'exit',    label: 'Exit'    },
];

interface PolicyForm {
  positionBucket: string;
  ipsAction: string;
  stopPrice: string;
  addZoneLow: string;
  addZoneHigh: string;
  policyNote: string;
}

function formFromPosition(position: Position): PolicyForm {
  return {
    positionBucket: position.positionBucket ?? '',
    ipsAction:      position.ipsAction ?? '',
    stopPrice:      position.stopPrice != null ? String(position.stopPrice) : '',
    addZoneLow:     position.addZoneLow != null ? String(position.addZoneLow) : '',
    addZoneHigh:    position.addZoneHigh != null ? String(position.addZoneHigh) : '',
    policyNote:     position.policyNote ?? '',
  };
}

interface Props {
  position: Position;
  visible: boolean;
  onClose: () => void;
  onSaved: (updated: Position) => void;
}

export function EditPolicyModal({ position, visible, onClose, onSaved }: Props) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PolicyForm>(formFromPosition(position));
  const [submitting, setSubmitting] = useState(false);

  // Re-sync form whenever the modal opens with a (possibly updated) position
  useEffect(() => {
    if (visible) setForm(formFromPosition(position));
  }, [visible, position]);

  const set = (field: keyof PolicyForm) => (value: string) =>
    setForm(f => ({ ...f, [field]: value }));

  const toggleChip = (field: 'positionBucket' | 'ipsAction', key: string) =>
    setForm(f => ({ ...f, [field]: f[field] === key ? '' : key }));

  const handleSave = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const updated = await apiPut<Position>(`/positions/${position.id}`, {
        // Pass through the existing market-data fields unchanged
        quantity:    position.quantity,
        avgCost:     position.avgCost,
        assetType:   position.assetType,
        notes:       position.notes,
        // Policy fields — null clears the value
        positionBucket: form.positionBucket || null,
        ipsAction:      form.ipsAction || null,
        stopPrice:      form.stopPrice ? parseFloat(form.stopPrice) : null,
        addZoneLow:     form.addZoneLow ? parseFloat(form.addZoneLow) : null,
        addZoneHigh:    form.addZoneHigh ? parseFloat(form.addZoneHigh) : null,
        policyNote:     form.policyNote || null,
      });
      // Invalidate so PortfolioContext picks up the change on next refetch
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      onSaved(updated);
      onClose();
    } catch {
      Alert.alert('Error', 'Failed to save policy. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.sheet, { paddingBottom: Platform.OS === 'web' ? 24 : insets.bottom + 16 }]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Edit Policy — {position.symbol}</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Feather name="x" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
          {/* IPS Category */}
          <Text style={styles.sectionLabel}>IPS Category</Text>
          <View style={styles.chipRow}>
            {POSITION_BUCKETS.map(b => {
              const active = form.positionBucket === b.key;
              return (
                <Pressable
                  key={b.key}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => toggleChip('positionBucket', b.key)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{b.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* IPS Action */}
          <Text style={[styles.sectionLabel, { marginTop: 20 }]}>IPS Action</Text>
          <View style={styles.chipRow}>
            {IPS_ACTIONS.map(a => {
              const active = form.ipsAction === a.key;
              return (
                <Pressable
                  key={a.key}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => toggleChip('ipsAction', a.key)}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{a.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Price levels */}
          <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Price Levels</Text>
          <View style={styles.priceRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Stop ($)"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              value={form.stopPrice}
              onChangeText={set('stopPrice')}
            />
            <TextInput
              style={[styles.input, { flex: 1, marginLeft: 8 }]}
              placeholder="Add low ($)"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              value={form.addZoneLow}
              onChangeText={set('addZoneLow')}
            />
            <TextInput
              style={[styles.input, { flex: 1, marginLeft: 8 }]}
              placeholder="Add high ($)"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              value={form.addZoneHigh}
              onChangeText={set('addZoneHigh')}
            />
          </View>

          {/* Policy note */}
          <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Policy Note</Text>
          <TextInput
            style={[styles.input, styles.noteInput]}
            placeholder="Optional note…"
            placeholderTextColor={colors.textMuted}
            multiline
            value={form.policyNote}
            onChangeText={set('policyNote')}
          />
        </ScrollView>

        {/* Save */}
        <Pressable
          style={[styles.saveBtn, submitting && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color={colors.background} size="small" />
            : <Text style={styles.saveBtnText}>Save Policy</Text>
          }
        </Pressable>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 17,
    color: colors.textPrimary,
  },
  body: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  sectionLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.separator,
    backgroundColor: colors.surface,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '22',
  },
  chipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.primary,
  },
  priceRow: {
    flexDirection: 'row',
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
  },
  noteInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  saveBtn: {
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: colors.primary,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  saveBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    color: colors.background,
  },
});
