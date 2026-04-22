/**
 * SkeletonLoader — Animated shimmer placeholder for loading states.
 *
 * Uses react-native-reanimated's withRepeat + withTiming for a smooth,
 * performant shimmer effect. Drop-in replacement for ActivityIndicator
 * on data-fetching screens.
 *
 * Usage:
 *   <SkeletonLoader width={200} height={16} />                // text line
 *   <SkeletonLoader width="100%" height={120} radius={12} />  // card
 *   <SkeletonLoader width={40} height={40} radius={20} />     // avatar
 */

import { DesignTokens, Spacing } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useEffect } from 'react';
import { DimensionValue, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';

type SkeletonLoaderProps = {
  /** Width of the skeleton element. */
  width?: DimensionValue;
  /** Height of the skeleton element. */
  height?: DimensionValue;
  /** Border radius. Defaults to DesignTokens.radius.sm. */
  radius?: number;
  /** Optional bottom margin for stacking multiple skeletons. */
  marginBottom?: number;
};

export function SkeletonLoader({
  width = '100%',
  height = 16,
  radius = DesignTokens.radius.sm,
  marginBottom = 0,
}: SkeletonLoaderProps) {
  const baseColor = useThemeColor({}, 'surfaceMuted');
  const shimmerOpacity = useSharedValue(0.4);

  useEffect(() => {
    shimmerOpacity.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,   // infinite
      true  // reverse
    );
  }, [shimmerOpacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: shimmerOpacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.skeleton,
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: baseColor,
          marginBottom,
        },
        animatedStyle,
      ]}
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
    />
  );
}

/**
 * SkeletonCard — Pre-composed card-shaped skeleton with a title line,
 * two body lines, and an action strip. Matches the PremiumCard layout.
 */
export function SkeletonCard() {
  return (
    <View style={styles.card}>
      <SkeletonLoader width="55%" height={18} marginBottom={Spacing.sm} />
      <SkeletonLoader width="100%" height={14} marginBottom={Spacing.xs} />
      <SkeletonLoader width="80%" height={14} marginBottom={Spacing.md} />
      <SkeletonLoader width="40%" height={36} radius={DesignTokens.radius.pill} />
    </View>
  );
}

/**
 * SkeletonList — Renders N SkeletonCards vertically for list loading states.
 */
export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    overflow: 'hidden',
  },
  card: {
    borderRadius: DesignTokens.radius.lg,
    padding: DesignTokens.spacing.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  list: {
    gap: DesignTokens.spacing.sm,
  },
});
