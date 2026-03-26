import { Link, router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AuthShell } from '@/components/ui/auth-shell';
import { ThemedInput } from '@/components/ui/themed-input';
import { DesignTokens } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/auth';

type Community = {
  _id: string;
  name: string;
};

export default function RegisterScreen() {
  const register = useAuthStore((state) => state.register);
  const loading = useAuthStore((state) => state.loading);
  const error = useAuthStore((state) => state.error);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [communityId, setCommunityId] = useState('');
  const [communities, setCommunities] = useState<Community[]>([]);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const tint = useThemeColor({}, 'tint');
  const danger = useThemeColor({}, 'danger');
  const muted = useThemeColor({}, 'textMuted');
  const onTint = useThemeColor({}, 'background');

  useEffect(() => {
    const loadCommunities = async () => {
      try {
        const response = await api.get('/communities');
        const items = (response.data?.communities || []) as Community[];
        setCommunities(items);

        if (items.length > 0) {
          setCommunityId(items[0]._id);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load communities.';
        setCommunityError(message);
      }
    };

    loadCommunities();
  }, []);

  const onSubmit = async () => {
    if (!firstName || !lastName || !email || !password || !communityId) {
      return;
    }

    try {
      await register({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        communityId,
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
        <ThemedInput
          value={communityId}
          onChangeText={setCommunityId}
          placeholder="Community ID"
        />

        {communities.length > 0 ? (
          <ThemedText style={[styles.hint, { color: muted }]}>
            Available communities: {communities.map((item) => `${item.name} (${item._id})`).join(', ')}
          </ThemedText>
        ) : null}

        {communityError ? <ThemedText style={[styles.error, { color: danger }]}>{communityError}</ThemedText> : null}
        {error ? <ThemedText style={[styles.error, { color: danger }]}>{error}</ThemedText> : null}

        <Pressable
          style={[styles.button, { backgroundColor: tint }, loading && styles.buttonDisabled]}
          onPress={onSubmit}
          disabled={loading}>
          <ThemedText style={[styles.buttonText, { color: onTint }]}>{loading ? 'Creating...' : 'Create account'}</ThemedText>
        </Pressable>

        <Link href={'/(auth)/login' as Href} style={styles.link}>
          <ThemedText style={[styles.linkText, { color: tint }]}>Back to login</ThemedText>
        </Link>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
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
    fontWeight: '800',
    fontSize: 16,
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
