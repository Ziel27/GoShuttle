/**
 * StatusBanner — App-level animated status indicator.
 *
 * Slides in from the top to communicate transient system messages like
 * "Shuttle arriving in 3 min", "No shuttles available", or "Connection lost".
 *
 * Auto-dismisses after `duration` ms (default 4 000 ms) unless `persistent` is set.
 *
 * Usage:
 *   <StatusBanner
 *     visible={showBanner}
 *     message="Shuttle arriving in 3 min"
 *     variant="info"
 *     onDismiss={() => setShowBanner(false)}
 *   />
 */

import { DesignTokens, OutfitFonts, SemanticColors, Spacing } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
    SlideInUp,
    SlideOutUp,
} from 'react-native-reanimated';

type BannerVariant = 'success' | 'warning' | 'error' | 'info';

type StatusBannerProps = {
  /** Controls visibility. */
  visible: boolean;
  /** The message to display. */
  message: string;
  /** Semantic variant controls color and icon. */
  variant?: BannerVariant;
  /** Called when the banner is dismissed (tap or auto-timeout). */
  onDismiss?: () => void;
  /** Auto-dismiss duration in ms. Set to 0 to keep it persistent. */
  duration?: number;
};

const VARIANT_CONFIG: Record<BannerVariant, {
  bg: string;
  fg: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = {
  success: {
    bg: SemanticColors.successLight,
    fg: SemanticColors.success,
    icon: 'checkmark-circle',
  },
  warning: {
    bg: SemanticColors.warningLight,
    fg: SemanticColors.warning,
    icon: 'warning',
  },
  error: {
    bg: SemanticColors.errorLight,
    fg: SemanticColors.error,
    icon: 'close-circle',
  },
  info: {
    bg: SemanticColors.infoLight,
    fg: SemanticColors.info,
    icon: 'information-circle',
  },
};

export function StatusBanner({
  visible,
  message,
  variant = 'info',
  onDismiss,
  duration = 4000,
}: StatusBannerProps) {
  const config = VARIANT_CONFIG[variant];

  useEffect(() => {
    if (!visible || duration === 0 || !onDismiss) return;

    const timer = setTimeout(onDismiss, duration);
    return () => clearTimeout(timer);
  }, [visible, duration, onDismiss]);

  if (!visible) return null;

  return (
    <Animated.View
      entering={SlideInUp.duration(250)}
      exiting={SlideOutUp.duration(200)}
      style={[styles.banner, { backgroundColor: config.bg }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <Ionicons name={config.icon} size={18} color={config.fg} />
      <Text style={[styles.message, { color: config.fg }]} numberOfLines={2}>
        {message}
      </Text>
      {onDismiss ? (
        <Pressable
          onPress={onDismiss}
          hitSlop={8}
          accessibilityLabel="Dismiss"
          accessibilityRole="button"
          style={styles.dismissBtn}
        >
          <Ionicons name="close" size={16} color={config.fg} />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: DesignTokens.radius.md,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.xs,
    minHeight: 52,
    ...DesignTokens.elevation.card,
  },
  message: {
    flex: 1,
    fontFamily: OutfitFonts.semiBold,
    fontSize: 12,
    lineHeight: 18,
  },
  dismissBtn: {
    padding: Spacing.xs,
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
