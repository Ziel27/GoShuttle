import { ThemedText } from '@/components/themed-text';
import { DesignTokens } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { Ionicons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import { DimensionValue, StyleSheet, View } from 'react-native';

type AuthShellProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  children: ReactNode;
  heroHeight?: DimensionValue;
};

export function AuthShell({
  icon,
  title,
  subtitle,
  children,
  heroHeight = '40%',
}: AuthShellProps) {
  const background = useThemeColor({}, 'background');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');
  const onTint = useThemeColor({}, 'background');

  return (
    <View style={[styles.container, { backgroundColor: background }]}>
      <View style={[styles.hero, { height: heroHeight, backgroundColor: tint }]}>
        <View style={[styles.heroIconWrap, { borderColor: border }]}>
          <Ionicons name={icon} size={24} color={onTint} />
        </View>
        <ThemedText style={[styles.heroTitle, { color: onTint }]}>{title}</ThemedText>
        <ThemedText style={[styles.heroSubtitle, { color: onTint }]}>{subtitle}</ThemedText>
      </View>

      <View style={[styles.sheet, { backgroundColor: surface, borderColor: border }]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: DesignTokens.spacing.xs,
    paddingHorizontal: DesignTokens.spacing.lg,
  },
  heroIconWrap: {
    width: 44,
    height: 44,
    borderRadius: DesignTokens.radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    ...DesignTokens.typography.display,
    fontSize: 30,
    lineHeight: 36,
  },
  heroSubtitle: {
    ...DesignTokens.typography.body,
    textAlign: 'center',
    opacity: 0.88,
  },
  sheet: {
    flex: 1,
    marginTop: -DesignTokens.spacing.lg,
    borderTopLeftRadius: DesignTokens.radius.xl,
    borderTopRightRadius: DesignTokens.radius.xl,
    borderWidth: 1,
    padding: DesignTokens.spacing.lg,
    gap: DesignTokens.spacing.sm,
  },
});
