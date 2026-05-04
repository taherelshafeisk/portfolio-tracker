import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  Pressable, Alert, Platform, Image, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { colors } from '@/constants/colors';

// ─── Types ───────────────────────────────────────────────────────────────────
type SourceType = 'NEWS' | 'VIDEO' | 'PERSON' | 'OWN_THESIS';

interface PickedImage {
  uri: string;
  mimeType: string;
  fileName: string;
}

const SOURCE_OPTIONS: Array<{ value: SourceType; label: string; icon: string }> = [
  { value: 'NEWS',       label: 'News',      icon: 'file-text'  },
  { value: 'VIDEO',      label: 'Video',     icon: 'play-circle' },
  { value: 'PERSON',     label: 'Person',    icon: 'user'        },
  { value: 'OWN_THESIS', label: 'My Thesis', icon: 'edit-3'      },
];

// ─── API base ─────────────────────────────────────────────────────────────────
import { resolveApiBaseUrl } from '@/utils/apiUrl';
const BASE = resolveApiBaseUrl();

// ─── Tag Input ────────────────────────────────────────────────────────────────
function TagInput({
  label, placeholder, tags, onAdd, onRemove,
}: {
  label: string;
  placeholder: string;
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const [text, setText] = useState('');

  const commit = () => {
    const trimmed = text.trim().toUpperCase();
    if (trimmed && !tags.includes(trimmed)) onAdd(trimmed);
    setText('');
  };

  return (
    <View style={ts.container}>
      <Text style={ts.label}>{label}</Text>
      <View style={ts.row}>
        {tags.map(t => (
          <Pressable key={t} onPress={() => onRemove(t)} style={ts.tag}>
            <Text style={ts.tagText}>{t}</Text>
            <Feather name="x" size={10} color={colors.primary} />
          </Pressable>
        ))}
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          style={ts.input}
          onSubmitEditing={commit}
          blurOnSubmit={false}
          returnKeyType="done"
          autoCapitalize="characters"
        />
      </View>
    </View>
  );
}

const ts = StyleSheet.create({
  container: { gap: 6 },
  label: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.textSecondary },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surfaceElevated, minHeight: 44 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(0,212,255,0.12)', borderWidth: 1, borderColor: 'rgba(0,212,255,0.25)' },
  tagText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: colors.primary },
  input: { flex: 1, minWidth: 80, fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, padding: 0 },
});

// ─── Main screen ─────────────────────────────────────────────────────────────
export default function ConvictionCaptureScreen() {
  const insets = useSafeAreaInsets();

  const [sourceType, setSourceType] = useState<SourceType>('NEWS');
  const [sourceName, setSourceName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [urlHint, setUrlHint] = useState('');
  const [rawNote, setRawNote] = useState('');
  const [tickers, setTickers] = useState<string[]>([]);
  const [themes, setThemes] = useState<string[]>([]);
  const [images, setImages] = useState<PickedImage[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const handleUrlChange = (text: string) => {
    setSourceUrl(text);
    if (text.startsWith('http')) {
      setUrlHint('Will fetch article automatically');
    } else {
      setUrlHint('');
    }
  };

  const pickImages = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Permission required',
        'Please allow access to your photo library to add screenshots.',
        [{ text: 'OK' }],
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.7,
      exif: false,
    });

    if (!result.canceled && result.assets) {
      const picked: PickedImage[] = result.assets.map((a, i) => ({
        uri: a.uri,
        mimeType: a.mimeType ?? 'image/jpeg',
        fileName: a.fileName ?? `screenshot-${Date.now()}-${i}.jpg`,
      }));
      setImages(prev => [...prev, ...picked]);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const removeImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
  };

  const validate = (): string | null => {
    if (!sourceType) return 'Select a source type.';
    if (!sourceUrl.trim() && images.length === 0 && !rawNote.trim()) {
      return 'Add a URL, screenshot, or note — at least one is required.';
    }
    return null;
  };

  const submit = async () => {
    const err = validate();
    if (err) {
      Alert.alert('Missing info', err);
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('source_type', sourceType);
      if (sourceName.trim()) formData.append('source_name', sourceName.trim());
      if (sourceUrl.trim()) formData.append('source_url', sourceUrl.trim());
      if (rawNote.trim()) formData.append('raw_note', rawNote.trim());
      if (tickers.length > 0) formData.append('tickers', JSON.stringify(tickers));
      if (themes.length > 0) formData.append('themes', JSON.stringify(themes));

      for (const img of images) {
        formData.append('screenshots', {
          uri: img.uri,
          type: img.mimeType,
          name: img.fileName,
        } as unknown as Blob);
      }

      const res = await fetch(`${BASE}/api/convictions`, {
        method: 'POST',
        body: formData,
        // Let fetch set Content-Type with boundary automatically
      });

      if (!res.ok) {
        let msg = `Server error ${res.status}`;
        try { const j = await res.json() as { error?: string }; if (j?.error) msg = j.error; } catch { /* ignore */ }
        throw new Error(msg);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
      // Toast is shown via Alert since expo-toast isn't installed
      Alert.alert('Saved', 'Signal saved. Claude is analyzing it now.', [{ text: 'OK' }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      Alert.alert('Error', `Failed to save signal: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === 'web' ? 20 : insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="x" size={20} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>New Signal</Text>
        <Pressable
          onPress={submit}
          disabled={submitting}
          style={[styles.saveBtn, submitting && styles.saveBtnDisabled]}
        >
          {submitting
            ? <ActivityIndicator size="small" color={colors.background} />
            : <Text style={styles.saveBtnText}>Save &amp; Analyze</Text>
          }
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Source type */}
        <View style={styles.section}>
          <Text style={styles.label}>Source Type</Text>
          <View style={styles.segmentRow}>
            {SOURCE_OPTIONS.map(opt => (
              <Pressable
                key={opt.value}
                onPress={() => setSourceType(opt.value)}
                style={[
                  styles.segmentBtn,
                  sourceType === opt.value && styles.segmentBtnActive,
                ]}
              >
                <Feather
                  name={opt.icon as any}
                  size={14}
                  color={sourceType === opt.value ? colors.background : colors.textSecondary}
                />
                <Text style={[
                  styles.segmentText,
                  sourceType === opt.value && styles.segmentTextActive,
                ]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Source name */}
        <View style={styles.section}>
          <Text style={styles.label}>Source Name <Text style={styles.optional}>(optional)</Text></Text>
          <TextInput
            value={sourceName}
            onChangeText={setSourceName}
            placeholder="e.g. Bloomberg, Kobeissi, Ahmed"
            placeholderTextColor={colors.textMuted}
            style={styles.textInput}
          />
        </View>

        {/* URL */}
        <View style={styles.section}>
          <Text style={styles.label}>URL <Text style={styles.optional}>(optional)</Text></Text>
          <TextInput
            value={sourceUrl}
            onChangeText={handleUrlChange}
            placeholder="Paste article or video link"
            placeholderTextColor={colors.textMuted}
            style={styles.textInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {urlHint ? (
            <View style={styles.urlHint}>
              <Feather name="download" size={11} color={colors.primary} />
              <Text style={styles.urlHintText}>{urlHint}</Text>
            </View>
          ) : null}
        </View>

        {/* Screenshots */}
        <View style={styles.section}>
          <Text style={styles.label}>Screenshots <Text style={styles.optional}>(optional)</Text></Text>

          {images.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.imageStrip}
              contentContainerStyle={styles.imageStripContent}
            >
              {images.map((img, idx) => (
                <View key={idx} style={styles.imageWrapper}>
                  <Image
                    source={{ uri: img.uri }}
                    style={styles.imageThumb}
                    resizeMode="cover"
                  />
                  <Pressable
                    onPress={() => removeImage(idx)}
                    style={styles.removeBtn}
                  >
                    <Feather name="x" size={12} color={colors.white} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}

          <Pressable onPress={pickImages} style={styles.addImageBtn}>
            <Feather name="image" size={16} color={colors.primary} />
            <Text style={styles.addImageText}>
              {images.length === 0 ? 'Add Screenshots' : 'Add More'}
            </Text>
          </Pressable>
        </View>

        {/* Note */}
        <View style={styles.section}>
          <Text style={styles.label}>Your Note <Text style={styles.optional}>(optional)</Text></Text>
          <TextInput
            value={rawNote}
            onChangeText={setRawNote}
            placeholder="What does this mean for your portfolio?"
            placeholderTextColor={colors.textMuted}
            style={[styles.textInput, styles.textArea]}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* Tickers */}
        <View style={styles.section}>
          <TagInput
            label="Tickers (optional)"
            placeholder="e.g. AAPL"
            tags={tickers}
            onAdd={t => setTickers(prev => [...prev, t])}
            onRemove={t => setTickers(prev => prev.filter(x => x !== t))}
          />
        </View>

        {/* Themes */}
        <View style={styles.section}>
          <TagInput
            label="Themes (optional)"
            placeholder="e.g. RATES"
            tags={themes}
            onAdd={t => setThemes(prev => [...prev, t])}
            onRemove={t => setThemes(prev => prev.filter(x => x !== t))}
          />
        </View>

        {/* Bottom save button (alternative to header) */}
        <Pressable
          onPress={submit}
          disabled={submitting}
          style={[styles.submitBtn, submitting && styles.saveBtnDisabled]}
        >
          {submitting
            ? <ActivityIndicator color={colors.background} />
            : <Text style={styles.submitBtnText}>Save &amp; Analyze</Text>
          }
        </Pressable>
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
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.separator,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: colors.textPrimary,
  },
  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: colors.primary,
    minWidth: 110,
    alignItems: 'center',
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: colors.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 20,
  },
  section: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: colors.textPrimary,
  },
  optional: {
    fontFamily: 'Inter_400Regular',
    color: colors.textMuted,
    fontSize: 12,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  segmentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.surfaceElevated,
  },
  segmentBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  segmentText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: colors.textSecondary,
  },
  segmentTextActive: {
    color: colors.background,
  },
  textInput: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: colors.textPrimary,
  },
  textArea: {
    minHeight: 100,
    paddingTop: 12,
  },
  urlHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  urlHintText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: colors.primary,
  },
  imageStrip: {
    maxHeight: 110,
  },
  imageStripContent: {
    gap: 10,
    paddingVertical: 4,
  },
  imageWrapper: {
    position: 'relative',
  },
  imageThumb: {
    width: 90,
    height: 90,
    borderRadius: 10,
    backgroundColor: colors.surfaceElevated,
  },
  removeBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addImageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderStyle: 'dashed',
    backgroundColor: colors.surfaceElevated,
    alignSelf: 'flex-start',
  },
  addImageText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: colors.primary,
  },
  submitBtn: {
    marginTop: 8,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  submitBtnText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: colors.background,
  },
});
