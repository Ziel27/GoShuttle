import { Link, router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AuthShell } from '@/components/ui/auth-shell';
import { ThemedInput } from '@/components/ui/themed-input';
import { DesignTokens } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useAuthStore } from '@/store/auth';

export default function LoginScreen() {
  const login = useAuthStore((state) => state.login);
  const loading = useAuthStore((state) => state.loading);
  const error = useAuthStore((state) => state.error);
  const tint = useThemeColor({}, 'tint');
  const danger = useThemeColor({}, 'danger');
  const onTint = useThemeColor({}, 'background');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const onSubmit = async () => {
    if (!email || !password) {
      return;
    }

    try {
      await login(email.trim(), password);
      router.replace('/(tabs)');
    } catch {
      // Error is handled by the auth store state.
    }
  };

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
          <ThemedText style={[styles.forgotLinkText, { color: tint }]}>Forgot Password?</ThemedText>
        </Pressable>

        {error ? <ThemedText style={[styles.error, { color: danger }]}>{error}</ThemedText> : null}

        <Pressable
          style={[styles.button, { backgroundColor: tint }, loading && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={loading}>
          <ThemedText style={[styles.buttonText, { color: onTint }]}>{loading ? 'Signing in...' : 'Sign in'}</ThemedText>
        </Pressable>

        <Link href={'/(auth)/register' as Href} style={styles.link}>
          <ThemedText style={[styles.linkText, { color: tint }]}>Create an account</ThemedText>
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
    fontWeight: '800',
    fontSize: 16,
  },
  forgotLink: {
    alignSelf: 'flex-end',
  },
  forgotLinkText: {
    fontWeight: '700',
    fontSize: 12,
  },
  link: {
    marginTop: 4,
    alignSelf: 'center',
  },
  linkText: {
    fontWeight: '700',
  },
  error: {
    fontWeight: '600',
  },
});
