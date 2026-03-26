import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AuthShell } from '@/components/ui/auth-shell';
import { DesignTokens } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useAuthStore } from '@/store/auth';

export default function WelcomeScreen() {
  const markWelcomeSeen = useAuthStore((state) => state.markWelcomeSeen);
  const tint = useThemeColor({}, 'tint');
  const onTint = useThemeColor({}, 'background');

  const goToAuth = async (target: '/(auth)/login' | '/(auth)/register') => {
    await markWelcomeSeen();
    router.replace(target);
  };

  return (
    <AuthShell icon="bus" title="GoShuttle" subtitle="Private rides for your community" heroHeight="58%">
      <View style={styles.sheet}>
        <ThemedText style={styles.title}>Welcome</ThemedText>
        <ThemedText style={styles.copy}>
          Track shuttles in real time, request pickups, and board passengers with a fast, role-based experience.
        </ThemedText>

        <Pressable style={[styles.primaryButton, { backgroundColor: tint }]} onPress={() => goToAuth('/(auth)/register')}>
          <ThemedText style={[styles.primaryText, { color: onTint }]}>Create account</ThemedText>
        </Pressable>

        <Pressable style={[styles.secondaryButton, { borderColor: tint }]} onPress={() => goToAuth('/(auth)/login')}>
          <ThemedText style={[styles.secondaryText, { color: tint }]}>I already have an account</ThemedText>
        </Pressable>
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    gap: DesignTokens.spacing.sm,
  },
  title: {
    ...DesignTokens.typography.title,
  },
  copy: {
    ...DesignTokens.typography.body,
    lineHeight: 22,
    marginBottom: DesignTokens.spacing.xs,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: DesignTokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    fontWeight: '800',
    fontSize: 16,
  },
  secondaryButton: {
    minHeight: 52,
    borderRadius: DesignTokens.radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontWeight: '800',
    fontSize: 16,
  },
});
