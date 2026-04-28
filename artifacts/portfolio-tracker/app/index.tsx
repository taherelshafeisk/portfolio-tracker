import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';

export default function LandingScreen() {
  const { token, isLoading, tryDemo } = useAuth();
  const insets = useSafeAreaInsets();

  // If already authenticated, go straight to the app
  useEffect(() => {
    if (!isLoading && token) {
      router.replace('/(tabs)');
    }
  }, [token, isLoading]);

  if (isLoading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  // Don't flash the landing screen if already authed
  if (token) return null;

  async function handleDemo() {
    await tryDemo();
    router.replace('/(tabs)');
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 60, paddingBottom: insets.bottom + 32 }]}>
      {/* Logo / headline */}
      <View style={styles.hero}>
        <Text style={styles.logo}>Trade Navigator</Text>
        <Text style={styles.tagline}>Your portfolio, clearly.</Text>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <Pressable
          style={styles.primaryButton}
          onPress={() => router.push('/auth/signin')}
        >
          <Text style={styles.primaryButtonText}>Sign In</Text>
        </Pressable>

        <Pressable
          style={styles.secondaryButton}
          onPress={() => router.push('/auth/signup')}
        >
          <Text style={styles.secondaryButtonText}>Create Account</Text>
        </Pressable>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        <Pressable style={styles.demoButton} onPress={handleDemo}>
          <Text style={styles.demoButtonText}>Try Demo</Text>
        </Pressable>

        <Text style={styles.demoNote}>
          Explore with a sample portfolio. No sign-up required.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 28,
    justifyContent: 'space-between',
  },
  hero: {
    gap: 8,
  },
  logo: {
    fontFamily: fonts.serifMedium,
    fontSize: 36,
    color: colors.ink,
    letterSpacing: -0.5,
  },
  tagline: {
    fontFamily: fonts.sans,
    fontSize: 17,
    color: colors.ink2,
  },
  actions: {
    gap: 12,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryButtonText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 16,
    color: '#FBF8F2',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.hair2,
  },
  secondaryButtonText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 16,
    color: colors.ink,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.hair,
  },
  dividerText: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.ink3,
  },
  demoButton: {
    backgroundColor: colors.bgInset,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  demoButtonText: {
    fontFamily: fonts.sansMedium,
    fontSize: 16,
    color: colors.ink2,
  },
  demoNote: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.ink3,
    textAlign: 'center',
  },
});
