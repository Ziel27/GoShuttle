import { Link, router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AnimatedPressable } from '@/components/ui/animated-pressable';
import { AuthShell } from '@/components/ui/auth-shell';
import { ThemedInput } from '@/components/ui/themed-input';
import { ROUTES } from '@/constants/routes';
import { DesignTokens, OutfitFonts } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { listCommunities } from '@/services/community';
import { useAuthStore } from '@/store/auth';
import { Ionicons } from '@expo/vector-icons';

const logoSource = require('../../assets/images/logo.png');

export default function RegisterScreen() {
  const register = useAuthStore((state) => state.register);
  const loading = useAuthStore((state) => state.loading);
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [communityId, setCommunityId] = useState<string | undefined>(undefined);
  const [communityName, setCommunityName] = useState<string>('');
  const [clientError, setClientError] = useState('');
  const tint = useThemeColor({}, 'tint');
  const danger = useThemeColor({}, 'danger');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const surfaceMuted = useThemeColor({}, 'surfaceMuted');
  const mutedColor = useThemeColor({}, 'textMuted');
  const onTint = useThemeColor({}, 'background');
  const { height } = useWindowDimensions();
  const isCompact = height < 740;

  useEffect(() => {
    const loadCommunities = async () => {
      try {
        const rows = await listCommunities();
        if (rows.length > 0) {
          setCommunityId(rows[0]._id);
          setCommunityName(rows[0].name);
        }
      } catch (e) {
        console.error('Failed to load communities:', e);
      }
    };
    loadCommunities();
  }, []);

  useEffect(() => {
    clearError();
  }, [clearError]);

  useEffect(() => {
    if (clientError) {
      setClientError('');
    }
  }, [clientError, firstName, lastName, email, password, confirmPassword, phone]);

  const onSubmit = async () => {
    clearError();

    if (!firstName || !lastName || !email || !password || !confirmPassword) {
      setClientError('Please complete all required fields.');
      return;
    }

    if (password !== confirmPassword) {
      setClientError('Passwords do not match.');
      return;
    }

    if (password.length < 8) {
      setClientError('Password must be at least 8 characters.');
      return;
    }

    try {
      await register({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        phone: phone.trim(),
        communityId,
      });
      router.replace(ROUTES.tabs);
    } catch {
      // Error is handled by the auth store state.
    }
  };

  return (
    <AuthShell
      icon="person-add-outline"
      logoSource={logoSource}
      title="Create Account"
      subtitle="Join your private community transit network"
      heroHeight="40%">
      <View style={[styles.formCard, isCompact && styles.formCardCompact, { backgroundColor: surface, borderColor: border }]}> 
        <ThemedInput
          value={firstName}
          onChangeText={setFirstName}
          placeholder="First name"
        />
        <ThemedInput
          value={lastName}
          onChangeText={setLastName}
          placeholder="Last name"
        />
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
        <ThemedInput
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          placeholder="Confirm password"
        />
        <ThemedInput
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="Phone (optional)"
        />

        {communityName ? (
          <View style={[styles.communityBadge, { borderColor: border, backgroundColor: surfaceMuted }]}>
            <Ionicons name="shield-checkmark" size={16} color={tint} />
            <ThemedText style={{ color: tint, fontFamily: OutfitFonts.bold, fontSize: 13 }}>
              {communityName}
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.phaseSection}>
          <ThemedText type="caption" style={{ color: mutedColor, marginBottom: 4 }}>
            Your phase will be detected automatically from your saved home GPS location.
          </ThemedText>
        </View>

        {clientError ? <ThemedText style={[styles.error, { color: danger }]}>{clientError}</ThemedText> : null}
        {!clientError && error ? <ThemedText style={[styles.error, { color: danger }]}>{error}</ThemedText> : null}

        <AnimatedPressable
          style={[styles.button, isCompact && styles.buttonCompact, { backgroundColor: tint }, loading && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Create account"
          haptic
        >
          <ThemedText type="defaultSemiBold" style={{ color: onTint }}>{loading ? 'Creating account...' : 'Create account'}</ThemedText>
        </AnimatedPressable>

        <Link href={ROUTES.authLogin as Href} style={[styles.link, isCompact && styles.linkCompact]}>
          <ThemedText type="link" style={{ color: tint }}>Already have an account? Sign in</ThemedText>
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
  label: {
    fontFamily: OutfitFonts.bold,
    fontSize: 14,
    marginBottom: DesignTokens.spacing.xxs,
  },

  hint: {
    ...DesignTokens.typography.caption,
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
  phaseSection: {
    marginTop: DesignTokens.spacing.xs,
  },
  communityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
    borderRadius: DesignTokens.radius.md,
    borderWidth: 1,
  },
  phaseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
    borderRadius: DesignTokens.radius.md,
    borderWidth: 1,
  },
  phaseDropdown: {
    marginTop: DesignTokens.spacing.xxs,
    borderRadius: DesignTokens.radius.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  phaseOption: {
    paddingVertical: DesignTokens.spacing.sm,
    paddingHorizontal: DesignTokens.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  phaseOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
  },
  phaseColorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
});
