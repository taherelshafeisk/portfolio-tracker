import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Image, Modal, ActivityIndicator, TextInput, Alert,
  Platform, Linking, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { colors } from '@/constants/colors';

// ─── Types ───────────────────────────────────────────────────────────────────
type ProposalStatus = 'PROCESSING' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
type SourceType = 'NEWS' | 'VIDEO' | 'PERSON' | 'OWN_THESIS';

interface ConvictionAttachment {
  id: string;
  storagePath: string;
  mimeType: string;
  displayOrder: number;
}

interface ClaudeAffectedTicker {
  ticker: string;
  current_position: string;
  suggested_action: 'ADD' | 'TRIM' | 'HOLD' | 'EXIT' | 'WATCH' | 'NO_POSITION';
  rationale: string;
  ips_compatible: boolean;
  ips_conflict: string | null;
}

interface ClaudeProposal {
  summary?: string;
  relevance?: 'HIGH' | 'MEDIUM' | 'LOW';
  affected_tickers?: ClaudeAffectedTicker[];
  macro_themes?: string[];
  ips_change_suggested?: boolean;
  ips_change_rationale?: string | null;
  confidence?: 'HIGH' | 'MEDIUM' | 'SPECULATIVE';
  proposed_action_type?: 'TRADE' | 'IPS_UPDATE' | 'WATCH' | 'NO_ACTION';
  raw?: string;
  parse_error?: boolean;
}

interface Conviction {
  id: string;
  sourceType: SourceType;
  sourceName: string | null;
  sourceUrl: string | null;
  rawNote: string | null;
  tickers: string[];
  themes: string[];
  claudeProposal: ClaudeProposal | null;
  proposalStatus: ProposalStatus;
  rejectionReason: string | null;
  actionId: number | null;
  createdAt: string;
  attachments: ConvictionAttachment[];
}

// ─── API ─────────────────────────────────────────────────────────────────────
function resolveBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) return domain.includes('localhost') ? `http://${domain}` : `https://${domain}`;
  if (typeof window !== 'undefined') return `http://${window.location.hostname}:3001`;
  return '';
}
const BASE = resolveBase();

async function getConviction(id: string): Promise<Conviction> {
  const res = await fetch(`${BASE}/api/convictions/${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Conviction>;
}

async function pollStatus(id: string): Promise<{ id: string; proposalStatus: ProposalStatus; claudeProposal: ClaudeProposal | null }> {
  const res = await fetch(`${BASE}/api/convictions/${id}/status`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function approveConviction(id: string): Promise<{ conviction: Conviction; actionId: number | null }> {
  const res = await fetch(`${BASE}/api/convictions/${id}/approve`, { method: 'PATCH' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function rejectConviction(id: string, reason?: string): Promise<Conviction> {
  const res = await fetch(`${BASE}/api/convictions/${id}/reject`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rejection_reason: reason ?? null }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Conviction>;
}

// ─── Push notifications setup ────────────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function schedulePendingReviewNotification(ticker: string | undefined, theme: string | undefined) {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Signal ready for review',
        body: ticker ?? theme ?? 'Your conviction signal has been analyzed',
      },
      trigger: null, // immediate
    });
  } catch { /* non-fatal */ }
}

// ─── Badge helpers ────────────────────────────────────────────────────────────
function actionBadge(action: string): { bg: string; fg: string } {
  switch (action) {
    case 'ADD':  return { bg: 'rgba(0,230,118,0.15)',  fg: colors.positive };
    case 'TRIM': return { bg: 'rgba(255,152,0,0.15)',  fg: '#FF9800' };
    case 'EXIT': return { bg: 'rgba(255,71,87,0.15)',  fg: colors.negative };
    case 'WATCH':return { bg: 'rgba(0,212,255,0.15)',  fg: colors.primary };
    default:     return { bg: 'rgba(136,153,170,0.15)',fg: colors.textSecondary };
  }
}

function confidenceBadge(conf?: string): { bg: string; fg: string } {
  if (conf === 'HIGH')        return { bg: 'rgba(0,230,118,0.12)',  fg: colors.positive };
  if (conf === 'MEDIUM')      return { bg: 'rgba(255,152,0,0.12)',  fg: '#FF9800' };
  return                             { bg: 'rgba(136,153,170,0.12)',fg: colors.textSecondary };
}

function relevanceBadge(rel?: string): { bg: string; fg: string } {
  if (rel === 'HIGH')   return { bg: 'rgba(255,71,87,0.15)',   fg: colors.negative };
  if (rel === 'MEDIUM') return { bg: 'rgba(255,152,0,0.15)',   fg: '#FF9800' };
  return                       { bg: 'rgba(136,153,170,0.15)', fg: colors.textSecondary };
}

const SOURCE_ICONS: Record<SourceType, string> = {
  NEWS: 'file-text', VIDEO: 'play-circle', PERSON: 'user', OWN_THESIS: 'edit-3',
};

const { width: SCREEN_W } = Dimensions.get('window');

// ─── Main screen ─────────────────────────────────────────────────────────────
export default function ConvictionDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [conviction, setConviction] = useState<Conviction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Gallery modal
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);

  // Rejection flow
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [approving, setApproving] = useState(false);

  // Raw proposal expansion
  const [rawExpanded, setRawExpanded] = useState(false);

  // Polling ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevStatus = useRef<ProposalStatus | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const data = await getConviction(id);
      setConviction(data);
      prevStatus.current = data.proposalStatus;
    } catch {
      setError('Failed to load signal. Pull to retry.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Poll every 3 seconds while PROCESSING
  useEffect(() => {
    if (!conviction || conviction.proposalStatus !== 'PROCESSING') {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }

    pollRef.current = setInterval(async () => {
      if (!id) return;
      try {
        const status = await pollStatus(id);
        if (status.proposalStatus !== 'PROCESSING') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          // Refresh full conviction
          const updated = await getConviction(id);
          setConviction(updated);
          // Fire local notification
          const proposal = updated.claudeProposal;
          const firstTicker = proposal?.affected_tickers?.[0]?.ticker;
          const firstTheme = proposal?.macro_themes?.[0];
          schedulePendingReviewNotification(firstTicker, firstTheme);
        }
      } catch { /* non-fatal polling error */ }
    }, 3000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [conviction?.proposalStatus, id]);

  const handleApprove = async () => {
    if (!conviction) return;
    setApproving(true);
    try {
      const result = await approveConviction(conviction.id);
      setConviction(result.conviction);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      Alert.alert('Error', `Failed to approve: ${e instanceof Error ? e.message : 'Unknown'}`);
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    if (!conviction) return;
    setRejecting(true);
    try {
      const updated = await rejectConviction(conviction.id, rejectReason.trim() || undefined);
      setConviction(updated);
      setRejectOpen(false);
      setRejectReason('');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) {
      Alert.alert('Error', `Failed to reject: ${e instanceof Error ? e.message : 'Unknown'}`);
    } finally {
      setRejecting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error || !conviction) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Feather name="alert-circle" size={32} color={colors.textMuted} />
        <Text style={styles.errorText}>{error ?? 'Signal not found'}</Text>
        <Pressable onPress={load} style={styles.retryBtn}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const proposal = conviction.claudeProposal;
  const hasProposal = proposal && !proposal.parse_error;
  const hasParseError = proposal?.parse_error === true;
  const isProcessing = conviction.proposalStatus === 'PROCESSING';
  const isPendingReview = conviction.proposalStatus === 'PENDING_REVIEW';
  const isApproved = conviction.proposalStatus === 'APPROVED';
  const isRejected = conviction.proposalStatus === 'REJECTED';

  const imageAttachments = conviction.attachments
    .filter(a => a.mimeType.startsWith('image/'))
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const imageUrls = imageAttachments.map(a => `${BASE}/${a.storagePath}`);

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === 'web' ? 20 : insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Signal Detail</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Source header */}
        <View style={styles.sourceHeader}>
          <Feather name={SOURCE_ICONS[conviction.sourceType] as any} size={18} color={colors.primary} />
          <View style={styles.sourceInfo}>
            <Text style={styles.sourceName}>
              {conviction.sourceName || conviction.sourceType}
            </Text>
            {conviction.sourceUrl ? (
              <Pressable onPress={() => Linking.openURL(conviction.sourceUrl!)}>
                <Text style={styles.sourceUrl} numberOfLines={1}>{conviction.sourceUrl}</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.timestamp}>{new Date(conviction.createdAt).toLocaleDateString()}</Text>
        </View>

        {/* Screenshot gallery */}
        {imageAttachments.length > 0 && (
          <View style={styles.section}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.galleryStrip}
            >
              {imageAttachments.map((att, idx) => (
                <Pressable
                  key={att.id}
                  onPress={() => { setGalleryIndex(idx); setGalleryOpen(true); }}
                >
                  <Image
                    source={{ uri: imageUrls[idx] }}
                    style={styles.galleryThumb}
                    resizeMode="cover"
                  />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* User's note */}
        {conviction.rawNote ? (
          <View style={styles.noteCard}>
            <Text style={styles.noteLabel}>Your Note</Text>
            <Text style={styles.noteText}>{conviction.rawNote}</Text>
          </View>
        ) : null}

        {/* PROCESSING state */}
        {isProcessing && (
          <View style={styles.processingCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.processingText}>Claude is analyzing your signal…</Text>
          </View>
        )}

        {/* APPROVED banner */}
        {isApproved && (
          <View style={styles.approvedBanner}>
            <Feather name="check-circle" size={16} color={colors.positive} />
            <Text style={styles.approvedText}>Approved</Text>
            {conviction.actionId != null && (
              <Pressable
                onPress={() => router.push({ pathname: '/action-detail', params: { actionId: String(conviction.actionId) } })}
                style={styles.viewActionBtn}
              >
                <Text style={styles.viewActionText}>View Action →</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* REJECTED banner */}
        {isRejected && (
          <View style={styles.rejectedBanner}>
            <Feather name="x-circle" size={16} color={colors.negative} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rejectedText}>Rejected</Text>
              {conviction.rejectionReason ? (
                <Text style={styles.rejectionReason}>{conviction.rejectionReason}</Text>
              ) : null}
            </View>
          </View>
        )}

        {/* Parse error banner */}
        {hasParseError && (
          <View style={styles.parseErrorBanner}>
            <Feather name="alert-triangle" size={16} color="#FF9800" />
            <Text style={styles.parseErrorText}>Analysis returned an unexpected format</Text>
          </View>
        )}

        {/* Raw text collapse */}
        {hasParseError && proposal?.raw ? (
          <View style={styles.rawCard}>
            <Pressable
              onPress={() => setRawExpanded(v => !v)}
              style={styles.rawHeader}
            >
              <Text style={styles.rawHeaderText}>Raw Claude Response</Text>
              <Feather name={rawExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
            </Pressable>
            {rawExpanded && (
              <Text style={styles.rawText}>{proposal.raw}</Text>
            )}
          </View>
        ) : null}

        {/* Claude analysis card */}
        {hasProposal && proposal && (
          <View style={styles.analysisCard}>
            <Text style={styles.analysisTitle}>Claude's Analysis</Text>

            {/* Summary */}
            {proposal.summary ? (
              <Text style={styles.analysisSummary}>{proposal.summary}</Text>
            ) : null}

            {/* Badges row */}
            <View style={styles.badgesRow}>
              {proposal.relevance ? (
                <View style={[styles.badge, { backgroundColor: relevanceBadge(proposal.relevance).bg }]}>
                  <Text style={[styles.badgeText, { color: relevanceBadge(proposal.relevance).fg }]}>
                    {proposal.relevance} relevance
                  </Text>
                </View>
              ) : null}
              {proposal.confidence ? (
                <View style={[styles.badge, { backgroundColor: confidenceBadge(proposal.confidence).bg }]}>
                  <Text style={[styles.badgeText, { color: confidenceBadge(proposal.confidence).fg }]}>
                    {proposal.confidence} confidence
                  </Text>
                </View>
              ) : null}
              {proposal.proposed_action_type ? (
                <View style={styles.actionTypeBadge}>
                  <Text style={styles.actionTypeText}>{proposal.proposed_action_type}</Text>
                </View>
              ) : null}
            </View>

            {/* Affected tickers */}
            {proposal.affected_tickers && proposal.affected_tickers.length > 0 && (
              <View style={styles.tickersSection}>
                <Text style={styles.sectionLabel}>Affected Tickers</Text>
                {proposal.affected_tickers.map((t, i) => {
                  const ab = actionBadge(t.suggested_action);
                  return (
                    <View key={`${t.ticker}-${i}`} style={styles.tickerRow}>
                      <View style={styles.tickerHeader}>
                        <View style={styles.tickerChip}>
                          <Text style={styles.tickerSymbol}>{t.ticker}</Text>
                        </View>
                        <Text style={styles.tickerPosition} numberOfLines={1}>{t.current_position}</Text>
                        <View style={[styles.badge, { backgroundColor: ab.bg }]}>
                          <Text style={[styles.badgeText, { color: ab.fg }]}>{t.suggested_action}</Text>
                        </View>
                      </View>
                      <Text style={styles.tickerRationale}>{t.rationale}</Text>
                      <View style={styles.ipsRow}>
                        {t.ips_compatible
                          ? <Text style={styles.ipsOk}>✅ IPS compatible</Text>
                          : <Text style={styles.ipsConflict}>⚠️ {t.ips_conflict ?? 'IPS conflict'}</Text>
                        }
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {/* Macro themes */}
            {proposal.macro_themes && proposal.macro_themes.length > 0 && (
              <View style={styles.themesSection}>
                <Text style={styles.sectionLabel}>Macro Themes</Text>
                <View style={styles.themesRow}>
                  {proposal.macro_themes.map(th => (
                    <View key={th} style={styles.themeChip}>
                      <Text style={styles.themeText}>{th}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* IPS change */}
            {proposal.ips_change_suggested && (
              <View style={styles.ipsChangeCard}>
                <Text style={styles.ipsChangeTitle}>IPS Change Suggested (review only)</Text>
                {proposal.ips_change_rationale ? (
                  <Text style={styles.ipsChangeRationale}>{proposal.ips_change_rationale}</Text>
                ) : null}
              </View>
            )}
          </View>
        )}

        {/* Action bar — PENDING_REVIEW only */}
        {isPendingReview && !rejectOpen && (
          <View style={styles.actionBar}>
            <Pressable
              onPress={handleApprove}
              disabled={approving}
              style={[styles.approveBtn, approving && styles.btnDisabled]}
            >
              {approving
                ? <ActivityIndicator color={colors.background} />
                : <>
                    <Feather name="check" size={18} color={colors.background} />
                    <Text style={styles.approveBtnText}>Approve</Text>
                  </>
              }
            </Pressable>
            <Pressable
              onPress={() => setRejectOpen(true)}
              style={styles.rejectBtn}
            >
              <Text style={styles.rejectBtnText}>Reject</Text>
            </Pressable>
          </View>
        )}

        {/* Rejection inline input */}
        {isPendingReview && rejectOpen && (
          <View style={styles.rejectPanel}>
            <Text style={styles.rejectPanelLabel}>Reason (optional)</Text>
            <TextInput
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="Why are you rejecting this signal?"
              placeholderTextColor={colors.textMuted}
              style={styles.rejectInput}
              multiline
            />
            <View style={styles.rejectPanelBtns}>
              <Pressable onPress={() => { setRejectOpen(false); setRejectReason(''); }} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleReject}
                disabled={rejecting}
                style={[styles.confirmRejectBtn, rejecting && styles.btnDisabled]}
              >
                {rejecting
                  ? <ActivityIndicator color={colors.white} size="small" />
                  : <Text style={styles.confirmRejectText}>Confirm Reject</Text>
                }
              </Pressable>
            </View>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Gallery modal */}
      <Modal
        visible={galleryOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setGalleryOpen(false)}
      >
        <View style={styles.galleryModal}>
          <Pressable style={styles.galleryClose} onPress={() => setGalleryOpen(false)}>
            <Feather name="x" size={24} color={colors.white} />
          </Pressable>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            contentOffset={{ x: galleryIndex * SCREEN_W, y: 0 }}
            style={{ flex: 1 }}
          >
            {imageUrls.map((uri, idx) => (
              <View key={idx} style={{ width: SCREEN_W, alignItems: 'center', justifyContent: 'center' }}>
                <Image
                  source={{ uri }}
                  style={{ width: SCREEN_W, height: SCREEN_W * 1.3 }}
                  resizeMode="contain"
                />
              </View>
            ))}
          </ScrollView>
          <Text style={styles.galleryCounter}>
            {galleryIndex + 1} / {imageUrls.length}
          </Text>
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: 32, fontFamily: 'Inter_400Regular' },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.surfaceElevated },
  retryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.primary },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.separator,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: colors.textPrimary, flex: 1, textAlign: 'center' },

  scrollContent: { padding: 16, gap: 16 },

  sourceHeader: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 14, borderRadius: 14,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.separator,
  },
  sourceInfo: { flex: 1, gap: 3 },
  sourceName: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  sourceUrl: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.primary, textDecorationLine: 'underline' },
  timestamp: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textMuted },

  section: {},
  galleryStrip: { gap: 10, paddingVertical: 2 },
  galleryThumb: { width: 160, height: 110, borderRadius: 12, backgroundColor: colors.surfaceElevated },

  noteCard: {
    padding: 14, borderRadius: 14,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.separator, gap: 6,
  },
  noteLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary },
  noteText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 20 },

  processingCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16,
    borderRadius: 14, backgroundColor: 'rgba(0,212,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(0,212,255,0.2)',
  },
  processingText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: colors.primary },

  approvedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14,
    borderRadius: 14, backgroundColor: 'rgba(0,230,118,0.1)',
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.25)',
  },
  approvedText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.positive, flex: 1 },
  viewActionBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(0,230,118,0.15)' },
  viewActionText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.positive },

  rejectedBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 14,
    borderRadius: 14, backgroundColor: 'rgba(255,71,87,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,71,87,0.2)',
  },
  rejectedText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.negative },
  rejectionReason: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textSecondary, marginTop: 2 },

  parseErrorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14,
    borderRadius: 14, backgroundColor: 'rgba(255,152,0,0.1)',
    borderWidth: 1, borderColor: 'rgba(255,152,0,0.25)',
  },
  parseErrorText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#FF9800', flex: 1 },

  rawCard: {
    borderRadius: 14, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.surfaceBorder, overflow: 'hidden',
  },
  rawHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 14,
  },
  rawHeaderText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary },
  rawText: {
    fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.textMuted,
    padding: 14, paddingTop: 0, lineHeight: 16,
  },

  analysisCard: {
    borderRadius: 14, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.separator, padding: 16, gap: 14,
  },
  analysisTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.textPrimary },
  analysisSummary: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 20 },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  badgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  actionTypeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: 'rgba(0,212,255,0.12)' },
  actionTypeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.primary },

  tickersSection: { gap: 10 },
  sectionLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary },
  tickerRow: {
    padding: 12, borderRadius: 12,
    backgroundColor: colors.surfaceElevated, gap: 6,
  },
  tickerHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tickerChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
    backgroundColor: 'rgba(0,212,255,0.12)', borderWidth: 1, borderColor: 'rgba(0,212,255,0.25)',
  },
  tickerSymbol: { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary },
  tickerPosition: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },
  tickerRationale: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 18 },
  ipsRow: {},
  ipsOk: { fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.positive },
  ipsConflict: { fontSize: 12, fontFamily: 'Inter_500Medium', color: '#FF9800' },

  themesSection: { gap: 8 },
  themesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  themeChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: colors.surfaceElevated },
  themeText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.textSecondary },

  ipsChangeCard: {
    padding: 12, borderRadius: 12,
    backgroundColor: 'rgba(255,152,0,0.08)', borderWidth: 1, borderColor: 'rgba(255,152,0,0.2)', gap: 4,
  },
  ipsChangeTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#FF9800' },
  ipsChangeRationale: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.textPrimary, lineHeight: 18 },

  actionBar: { gap: 10 },
  approveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, borderRadius: 16, backgroundColor: colors.positive,
  },
  approveBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.background },
  rejectBtn: {
    paddingVertical: 14, borderRadius: 16, alignItems: 'center',
    borderWidth: 1, borderColor: colors.negative,
  },
  rejectBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.negative },
  btnDisabled: { opacity: 0.5 },

  rejectPanel: {
    padding: 16, borderRadius: 14,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.separator, gap: 10,
  },
  rejectPanelLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary },
  rejectInput: {
    backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.surfaceBorder,
    borderRadius: 12, padding: 12, fontSize: 14, fontFamily: 'Inter_400Regular',
    color: colors.textPrimary, minHeight: 80,
  },
  rejectPanelBtns: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  cancelBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.textSecondary },
  confirmRejectBtn: {
    flex: 2, paddingVertical: 12, borderRadius: 12, alignItems: 'center',
    backgroundColor: colors.negative,
  },
  confirmRejectText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: colors.white },

  galleryModal: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.95)',
    alignItems: 'center', justifyContent: 'center',
  },
  galleryClose: {
    position: 'absolute', top: 50, right: 20, zIndex: 10,
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  galleryCounter: {
    position: 'absolute', bottom: 40,
    fontSize: 14, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.7)',
  },
});
