import { ThemedText } from '@/components/themed-text';
import { SkeletonLoader } from '@/components/ui/skeleton-loader';
import { AppPalette } from '@/constants/app-ui';
import { DesignTokens, OutfitFonts } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

type MapIndicatorProps = {
  iconName: keyof typeof Ionicons.glyphMap;
  size?: 'sm' | 'md' | 'lg';
};

type MapLoadingPlaceholderProps = {
  title: string;
  hint: string;
};

/**
 * Compact map pin indicator used for shuttle, pickup, and destination markers.
 */
export const MapIndicator = memo(function MapIndicator({ iconName, size = 'md' }: MapIndicatorProps) {
  const bubbleSize = size === 'lg' ? 28 : size === 'sm' ? 16 : 18;
  const wrapperSize = size === 'lg' ? 34 : size === 'sm' ? 20 : 22;
  const iconSize = size === 'lg' ? 14 : size === 'sm' ? 9 : 10;

  return (
    <View style={[styles.mapIndicatorWrapper, { width: wrapperSize, height: wrapperSize }]}>
      <View
        style={[
          styles.mapIndicatorBubble,
          { width: bubbleSize, height: bubbleSize, borderRadius: bubbleSize / 2 },
        ]}
      >
        <Ionicons name={iconName} size={iconSize} color={AppPalette.navy} />
      </View>
    </View>
  );
});

/**
 * Loading shell for map cards while geolocation and boundary data are initializing.
 */
export const MapLoadingPlaceholder = memo(function MapLoadingPlaceholder({
  title,
  hint,
}: MapLoadingPlaceholderProps) {
  return (
    <View style={styles.mapPlaceholder}>
      <View style={styles.mapSkeletonWrap}>
        <SkeletonLoader width="60%" height={18} radius={DesignTokens.radius.sm} />
        <SkeletonLoader width="80%" height={12} radius={DesignTokens.radius.sm} />
      </View>
      <ThemedText style={styles.mapPlaceholderText}>{title}</ThemedText>
      <ThemedText style={styles.mapPlaceholderHint}>{hint}</ThemedText>
    </View>
  );
});

const styles = StyleSheet.create({
  mapIndicatorWrapper: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapIndicatorBubble: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: AppPalette.switchTrackOff,
    backgroundColor: AppPalette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapPlaceholder: {
    flex: 1,
    backgroundColor: AppPalette.navy,
    alignItems: 'center',
    justifyContent: 'center',
    gap: DesignTokens.spacing.xs,
  },
  mapSkeletonWrap: {
    width: '100%',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
    paddingHorizontal: DesignTokens.spacing.lg,
  },
  mapPlaceholderText: {
    color: AppPalette.white,
    fontSize: 20,
    fontFamily: OutfitFonts.extraBold,
  },
  mapPlaceholderHint: {
    color: AppPalette.slateBorder,
    fontSize: 13,
    fontFamily: OutfitFonts.semiBold,
  },
});
