import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable,
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';

export default function SignInScreen() {
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      router.replace('/(tabs)');
    } catch (err: any) {
      setError(err?.message ?? 'Sign in failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Back */}
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>

        <Text style={styles.title}>Sign In</Text>
        <Text style={styles.subtitle}>Welcome back.</Text>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.ink3}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              returnKeyType="next"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor={colors.ink3}
              secureTextEntry
              autoComplete="password"
              returnKeyType="done"
              onSubmitEditing={handleSignIn}
            />
          </View>
        </View>

        <Pressable
          style={[styles.primaryButton, (!email.trim() || !password || loading) && styles.disabled]}
          onPress={handleSignIn}
          disabled={!email.trim() || !password || loading}
        >
          {loading
            ? <ActivityIndicator color="#FBF8F2" />
            : <Text style={styles.primaryButtonText}>Sign In</Text>
          }
        </Pressable>

        <Pressable onPress={() => router.replace('/auth/signup')}>
          <Text style={styles.switchText}>
            Don't have an account? <Text style={styles.switchLink}>Create one</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingHorizontal: 28,
    gap: 20,
  },
  backButton: {
    alignSelf: 'flex-start',
  },
  backText: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.ink2,
  },
  title: {
    fontFamily: fonts.serifMedium,
    fontSize: 32,
    color: colors.ink,
    marginTop: 12,
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.ink2,
    marginTop: -8,
  },
  errorBox: {
    backgroundColor: '#FDE8E4',
    borderRadius: 8,
    padding: 12,
  },
  errorText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: '#8B1A0A',
  },
  form: {
    gap: 16,
    marginTop: 8,
  },
  field: {
    gap: 6,
  },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: colors.ink2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.hair2,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
  },
  disabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 16,
    color: '#FBF8F2',
  },
  switchText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.ink2,
    textAlign: 'center',
  },
  switchLink: {
    color: colors.accent,
    fontFamily: fonts.sansMedium,
  },
});
