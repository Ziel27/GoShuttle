const BrandPalette = {
  primary: '#1A1A2E',
  accent: '#00C896',
  accentAlt: '#4F8EF7',
  surface: '#FFFFFF',
  surfaceDark: '#F4F6FA',
  textPrimary: '#0D0D0D',
  textSecondary: '#6B7280',
  textInverse: '#FFFFFF',
  danger: '#EF4444',
  warning: '#F59E0B',
  success: '#10B981',
  border: '#E5E7EB',
  shadow: 'rgba(0,0,0,0.08)',
  mapOverlay: 'rgba(26,26,46,0.85)',
} as const;

const lightPalette = {
  text: BrandPalette.textPrimary,
  textMuted: BrandPalette.textSecondary,
  textStrong: BrandPalette.primary,
  background: BrandPalette.surfaceDark,
  surface: BrandPalette.surface,
  surfaceMuted: '#F9FAFB',
  border: BrandPalette.border,
  tint: BrandPalette.accent,
  icon: BrandPalette.textSecondary,
  success: BrandPalette.success,
  warning: BrandPalette.warning,
  danger: BrandPalette.danger,
  tabIconDefault: '#9CA3AF',
  tabIconSelected: BrandPalette.accent,
};

const darkPalette = {
  text: '#F5F7FF',
  textMuted: '#9BA3B8',
  textStrong: BrandPalette.textInverse,
  background: '#0E1220',
  surface: '#171C2F',
  surfaceMuted: '#22283C',
  border: '#303951',
  tint: '#21D8A9',
  icon: '#95A1BB',
  success: '#22C88A',
  warning: '#F8B64C',
  danger: '#FF6A76',
  tabIconDefault: '#8A92A8',
  tabIconSelected: '#21D8A9',
};

export const Colors = {
  light: lightPalette,
  dark: darkPalette,
};

export const Typography = {
  h1: { fontSize: 28, lineHeight: 34, fontWeight: '800' as const, letterSpacing: -0.5 },
  h2: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: -0.3 },
  h3: { fontSize: 18, lineHeight: 24, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  bodyBold: { fontSize: 15, lineHeight: 22, fontWeight: '600' as const },
  caption: { fontSize: 12, lineHeight: 18, fontWeight: '400' as const },
  label: { fontSize: 11, lineHeight: 14, fontWeight: '700' as const, letterSpacing: 0.8 },
  button: { fontSize: 16, lineHeight: 22, fontWeight: '700' as const, letterSpacing: 0.3 },
} as const;

export const Spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 20,
  xl: 28,
  pill: 999,
  full: 9999,
} as const;

export const Shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  float: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.11,
    shadowRadius: 10,
    elevation: 5,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 9,
  },
} as const;

export const DesignTokens = {
  spacing: Spacing,
  radius: Radius,
  elevation: {
    card: Shadows.card,
    raised: Shadows.float,
  },
  typography: {
    display: Typography.h1,
    title: Typography.h1,
    subtitle: Typography.h2,
    body: Typography.body,
    bodyStrong: Typography.bodyBold,
    caption: Typography.caption,
    overline: Typography.label,
  },
  motion: {
    quick: 140,
    standard: 200,
    emphasized: 280,
  },
} as const;

export const OutfitFonts = {
  regular: 'Outfit_400Regular',
  medium: 'Outfit_500Medium',
  semiBold: 'Outfit_600SemiBold',
  bold: 'Outfit_700Bold',
  extraBold: 'Outfit_800ExtraBold',
} as const;

export const BrandColors = {
  primary: BrandPalette.primary,
  primaryDark: '#141423',
  primaryLight: '#E6E9F5',
  accent: BrandPalette.accent,
  accentLight: '#E8FCF6',
  accentAlt: BrandPalette.accentAlt,
} as const;

export const Neutral = {
  900: BrandPalette.textPrimary,
  700: '#334155',
  500: BrandPalette.textSecondary,
  300: BrandPalette.border,
  100: '#F3F4F6',
  0: BrandPalette.surface,
} as const;

export const SemanticColors = {
  success: BrandPalette.success,
  successLight: '#DFF8EE',
  warning: BrandPalette.warning,
  warningLight: '#FFF3DC',
  error: BrandPalette.danger,
  errorLight: '#FEE8E8',
  info: BrandPalette.accentAlt,
  infoLight: '#E8F0FF',
} as const;

export const SurfaceColors = {
  background: BrandPalette.surfaceDark,
  card: BrandPalette.surface,
  overlay: BrandPalette.mapOverlay,
} as const;

export const Shadow = Shadows;
