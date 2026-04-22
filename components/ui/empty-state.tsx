/**
 * EmptyState — Placeholder shown when a list or data section has no content.
 *
 * Renders a centered icon, title, subtitle, and an optional CTA button.
 * Designed to replace bare "No data" text with a polished, illustrative UI.
 *
 * Usage:
 *   <EmptyState
 *     icon="trail-sign-outline"
 *     title="No upcoming trips"
 *     subtitle="Tap below to book your first ride."
 *     ctaLabel="Book Shuttle"
 *     onCtaPress={() => router.push('/booking')}
 *   />
 */

import { DesignTokens, Neutral, OutfitFonts, Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type EmptyStateProps = {
  /** Ionicons icon name displayed above the title. */
  icon: keyof typeof Ionicons.glyphMap;
  /** Main headline — should explain what's empty. */
  title: string;
  /** Supporting copy — should suggest what the user can do next. */
  subtitle?: string;
  /** Optional call-to-action button label. */
  ctaLabel?: string;
  /** Callback fired when the CTA button is pressed. */
  onCtaPress?: () => void;
  /** Override the icon color. Defaults to theme tint. */
  iconColor?: string;
};

export function EmptyState({
  icon,
  title,
  subtitle,
  ctaLabel,
  onCtaPress,
  iconColor,
}: EmptyStateProps) {
  const tint = useThemeColor({}, 'tint');
  const textColor = useThemeColor({}, 'text');
  const mutedColor = useThemeColor({}, 'textMuted');
  const surface = useThemeColor({}, 'surfaceMuted');
  const resolvedIconColor = iconColor || tint;

  return (
    <View style={styles.container} accessibilityRole="summary">
      <View style={[styles.iconCircle, { backgroundColor: surface }]}>
        <Ionicons name={icon} size={32} color={resolvedIconColor} />
      </View>
      <Text
        style={[styles.title, { color: textColor }]}
        accessibilityRole="header"
      >
        {title}
      </Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: mutedColor }]}>
          {subtitle}
        </Text>
      ) : null}
      {ctaLabel && onCtaPress ? (
        <Pressable
          style={[styles.cta, { backgroundColor: tint }]}
          onPress={onCtaPress}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
        >
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  title: {
    fontFamily: OutfitFonts.semiBold,
    fontSize: 17,
    lineHeight: 22,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: OutfitFonts.regular,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    maxWidth: 280,
  },
  cta: {
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: DesignTokens.radius.pill,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    ...DesignTokens.elevation.card,
  },
  ctaText: {
    fontFamily: OutfitFonts.bold,
    fontSize: 14,
    color: Neutral[0],
  },
});
