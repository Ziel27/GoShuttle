import { Link, router, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AuthShell } from '@/components/ui/auth-shell';
import { ThemedInput } from '@/components/ui/themed-input';
import { DesignTokens, OutfitFonts } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useAuthStore } from '@/store/auth';

export default function LoginScreen() {
  const login = useAuthStore((state) => state.login);
  const loading = useAuthStore((state) => state.loading);
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);
  const tint = useThemeColor({}, 'tint');
  const danger = useThemeColor({}, 'danger');
  const onTint = useThemeColor({}, 'background');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    clearError();
  }, [clearError]);

  const onSubmit = useCallback(async () => {
    if (!email || !password) {
      return;
    }

    try {
      await login(email.trim(), password);
      router.replace('/(tabs)');
    } catch {
      // Error is handled by the auth store state.
    }
  }, [email, password, login]);

  return (
    <AuthShell
      icon="shield-checkmark-outline"
      title="Welcome Back"
      subtitle="Sign in to continue your route"
      heroHeight="42%">
        <ThemedInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="Email"
        />

        <ThemedInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Password"
        />

        <Pressable
          onPress={() =>
            router.push({
              pathname: '/(auth)/forgot-password',
              params: email.trim() ? { email: email.trim() } : undefined,
            })
          }
          style={styles.forgotLink}>
          <ThemedText type="defaultSemiBold" style={{ color: tint, fontSize: 13 }}>Forgot Password?</ThemedText>
        </Pressable>

        {error ? <ThemedText style={[styles.error, { color: danger }]}>{error}</ThemedText> : null}

        <Pressable
          style={[styles.button, { backgroundColor: tint }, loading && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={loading}>
          <ThemedText type="defaultSemiBold" style={{ color: onTint }}>{loading ? 'Signing in...' : 'Sign in'}</ThemedText>
        </Pressable>

        <Link href={'/(auth)/register' as Href} style={styles.link}>
          <ThemedText type="link" style={{ color: tint }}>Create an account</ThemedText>
        </Link>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  button: {
    marginTop: DesignTokens.spacing.xs,
    borderRadius: DesignTokens.radius.md,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    fontFamily: OutfitFonts.extraBold,
    fontSize: 16,
  },
  forgotLink: {
    alignSelf: 'flex-end',
  },
  forgotLinkText: {
    fontFamily: OutfitFonts.bold,
    fontSize: 12,
  },
  link: {
    marginTop: 4,
    alignSelf: 'center',
  },
  linkText: {
    fontFamily: OutfitFonts.bold,
  },
  error: {
    fontFamily: OutfitFonts.semiBold,
  },
});
