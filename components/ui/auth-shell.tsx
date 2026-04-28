import { ThemedText } from '@/components/themed-text';
import { BrandColors, DesignTokens, OutfitFonts } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { Ionicons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import {
  DimensionValue,
  Image,
  type ImageSourcePropType,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

type AuthShellProps = {
  icon: keyof typeof Ionicons.glyphMap;
  logoSource?: ImageSourcePropType;
  title: string;
  subtitle: string;
  children: ReactNode;
  heroHeight?: DimensionValue;
};

export function AuthShell({
  icon,
  logoSource,
  title,
  subtitle,
  children,
  heroHeight = '44%',
}: AuthShellProps) {
  const background = useThemeColor({}, 'background');
  const border = useThemeColor({}, 'border');
  const tint = useThemeColor({}, 'tint');
  const { height } = useWindowDimensions();
  const isCompact = height < 740;
  const heroBase = useThemeColor({ light: BrandColors.primary, dark: '#11162A' }, 'background');
  const heroAccent = useThemeColor({ light: BrandColors.accentAlt, dark: '#345CB0' }, 'tint');
  const heroSoft = useThemeColor({ light: 'rgba(255,255,255,0.22)', dark: 'rgba(255,255,255,0.12)' }, 'surface');
  const sheetSurface = useThemeColor({ light: '#EEF2F7', dark: '#12192B' }, 'background');
  const onTint = '#FFFFFF';

  return (
    <View style={[styles.container, { backgroundColor: background }]}>
      <View style={[styles.hero, isCompact && styles.heroCompact, { height: heroHeight, backgroundColor: heroBase }]}> 
        <View style={[styles.heroBlobPrimary, { backgroundColor: heroAccent }]} />
        <View style={[styles.heroBlobPrimaryGlow, { backgroundColor: heroSoft }]} />
        <View style={[styles.heroBlobSecondary, { backgroundColor: tint }]} />
        <View style={[styles.heroBlobSecondaryGlow, { backgroundColor: heroSoft }]} />
        {logoSource ? (
          <View style={[styles.heroLogoFrame, isCompact && styles.heroLogoFrameCompact]}>
            <Image
              source={logoSource}
              resizeMode="cover"
              style={[styles.heroLogo, isCompact && styles.heroLogoCompact]}
            />
          </View>
        ) : (
          <View style={[styles.heroIconWrap, isCompact && styles.heroIconWrapCompact, { borderColor: 'rgba(255,255,255,0.35)' }]}>
            <Ionicons name={icon} size={24} color={onTint} />
          </View>
        )}
        <ThemedText 
          type="display" 
          style={[styles.heroTitle, isCompact && styles.heroTitleCompact, { color: onTint }]}
        >
          {title}
        </ThemedText>
        <ThemedText style={[styles.heroSubtitle, isCompact && styles.heroSubtitleCompact, { color: onTint }]}>{subtitle}</ThemedText>
      </View>

      <KeyboardAvoidingView
        style={[styles.kavWrap, isCompact && styles.kavWrapCompact]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <ScrollView
          style={[styles.sheet, { backgroundColor: sheetSurface, borderColor: border }]}
          contentContainerStyle={[styles.sheetContent, isCompact && styles.sheetContentCompact]}
          keyboardShouldPersistTaps="handled"
          bounces={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
        >
          <View style={[styles.dragHandle, isCompact && styles.dragHandleCompact, { backgroundColor: border }]} />
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
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
    overflow: 'hidden',
  },
  heroCompact: {
    gap: DesignTokens.spacing.xxs,
    paddingHorizontal: DesignTokens.spacing.md,
  },
  heroBlobPrimary: {
    position: 'absolute',
    width: 282,
    height: 192,
    top: -94,
    right: -74,
    opacity: 0.34,
    transform: [{ rotate: '-18deg' }],
    borderTopLeftRadius: 130,
    borderTopRightRadius: 92,
    borderBottomRightRadius: 146,
    borderBottomLeftRadius: 78,
  },
  heroBlobPrimaryGlow: {
    position: 'absolute',
    width: 176,
    height: 116,
    top: -14,
    right: 12,
    opacity: 0.24,
    transform: [{ rotate: '-10deg' }],
    borderTopLeftRadius: 72,
    borderTopRightRadius: 58,
    borderBottomRightRadius: 86,
    borderBottomLeftRadius: 50,
  },
  heroBlobSecondary: {
    position: 'absolute',
    width: 232,
    height: 166,
    bottom: -84,
    left: -82,
    opacity: 0.27,
    transform: [{ rotate: '22deg' }],
    borderTopLeftRadius: 118,
    borderTopRightRadius: 84,
    borderBottomRightRadius: 110,
    borderBottomLeftRadius: 72,
  },
  heroBlobSecondaryGlow: {
    position: 'absolute',
    width: 142,
    height: 102,
    bottom: -20,
    left: 22,
    opacity: 0.18,
    transform: [{ rotate: '18deg' }],
    borderTopLeftRadius: 70,
    borderTopRightRadius: 44,
    borderBottomRightRadius: 64,
    borderBottomLeftRadius: 42,
  },
  heroIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  heroIconWrapCompact: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  heroLogoFrame: {
    width: 112,
    height: 112,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  heroLogoFrameCompact: {
    width: 98,
    height: 98,
    borderRadius: 24,
  },
  heroLogo: {
    width: '100%',
    height: '100%',
    transform: [{ scale: 1.16 }],
  },
  heroLogoCompact: {
    transform: [{ scale: 1.18 }],
  },
  heroTitle: {
    ...DesignTokens.typography.display,
    fontSize: 32,
    lineHeight: 38,
    fontFamily: OutfitFonts.extraBold,
  },
  heroTitleCompact: {
    fontSize: 28,
    lineHeight: 34,
  },
  heroSubtitle: {
    ...DesignTokens.typography.body,
    textAlign: 'center',
    opacity: 0.9,
    maxWidth: 300,
    fontFamily: OutfitFonts.medium,
  },
  heroSubtitleCompact: {
    maxWidth: 280,
  },
  kavWrap: {
    flex: 1,
    marginTop: -DesignTokens.spacing.xl,
  },
  kavWrapCompact: {
    marginTop: -DesignTokens.spacing.lg,
  },
  sheet: {
    flex: 1,
    borderTopLeftRadius: DesignTokens.radius.xl,
    borderTopRightRadius: DesignTokens.radius.xl,
    borderWidth: 1,
  },
  sheetContent: {
    paddingHorizontal: DesignTokens.spacing.lg,
    paddingBottom: DesignTokens.spacing.xl,
    paddingTop: DesignTokens.spacing.sm,
    gap: DesignTokens.spacing.md,
    width: '100%',
    maxWidth: 540,
    alignSelf: 'center',
  },
  sheetContentCompact: {
    paddingTop: DesignTokens.spacing.xs,
    paddingBottom: DesignTokens.spacing.lg,
    gap: DesignTokens.spacing.sm,
  },
  dragHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: DesignTokens.radius.pill,
    marginBottom: DesignTokens.spacing.sm,
  },
  dragHandleCompact: {
    marginBottom: DesignTokens.spacing.xs,
  },
});
