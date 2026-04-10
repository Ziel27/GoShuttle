import { Link, router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AuthShell } from '@/components/ui/auth-shell';
import { ThemedInput } from '@/components/ui/themed-input';
import { DesignTokens, OutfitFonts } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useAuthStore } from '@/store/auth';

export default function RegisterScreen() {
  const register = useAuthStore((state) => state.register);
  const error = useAuthStore((state) => state.error);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const tint = useThemeColor({}, 'tint');
  const danger = useThemeColor({}, 'danger');
  const onTint = useThemeColor({}, 'background');

  const onSubmit = async () => {
    if (!firstName || !lastName || !email || !password) {
      return;
    }

    try {
      await register({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        phone: phone.trim(),
      });
      router.replace('/(tabs)');
    } catch {
      // Error is handled by the auth store state.
    }
  };

  return (
    <AuthShell
      icon="person-add-outline"
      title="Create Account"
      subtitle="Join your private community transit network"
      heroHeight="35%">
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
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="Phone (optional)"
        />

        {error ? <ThemedText style={[styles.error, { color: danger }]}>{error}</ThemedText> : null}

        <Pressable
          style={[styles.button, { backgroundColor: tint }]}
          onPress={onSubmit}
        >
          <ThemedText type="defaultSemiBold" style={{ color: onTint }}>Create account</ThemedText>
        </Pressable>

        <Link href={'/(auth)/login' as Href} style={styles.link}>
          <ThemedText type="link" style={{ color: tint }}>Already have an account? Sign in</ThemedText>
        </Link>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
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
