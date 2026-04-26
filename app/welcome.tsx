import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AuthShell } from '@/components/ui/auth-shell';
import { AuthEntryRoute, ROUTES } from '@/constants/routes';
import { DesignTokens, OutfitFonts } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useAuthStore } from '@/store/auth';

export default function WelcomeScreen() {
  const markWelcomeSeen = useAuthStore((state) => state.markWelcomeSeen);
  const tint = useThemeColor({}, 'tint');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const onTint = useThemeColor({}, 'background');

  const goToAuth = async (target: AuthEntryRoute) => {
    await markWelcomeSeen();
    router.replace(target);
  };

  return (
    <AuthShell icon="bus" title="GoShuttle" subtitle="Private rides for your community" heroHeight="58%">
      <View style={[styles.sheet, { backgroundColor: surface, borderColor: border }]}> 
        <ThemedText type="title">Welcome</ThemedText>
        <ThemedText style={styles.copy}>
          Track shuttles in real time, request pickups, and board passengers with a fast, role-based experience.
        </ThemedText>

        <Pressable style={[styles.primaryButton, { backgroundColor: tint }]} onPress={() => goToAuth(ROUTES.authRegister)}>
          <ThemedText type="defaultSemiBold" style={{ color: onTint }}>Create account</ThemedText>
        </Pressable>

        <Pressable style={[styles.secondaryButton, { borderColor: tint }]} onPress={() => goToAuth(ROUTES.authLogin)}>
          <ThemedText type="defaultSemiBold" style={{ color: tint }}>I already have an account</ThemedText>
        </Pressable>
      </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.lg,
    padding: DesignTokens.spacing.md,
    gap: DesignTokens.spacing.sm,
    ...DesignTokens.elevation.card,
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
    borderRadius: DesignTokens.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    fontFamily: OutfitFonts.extraBold,
    fontSize: 16,
  },
  secondaryButton: {
    minHeight: 52,
    borderRadius: DesignTokens.radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontFamily: OutfitFonts.extraBold,
    fontSize: 16,
  },
});
