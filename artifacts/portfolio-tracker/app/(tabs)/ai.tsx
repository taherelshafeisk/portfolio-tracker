import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  TextInput, Platform, ActivityIndicator, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { type AIContextPayload } from '@/hooks/useAIContext';

import { resolveApiBaseUrl } from '@/utils/apiUrl';
const BASE_URL = resolveApiBaseUrl();

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

interface Conversation {
  id: number;
  title: string;
  createdAt: string;
}

function buildContextPrefix(ctx: AIContextPayload): string | null {
  if (!ctx) return null;
  switch (ctx.screen) {
    case 'home': {
      const lines = ['[Context]', 'Screen: Home / Portfolio'];
      if (ctx.macro_posture) lines.push(`Macro posture: ${ctx.macro_posture}`);
      if (ctx.violations.length > 0) {
        lines.push(`IPS violations (${ctx.violations.length}):`);
        ctx.violations.forEach(v => lines.push(`  • ${v.type} (${v.severity}): ${v.detail}`));
      }
      if (ctx.sleeves_summary.length > 0) {
        lines.push('Sleeves:');
        ctx.sleeves_summary.forEach(s =>
          lines.push(`  • ${s.name}: $${s.value.toFixed(0)} (${s.change_pct >= 0 ? '+' : ''}${s.change_pct.toFixed(2)}%)`),
        );
      }
      return lines.join('\n');
    }
    case 'position_detail': {
      const lines = [
        '[Context]', `Screen: Position — ${ctx.ticker}`, `Name: ${ctx.name}`,
        `Sleeve: ${ctx.sleeve}`, `Qty: ${ctx.qty} shares @ avg cost $${ctx.avg_cost.toFixed(2)}`,
        `Current price: $${ctx.current_price.toFixed(2)}`,
        `P&L: ${ctx.pnl_pct >= 0 ? '+' : ''}${ctx.pnl_pct.toFixed(2)}%`,
      ];
      if (ctx.stop != null) lines.push(`Stop: $${ctx.stop.toFixed(2)}`);
      if (ctx.target != null) lines.push(`Target: $${ctx.target.toFixed(2)}`);
      if (ctx.ips_flags.length > 0) {
        lines.push('IPS flags:');
        ctx.ips_flags.forEach(f => lines.push(`  • ${f.rule}: ${f.detail}`));
      }
      if (ctx.thesis) lines.push(`Thesis: ${ctx.thesis}`);
      return lines.join('\n');
    }
    case 'trade_swings': {
      const lines = [
        '[Context]', 'Screen: Trade → Open Swings',
        `${ctx.positions.length} positions open, $${ctx.total_allocated.toFixed(0)} of $${ctx.target.toFixed(0)} deployed`,
      ];
      return lines.join('\n');
    }
    case 'sleeve_detail': {
      return `[Context]\nScreen: Sleeve — ${ctx.sleeve_name}\nTotal value: $${ctx.total_value.toFixed(0)}`;
    }
    default:
      return null;
  }
}

const SUGGESTED_PROMPTS = [
  "What's violating my IPS right now?",
  "Which position has the worst risk/reward?",
  "Summarize my portfolio in one paragraph",
  "What should I do before market open tomorrow?",
];

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageRow({ msg }: { msg: Message & { streaming?: boolean } }) {
  const isUser = msg.role === 'user';

  if (isUser) {
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{msg.content}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.coachRow}>
      <Text style={styles.coachText}>
        {msg.content}
        {msg.streaming && <Text style={{ color: colors.gold }}>|</Text>}
      </Text>
    </View>
  );
}

// ─── Coach avatar ─────────────────────────────────────────────────────────────

function CoachAvatar() {
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>c</Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function CoachScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ context?: string }>();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 20 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [ipsProgress, setIpsProgress] = useState<{
    goalsComplete: boolean; ipsComplete: boolean; covered: number; total: number;
  } | null>(null);
  const [isIpsMode, setIsIpsMode] = useState(false);
  const [pendingProposalCount, setPendingProposalCount] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const msgIdCounter = useRef(10000);
  const [userHasSent, setUserHasSent] = useState(false);
  const incomingContext = useRef<AIContextPayload>(null);
  const contextPrefix = useRef<string | null>(null);

  useEffect(() => {
    if (params.context) {
      try {
        const parsed = JSON.parse(params.context) as AIContextPayload;
        incomingContext.current = parsed;
        contextPrefix.current = buildContextPrefix(parsed);
      } catch {}
    }
  }, [params.context]);

  useEffect(() => {
    fetchConversations();
    fetchIpsProgress();
  }, []);

  const fetchConversations = async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/anthropic/conversations`);
      const data = await res.json();
      setConversations(data);
    } catch {}
  };

  const createConversation = async (title: string) => {
    const res = await fetch(`${BASE_URL}/api/anthropic/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error(`Failed to create conversation (${res.status})`);
    const conv = await res.json();
    setConversations(prev => [conv, ...prev]);
    setActiveConv(conv);
    setMessages([]);
    return conv;
  };

  const loadConversation = async (conv: Conversation) => {
    setActiveConv(conv);
    try {
      const res = await fetch(`${BASE_URL}/api/anthropic/conversations/${conv.id}`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch {}
  };

  const fetchIpsProgress = async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/ips/builder/session`);
      const data = await res.json();
      setIpsProgress({ goalsComplete: data.goalsComplete, ipsComplete: data.ipsComplete, covered: data.covered, total: data.total });
      if (data.covered > 0 && !data.ipsComplete) {
        try {
          const pr = await fetch(`${BASE_URL}/api/ips/proposals/pending-items`);
          const pitems = await pr.json();
          setPendingProposalCount(Array.isArray(pitems) ? pitems.length : 0);
        } catch {}
      }
    } catch {}
  };

  const startIpsBuilder = async () => {
    setIsIpsMode(true);
    setActiveConv({ id: -1, title: 'IPS Builder', createdAt: new Date().toISOString() });
    setMessages([]);
    setStreaming(true);
    try {
      const res = await fetch(`${BASE_URL}/api/ips/builder/next`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setMessages([{ id: msgIdCounter.current++, role: 'assistant', content: data.message, createdAt: new Date().toISOString() }]);
      await fetchIpsProgress();
    } catch (err: any) {
      setMessages([{ id: msgIdCounter.current++, role: 'assistant', content: `Error: ${err?.message || 'Failed to start IPS builder'}`, createdAt: new Date().toISOString() }]);
    } finally {
      setStreaming(false);
    }
  };

  const sendIpsBuilderMessage = useCallback(async (text?: string) => {
    const content = (text || input).trim();
    if (!content || streaming) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput('');
    const userMsg: Message = { id: msgIdCounter.current++, role: 'user', content, createdAt: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setStreaming(true);
    try {
      const res = await fetch(`${BASE_URL}/api/ips/builder/next`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessage: content }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { id: msgIdCounter.current++, role: 'assistant', content: data.message, createdAt: new Date().toISOString() }]);
      await fetchIpsProgress();
    } catch (err: any) {
      setMessages(prev => [...prev, { id: msgIdCounter.current++, role: 'assistant', content: `Error: ${err?.message || 'Unknown error'}`, createdAt: new Date().toISOString() }]);
    } finally {
      setStreaming(false);
    }
  }, [input, streaming]);

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text || input).trim();
    if (!content || streaming) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput('');
    const userMsg: Message = { id: msgIdCounter.current++, role: 'user', content, createdAt: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setUserHasSent(true);
    setStreaming(true);
    setStreamingContent('');

    const prefix = !userHasSent && contextPrefix.current ? contextPrefix.current + '\n\n' : '';
    const fullContent = prefix + content;
    let conv = activeConv;

    try {
      if (!conv) conv = await createConversation(content.slice(0, 40));
      if (!conv) {
        setMessages(prev => [...prev, { id: msgIdCounter.current++, role: 'assistant' as const, content: 'Error: Failed to create conversation', createdAt: new Date().toISOString() }]);
        return;
      }

      const response = await fetch(`${BASE_URL}/api/anthropic/conversations/${conv.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: fullContent }),
      });

      if (!response.body) throw new Error('No stream');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let streamBuffer = '';
      let serverError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.error) { serverError = data.error; }
              else if (data.content) { streamBuffer += data.content; setStreamingContent(streamBuffer); }
              else if (data.done) {
                setMessages(prev => [...prev, { id: msgIdCounter.current++, role: 'assistant', content: streamBuffer, createdAt: new Date().toISOString() }]);
                setStreamingContent('');
              }
            } catch {}
          }
        }
      }
      if (serverError) throw new Error(serverError);
    } catch (err: any) {
      setMessages(prev => [...prev, { id: msgIdCounter.current++, role: 'assistant', content: `Error: ${err?.message || 'Unknown error'}`, createdAt: new Date().toISOString() }]);
    } finally {
      setStreaming(false);
      setStreamingContent('');
      await fetchConversations();
    }
  }, [input, streaming, activeConv]);

  const allMessages: any[] = [...messages];
  if (streamingContent) {
    allMessages.push({ id: -1, streaming: true, role: 'assistant', content: streamingContent });
  }

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <CoachAvatar />
          <View>
            <Text style={styles.headerTitle}>Coach</Text>
            <Text style={styles.headerSub}>
              {streaming ? '● Thinking…' : '● Ready'}
            </Text>
          </View>
        </View>
        {activeConv && (
          <Pressable
            style={styles.newBtn}
            onPress={() => { setActiveConv(null); setMessages([]); setIsIpsMode(false); setUserHasSent(false); }}
          >
            <Text style={styles.newBtnText}>New</Text>
          </Pressable>
        )}
      </View>

      {/* IPS progress bar */}
      {ipsProgress && !ipsProgress.ipsComplete && !activeConv && (
        <Pressable style={styles.ipsBar} onPress={startIpsBuilder}>
          <Text style={styles.ipsBarText}>
            IPS · {ipsProgress.covered} of {ipsProgress.total} positions defined — tap to continue
          </Text>
        </Pressable>
      )}
      {ipsProgress && ipsProgress.covered > 0 && !ipsProgress.ipsComplete && !activeConv && pendingProposalCount > 0 && (
        <Pressable style={styles.reviewBar} onPress={() => router.push('/ips-review')}>
          <Text style={styles.reviewBarText}>
            Review & approve {pendingProposalCount} proposal{pendingProposalCount === 1 ? '' : 's'} →
          </Text>
        </Pressable>
      )}

      {/* Conversation history */}
      {!activeConv && conversations.length > 0 && (
        <View style={styles.historySection}>
          <Text style={styles.historyEyebrow}>RECENT</Text>
          {conversations.slice(0, 4).map((conv, i) => (
            <Pressable
              key={conv.id}
              style={[styles.historyItem, i > 0 && styles.historyItemBorder]}
              onPress={() => loadConversation(conv)}
            >
              <Text style={styles.historyText} numberOfLines={1}>{conv.title}</Text>
              <Text style={styles.historyChevron}>›</Text>
            </Pressable>
          ))}
        </View>
      )}

      <KeyboardAvoidingView
        style={styles.chatArea}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {messages.length === 0 && !streaming ? (
          <View style={styles.welcomeArea}>
            <Text style={styles.welcomeTitle}>
              Ask me about{'\n'}
              <Text style={styles.welcomeItalic}>your portfolio.</Text>
            </Text>
            <View style={styles.suggestions}>
              {SUGGESTED_PROMPTS.map((p, i) => (
                <Pressable
                  key={i}
                  style={styles.suggestion}
                  onPress={() => p === 'Build my IPS' ? startIpsBuilder() : sendMessage(p)}
                >
                  <Text style={styles.suggestionText}>{p}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={allMessages}
            keyExtractor={item => item.id.toString()}
            renderItem={({ item }) => <MessageRow msg={item} />}
            contentContainerStyle={styles.messageList}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Input */}
        <View style={[styles.inputArea, { paddingBottom: Platform.OS === 'web' ? bottomPad + 8 : insets.bottom + 60 }]}>
          {streaming && (
            <View style={styles.thinkingRow}>
              <ActivityIndicator size="small" color={colors.ink3} />
              <Text style={styles.thinkingText}>Thinking…</Text>
            </View>
          )}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Ask your coach…"
              placeholderTextColor={colors.ink3}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={1000}
              editable={!streaming}
            />
            <Pressable
              style={[styles.sendBtn, (!input.trim() || streaming) && styles.sendBtnDisabled]}
              onPress={() => isIpsMode ? sendIpsBuilderMessage() : sendMessage()}
              disabled={!input.trim() || streaming}
            >
              <Text style={styles.sendBtnText}>↑</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.hair,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.deep,
    borderWidth: 1.2,
    borderColor: colors.deepAccent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: fonts.serifItalic,
    fontSize: 16,
    color: colors.deepAccent,
  },
  headerTitle: {
    fontFamily: fonts.sansMedium,
    fontSize: 15,
    color: colors.ink,
  },
  headerSub: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.ink3,
    letterSpacing: 0.5,
  },
  newBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.hair2,
    borderRadius: 2,
  },
  newBtnText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.ink2,
  },

  // IPS / review bars
  ipsBar: {
    marginHorizontal: 22,
    marginTop: 10,
    borderRadius: 2,
    backgroundColor: colors.amberSoft,
    borderWidth: 1,
    borderColor: colors.gold,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  ipsBarText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.gold, textAlign: 'center' },
  reviewBar: {
    marginHorizontal: 22,
    marginTop: 8,
    borderRadius: 2,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.hair2,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  reviewBarText: { fontFamily: fonts.sansMedium, fontSize: 13, color: colors.accent, textAlign: 'center' },

  // History
  historySection: { paddingHorizontal: 22, marginTop: 16, marginBottom: 8 },
  historyEyebrow: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.ink3,
    marginBottom: 8,
  },
  historyItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  historyItemBorder: { borderTopWidth: 1, borderTopColor: colors.hair },
  historyText: { flex: 1, fontFamily: fonts.sans, fontSize: 14, color: colors.ink },
  historyChevron: { fontSize: 16, color: colors.ink3 },

  // Chat area
  chatArea: { flex: 1 },

  // Welcome
  welcomeArea: { flex: 1, paddingHorizontal: 22, paddingTop: 40 },
  welcomeTitle: {
    fontFamily: fonts.serif,
    fontSize: 26,
    letterSpacing: -0.02 * 26,
    color: colors.ink,
    lineHeight: 32,
    marginBottom: 24,
  },
  welcomeItalic: { fontFamily: fonts.serifItalic },
  suggestions: { gap: 8 },
  suggestion: {
    padding: 14,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: colors.hair2,
    backgroundColor: colors.card,
  },
  suggestionText: { fontFamily: fonts.serif, fontSize: 14, color: colors.ink2, lineHeight: 20 },

  // Messages
  messageList: { padding: 22, gap: 16 },

  coachRow: { marginBottom: 4 },
  coachText: {
    fontFamily: fonts.serifItalic,
    fontSize: 13.5,
    color: colors.ink,
    lineHeight: 22,
  },

  userRow: { alignItems: 'flex-end', marginBottom: 4 },
  userBubble: {
    maxWidth: '80%',
    backgroundColor: colors.bgInset,
    borderRadius: 14,
    borderBottomRightRadius: 2,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userText: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    color: colors.ink,
    lineHeight: 20,
  },

  // Input
  inputArea: {
    paddingHorizontal: 22,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.hair,
  },
  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  thinkingText: { fontFamily: fonts.serifItalic, fontSize: 13, color: colors.ink3 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.hair2,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  input: {
    flex: 1,
    color: colors.ink,
    fontSize: 14,
    maxHeight: 100,
    paddingVertical: 4,
    fontFamily: fonts.serif,
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.3 },
  sendBtnText: { color: colors.card, fontSize: 16, lineHeight: 18 },
});
