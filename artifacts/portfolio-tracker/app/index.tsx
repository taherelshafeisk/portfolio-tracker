import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as LocalAuthentication from 'expo-local-authentication';
import { useAuth } from '@/context/AuthContext';
import { colors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';

export default function LandingScreen() {
  const { token, isLoading, tryDemo } = useAuth();
  const insets = useSafeAreaInsets();
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricPrompted, setBiometricPrompted] = useState(false);

  // Check if biometrics (Face ID / Touch ID) are enrolled on this device
  useEffect(() => {
    LocalAuthentication.hasHardwareAsync().then(async (hasHw) => {
      if (!hasHw) return;
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setBiometricAvailable(enrolled);
    });
  }, []);

  const promptBiometric = useCallback(async () => {
    setBiometricPrompted(true);
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Sign in to Trade Navigator',
      fallbackLabel: 'Use Password',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
    if (result.success) {
      router.replace('/(tabs)');
    }
    // On failure/cancel, stay on landing so user can sign in with password
  }, []);

  // Auto-prompt Face ID on mount if there's a stored session
  useEffect(() => {
    if (!isLoading && token && biometricAvailable && !biometricPrompted) {
      promptBiometric();
    } else if (!isLoading && token && !biometricAvailable) {
      router.replace('/(tabs)');
    }
  }, [isLoading, token, biometricAvailable, biometricPrompted, promptBiometric]);

  if (isLoading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  // Stored session + biometrics → show unlock screen while prompt is active
  if (token && biometricAvailable) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <Text style={styles.logo}>Trade Navigator</Text>
        <Pressable style={styles.biometricButton} onPress={promptBiometric}>
          <Text style={styles.biometricIcon}>􀎽</Text>
          <Text style={styles.biometricLabel}>Sign in with Face ID</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/auth/signin')}>
          <Text style={styles.usePasswordText}>Use Password</Text>
        </Pressable>
      </View>
    );
  }

  // Token exists but biometrics unavailable was handled above; shouldn't reach here
  if (token) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

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
  biometricButton: {
    alignItems: 'center',
    gap: 10,
    marginTop: 40,
    marginBottom: 20,
  },
  biometricIcon: {
    fontSize: 52,
    color: colors.accent,
  },
  biometricLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 16,
    color: colors.accent,
  },
  usePasswordText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.ink3,
    marginTop: 8,
  },
});
