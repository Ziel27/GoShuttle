import { Link, router, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AnimatedPressable } from '@/components/ui/animated-pressable';
import { AuthShell } from '@/components/ui/auth-shell';
import { ThemedInput } from '@/components/ui/themed-input';
import { ROUTES } from '@/constants/routes';
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
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const onTint = useThemeColor({}, 'background');
  const { height } = useWindowDimensions();
  const isCompact = height < 740;

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
      router.replace(ROUTES.tabs);
    } catch {
      // Error is handled by the auth store state.
    }
  }, [email, password, login]);

  return (
    <AuthShell
      icon="shield-checkmark-outline"
      title="Welcome Back"
      subtitle="Sign in to continue your route"
      heroHeight="46%">
      <View style={[styles.formCard, isCompact && styles.formCardCompact, { backgroundColor: surface, borderColor: border }]}> 
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
              pathname: ROUTES.authForgotPassword,
              params: email.trim() ? { email: email.trim() } : undefined,
            })
          }
          accessibilityRole="link"
          accessibilityLabel="Forgot password"
          style={[styles.forgotLink, isCompact && styles.forgotLinkCompact]}>
          <ThemedText type="defaultSemiBold" style={{ color: tint, fontSize: 13 }}>Forgot Password?</ThemedText>
        </Pressable>

        {error ? <ThemedText style={[styles.error, { color: danger }]}>{error}</ThemedText> : null}

        <AnimatedPressable
          style={[styles.button, isCompact && styles.buttonCompact, { backgroundColor: tint }, loading && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={loading ? 'Signing in' : 'Sign in'}
          haptic>
          <ThemedText type="defaultSemiBold" style={{ color: onTint }}>{loading ? 'Signing in...' : 'Sign in'}</ThemedText>
        </AnimatedPressable>

        <Link href={ROUTES.authRegister as Href} style={[styles.link, isCompact && styles.linkCompact]}>
          <ThemedText type="link" style={{ color: tint }}>Create an account</ThemedText>
        </Link>
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  formCard: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.lg,
    padding: DesignTokens.spacing.md,
    gap: DesignTokens.spacing.sm,
    ...DesignTokens.elevation.card,
  },
  formCardCompact: {
    padding: DesignTokens.spacing.md - DesignTokens.spacing.xs,
    gap: DesignTokens.spacing.xs,
  },
  button: {
    marginTop: DesignTokens.spacing.xs,
    borderRadius: DesignTokens.radius.pill,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonCompact: {
    marginTop: DesignTokens.spacing.xxs,
    minHeight: 50,
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
    paddingVertical: DesignTokens.spacing.xxs,
  },
  forgotLinkCompact: {
    paddingVertical: 0,
  },
  forgotLinkText: {
    fontFamily: OutfitFonts.bold,
    fontSize: 12,
  },
  link: {
    marginTop: DesignTokens.spacing.xs,
    alignSelf: 'center',
  },
  linkCompact: {
    marginTop: DesignTokens.spacing.xxs,
  },
  linkText: {
    fontFamily: OutfitFonts.bold,
  },
  error: {
    fontFamily: OutfitFonts.semiBold,
  },
});
