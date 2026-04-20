import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  TextInput, Platform, ActivityIndicator, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { colors } from '@/constants/colors';

function resolveBaseUrl(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) {
    return domain.includes('localhost') ? `http://${domain}` : `https://${domain}`;
  }
  if (typeof window !== 'undefined') {
    return `http://${window.location.hostname}:3001`;
  }
  return '';
}
const BASE_URL = resolveBaseUrl();

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

const SUGGESTED_PROMPTS = [
  "Build my IPS",
  "What's violating my IPS right now?",
  "Which position has the worst risk/reward?",
  "Am I on track with my cut list?",
  "What should I do before market open tomorrow?",
  "Summarize my portfolio in one paragraph",
];

export default function AIScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [ipsProgress, setIpsProgress] = useState<{
    goalsComplete: boolean;
    ipsComplete: boolean;
    covered: number;
    total: number;
  } | null>(null);
  const [isIpsMode, setIsIpsMode] = useState(false);
  const [pendingProposalCount, setPendingProposalCount] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const msgIdCounter = useRef(10000);

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
      setIpsProgress({
        goalsComplete: data.goalsComplete,
        ipsComplete: data.ipsComplete,
        covered: data.covered,
        total: data.total,
      });
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
      setMessages([{
        id: msgIdCounter.current++,
        role: 'assistant',
        content: data.message,
        createdAt: new Date().toISOString(),
      }]);
      await fetchIpsProgress();
    } catch (err: any) {
      setMessages([{
        id: msgIdCounter.current++,
        role: 'assistant',
        content: `Error: ${err?.message || 'Failed to start IPS builder'}`,
        createdAt: new Date().toISOString(),
      }]);
    } finally {
      setStreaming(false);
    }
  };

  const sendIpsBuilderMessage = useCallback(async (text?: string) => {
    const content = (text || input).trim();
    if (!content || streaming) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInput('');
    const userMsg: Message = {
      id: msgIdCounter.current++,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setStreaming(true);
    try {
      const res = await fetch(`${BASE_URL}/api/ips/builder/next`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessage: content }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, {
        id: msgIdCounter.current++,
        role: 'assistant',
        content: data.message,
        createdAt: new Date().toISOString(),
      }]);
      await fetchIpsProgress();
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: msgIdCounter.current++,
        role: 'assistant',
        content: `Error: ${err?.message || 'Unknown error'}`,
        createdAt: new Date().toISOString(),
      }]);
    } finally {
      setStreaming(false);
    }
  }, [input, streaming]);

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text || input).trim();
    if (!content || streaming) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Show user message and loading state immediately
    setInput('');
    const userMsg: Message = {
      id: msgIdCounter.current++,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setStreaming(true);
    setStreamingContent('');

    let conv = activeConv;
    try {
      if (!conv) {
        conv = await createConversation(content.slice(0, 40));
      }

      const response = await fetch(`${BASE_URL}/api/anthropic/conversations/${conv.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (!response.body) throw new Error('No stream');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let serverError: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.error) {
                serverError = data.error;
              } else if (data.content) {
                fullContent += data.content;
                setStreamingContent(fullContent);
              } else if (data.done) {
                const aiMsg: Message = {
                  id: msgIdCounter.current++,
                  role: 'assistant',
                  content: fullContent,
                  createdAt: new Date().toISOString(),
                };
                setMessages(prev => [...prev, aiMsg]);
                setStreamingContent('');
              }
            } catch {}
          }
        }
      }

      if (serverError) {
        throw new Error(serverError);
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Unknown error';
      setMessages(prev => [...prev, {
        id: msgIdCounter.current++,
        role: 'assistant',
        content: `Error: ${errMsg}`,
        createdAt: new Date().toISOString(),
      }]);
    } finally {
      setStreaming(false);
      setStreamingContent('');
      await fetchConversations();
    }
  }, [input, streaming, activeConv]);

  const renderMessage = ({ item }: { item: Message | { id: number; streaming: boolean; content: string } }) => {
    const isUser = 'role' in item && item.role === 'user';
    const isStreaming = 'streaming' in item;
    return (
      <View style={[styles.msgRow, isUser && styles.msgRowUser]}>
        {!isUser && (
          <View style={styles.aiAvatar}>
            <Feather name="cpu" size={14} color={colors.primary} />
          </View>
        )}
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
          <Text style={[styles.bubbleText, isUser && styles.userBubbleText]}>
            {item.content}
            {isStreaming && <Text style={{ color: colors.primary }}>|</Text>}
          </Text>
        </View>
      </View>
    );
  };

  const allMessages: any[] = [...messages];
  if (streamingContent) {
    allMessages.push({ id: -1, streaming: true, role: 'assistant', content: streamingContent });
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Text style={styles.title}>AI Advisor</Text>
        {activeConv && (
          <Pressable onPress={() => { setActiveConv(null); setMessages([]); setIsIpsMode(false); }}>
            <Feather name="plus-square" size={22} color={colors.textSecondary} />
          </Pressable>
        )}
      </View>

      {ipsProgress && !ipsProgress.ipsComplete && !activeConv && (
        <Pressable style={styles.ipsProgressBar} onPress={startIpsBuilder}>
          <Text style={styles.ipsProgressText}>
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

      {!activeConv && conversations.length > 0 && (
        <View style={styles.historySection}>
          <Text style={styles.historyTitle}>Recent Conversations</Text>
          {conversations.slice(0, 4).map(conv => (
            <Pressable key={conv.id} style={styles.historyItem} onPress={() => loadConversation(conv)}>
              <Feather name="message-circle" size={16} color={colors.textSecondary} />
              <Text style={styles.historyText} numberOfLines={1}>{conv.title}</Text>
              <Feather name="chevron-right" size={14} color={colors.textMuted} />
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
            <View style={styles.aiIcon}>
              <Feather name="cpu" size={32} color={colors.primary} />
            </View>
            <Text style={styles.welcomeTitle}>Portfolio AI Advisor</Text>
            <Text style={styles.welcomeText}>Ask me anything about your portfolio, market analysis, or trading strategies</Text>
            <View style={styles.suggestionsGrid}>
              {SUGGESTED_PROMPTS.map((p, i) => (
                <Pressable key={i} style={styles.suggestion} onPress={() => p === 'Build my IPS' ? startIpsBuilder() : sendMessage(p)}>
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
            renderItem={renderMessage}
            contentContainerStyle={styles.messageList}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            showsVerticalScrollIndicator={false}
          />
        )}

        <View style={[styles.inputArea, { paddingBottom: bottomPad + 8 }]}>
          {streaming && (
            <View style={styles.thinkingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.thinkingText}>Thinking...</Text>
            </View>
          )}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Ask your AI advisor..."
              placeholderTextColor={colors.textMuted}
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
              <Feather name="send" size={18} color={colors.background} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 8, paddingTop: 4 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, color: colors.textPrimary },
  historySection: { paddingHorizontal: 16, marginBottom: 8 },
  historyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.textSecondary, marginBottom: 8 },
  historyItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.separator },
  historyText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textPrimary },
  chatArea: { flex: 1 },
  welcomeArea: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, paddingTop: 20 },
  aiIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,212,255,0.1)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,212,255,0.3)', marginBottom: 16 },
  welcomeTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, color: colors.textPrimary, marginBottom: 8, textAlign: 'center' },
  welcomeText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textSecondary, textAlign: 'center', marginBottom: 24, lineHeight: 20 },
  suggestionsGrid: { width: '100%', gap: 8 },
  suggestion: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.separator },
  suggestionText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textSecondary },
  messageList: { padding: 16, gap: 12 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 4 },
  msgRowUser: { justifyContent: 'flex-end' },
  aiAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,212,255,0.1)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,212,255,0.2)' },
  bubble: { maxWidth: '80%', padding: 12, borderRadius: 16 },
  aiBubble: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.separator, borderBottomLeftRadius: 4 },
  userBubble: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  userBubbleText: { color: colors.background },
  inputArea: { paddingHorizontal: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.separator },
  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  thinkingText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.textSecondary },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: colors.textPrimary, fontFamily: 'Inter_400Regular', fontSize: 14, maxHeight: 100, borderWidth: 1, borderColor: colors.separator },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
  ipsProgressBar: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    backgroundColor: '#F5A623',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  ipsProgressText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#1a1a1a',
    textAlign: 'center',
  },
  reviewBar: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    backgroundColor: colors.surface,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  reviewBarText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: colors.primary,
    textAlign: 'center',
  },
});
