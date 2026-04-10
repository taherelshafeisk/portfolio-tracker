import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, RefreshControl,
  Pressable, Platform, ActivityIndicator, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { colors } from '@/constants/colors';
import { Card } from '@/components/ui/Card';

// ─── Types ───────────────────────────────────────────────────────────────────
type ProposalStatus = 'PROCESSING' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
type SourceType = 'NEWS' | 'VIDEO' | 'PERSON' | 'OWN_THESIS';

interface ConvictionAttachment {
  id: string;
  storagePath: string;
  mimeType: string;
  displayOrder: number;
}

interface ClaudeProposal {
  summary?: string;
  relevance?: 'HIGH' | 'MEDIUM' | 'LOW';
  confidence?: 'HIGH' | 'MEDIUM' | 'SPECULATIVE';
  proposed_action_type?: 'TRADE' | 'IPS_UPDATE' | 'WATCH' | 'NO_ACTION';
  affected_tickers?: Array<{ ticker: string; suggested_action: string }>;
  macro_themes?: string[];
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

async function fetchConvictions(status?: string): Promise<Conviction[]> {
  const qs = status ? `?proposal_status=${status}` : '';
  const res = await fetch(`${BASE}/api/convictions${qs}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Conviction[]>;
}

// ─── Filter tabs ─────────────────────────────────────────────────────────────
const FILTERS: Array<{ label: string; value: string | undefined }> = [
  { label: 'All', value: undefined },
  { label: 'Pending', value: 'PENDING_REVIEW' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Rejected', value: 'REJECTED' },
];

// ─── Source type helpers ─────────────────────────────────────────────────────
const SOURCE_ICONS: Record<SourceType, string> = {
  NEWS: 'file-text',
  VIDEO: 'play-circle',
  PERSON: 'user',
  OWN_THESIS: 'edit-3',
};

const SOURCE_LABELS: Record<SourceType, string> = {
  NEWS: 'News',
  VIDEO: 'Video',
  PERSON: 'Person',
  OWN_THESIS: 'Own Thesis',
};

function statusBadgeStyle(status: ProposalStatus): { bg: string; fg: string; label: string } {
  switch (status) {
    case 'PROCESSING':    return { bg: 'rgba(0,212,255,0.12)', fg: colors.primary,   label: 'Analyzing…' };
    case 'PENDING_REVIEW': return { bg: 'rgba(255,165,0,0.15)', fg: '#FF9800',        label: 'Review Needed' };
    case 'APPROVED':       return { bg: 'rgba(0,230,118,0.12)', fg: colors.positive,  label: 'Approved' };
    case 'REJECTED':       return { bg: 'rgba(255,71,87,0.12)',  fg: colors.negative,  label: 'Rejected' };
  }
}

function relevanceBadge(r?: string): { bg: string; fg: string } {
  if (r === 'HIGH')   return { bg: 'rgba(255,71,87,0.15)',  fg: colors.negative };
  if (r === 'MEDIUM') return { bg: 'rgba(255,152,0,0.15)',  fg: '#FF9800' };
  return                      { bg: 'rgba(136,153,170,0.15)', fg: colors.textSecondary };
}

// ─── ConvictionCard ──────────────────────────────────────────────────────────
function ConvictionCard({ item, onPress }: { item: Conviction; onPress: () => void }) {
  const proposal = item.claudeProposal;
  const badge = statusBadgeStyle(item.proposalStatus);
  const isPending = item.proposalStatus === 'PENDING_REVIEW';

  // Build image URLs for first 2 attachments
  const imageAttachments = item.attachments
    .filter(a => a.mimeType.startsWith('image/'))
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .slice(0, 2);

  const relBadge = proposal && !proposal.parse_error ? relevanceBadge(proposal.relevance) : null;
  const tickers = item.tickers.slice(0, 3);
  const themes = item.themes.slice(0, 2);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        isPending && styles.cardPending,
        pressed && styles.cardPressed,
      ]}
    >
      {/* Header row */}
      <View style={styles.cardHeader}>
        <View style={styles.sourceRow}>
          <Feather
            name={SOURCE_ICONS[item.sourceType] as any}
            size={14}
            color={colors.textSecondary}
          />
          <Text style={styles.sourceName}>
            {item.sourceName || SOURCE_LABELS[item.sourceType]}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
          {item.proposalStatus === 'PROCESSING' && (
            <ActivityIndicator size="small" color={badge.fg} style={{ marginRight: 4 }} />
          )}
          <Text style={[styles.statusText, { color: badge.fg }]}>{badge.label}</Text>
        </View>
      </View>

      {/* Thumbnail strip */}
      {imageAttachments.length > 0 && (
        <View style={styles.thumbnailStrip}>
          {imageAttachments.map(att => (
            <Image
              key={att.id}
              source={{ uri: `${BASE}/${att.storagePath}` }}
              style={styles.thumbnail}
              resizeMode="cover"
            />
          ))}
        </View>
      )}

      {/* Summary */}
      {proposal && !proposal.parse_error && proposal.summary ? (
        <Text style={styles.summary} numberOfLines={2}>{proposal.summary}</Text>
      ) : item.rawNote ? (
        <Text style={styles.summary} numberOfLines={2}>{item.rawNote}</Text>
      ) : null}

      {/* Tags row */}
      <View style={styles.tagsRow}>
        {tickers.map(t => (
          <View key={t} style={styles.tickerChip}>
            <Text style={styles.tickerText}>{t}</Text>
          </View>
        ))}
        {themes.slice(0, tickers.length < 2 ? 2 : 1).map(th => (
          <View key={th} style={styles.themeChip}>
            <Text style={styles.themeText} numberOfLines={1}>{th}</Text>
          </View>
        ))}
      </View>

      {/* Bottom row */}
      <View style={styles.cardFooter}>
        {relBadge && proposal?.relevance ? (
          <View style={[styles.relBadge, { backgroundColor: relBadge.bg }]}>
            <Text style={[styles.relText, { color: relBadge.fg }]}>
              {proposal.relevance} relevance
            </Text>
          </View>
        ) : <View />}
        <Text style={styles.timestamp}>
          {new Date(item.createdAt).toLocaleDateString()}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────
export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [activeFilter, setActiveFilter] = useState<string | undefined>(undefined);
  const [convictions, setConvictions] = useState<Conviction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (showRefresh = false) => {
    try {
      if (showRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      const data = await fetchConvictions(activeFilter);
      setConvictions(data);
    } catch (e) {
      setError('Failed to load signals. Pull to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeFilter]);

  // Reload when tab comes into focus
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Reload when filter changes
  useEffect(() => { load(); }, [activeFilter]);

  const onRefresh = () => load(true);

  const renderItem = ({ item }: { item: Conviction }) => (
    <ConvictionCard
      item={item}
      onPress={() => router.push({ pathname: '/conviction/[id]', params: { id: item.id } })}
    />
  );

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      {/* Title bar */}
      <View style={styles.titleBar}>
        <Text style={styles.title}>Signals</Text>
        <Pressable
          onPress={() => router.push('/conviction-capture')}
          style={styles.fab}
        >
          <Feather name="plus" size={20} color={colors.background} />
        </Pressable>
      </View>

      {/* Filter bar */}
      <View style={styles.filterBar}>
        {FILTERS.map(f => (
          <Pressable
            key={f.label}
            onPress={() => setActiveFilter(f.value)}
            style={[
              styles.filterChip,
              activeFilter === f.value && styles.filterChipActive,
            ]}
          >
            <Text style={[
              styles.filterText,
              activeFilter === f.value && styles.filterTextActive,
            ]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading && !refreshing ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Feather name="alert-circle" size={32} color={colors.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => load()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={convictions}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.list,
            convictions.length === 0 && styles.listEmpty,
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather name="rss" size={48} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No signals yet</Text>
              <Text style={styles.emptySubtitle}>
                Tap + to capture a news article, video, or your own thesis.
              </Text>
              <Pressable
                onPress={() => router.push('/conviction-capture')}
                style={styles.emptyBtn}
              >
                <Text style={styles.emptyBtnText}>Add Signal</Text>
              </Pressable>
            </View>
          }
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: colors.textPrimary,
  },
  fab: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.surface,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: colors.textSecondary,
  },
  filterTextActive: {
    color: colors.background,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 100,
    gap: 12,
  },
  listEmpty: {
    flex: 1,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.separator,
    gap: 10,
  },
  cardPending: {
    borderColor: '#FF9800',
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sourceName: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: colors.textSecondary,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  thumbnailStrip: {
    flexDirection: 'row',
    gap: 8,
  },
  thumbnail: {
    width: 80,
    height: 60,
    borderRadius: 8,
    backgroundColor: colors.surfaceElevated,
  },
  summary: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: colors.textPrimary,
    lineHeight: 20,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tickerChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(0,212,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0,212,255,0.25)',
  },
  tickerText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: colors.primary,
  },
  themeChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: colors.surfaceElevated,
    maxWidth: 120,
  },
  themeText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: colors.textSecondary,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  relBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  relText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  timestamp: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: colors.textMuted,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  errorText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surfaceElevated,
  },
  retryText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: colors.primary,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
    paddingTop: 80,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: colors.textPrimary,
    marginTop: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.primary,
  },
  emptyBtnText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: colors.background,
  },
});
