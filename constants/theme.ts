/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const tintColorLight = '#0f172a';
const tintColorDark = '#f8fafc';

const lightPalette = {
  text: '#0f172a',
  textMuted: '#475569',
  textStrong: '#020617',
  background: '#f8fafc',
  surface: '#ffffff',
  surfaceMuted: '#f1f5f9',
  border: '#cbd5e1',
  tint: tintColorLight,
  icon: '#64748b',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#f43f5e',
  tabIconDefault: '#64748b',
  tabIconSelected: tintColorLight,
};

const darkPalette = {
  text: '#e2e8f0',
  textMuted: '#94a3b8',
  textStrong: '#ffffff',
  background: '#020617',
  surface: '#0f172a',
  surfaceMuted: '#1e293b',
  border: '#334155',
  tint: tintColorDark,
  icon: '#94a3b8',
  success: '#34d399',
  warning: '#fbbf24',
  danger: '#fb7185',
  tabIconDefault: '#94a3b8',
  tabIconSelected: tintColorDark,
};

export const Colors = {
  light: lightPalette,
  dark: darkPalette,
};

export const DesignTokens = {
  spacing: {
    xxs: 4,
    xs: 8,
    sm: 12,
    md: 16,
    lg: 20,
    xl: 24,
    xxl: 32,
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    pill: 999,
  },
  elevation: {
    card: {
      shadowColor: '#0f172a',
      shadowOpacity: 0.08,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 10,
      elevation: 2,
    },
    raised: {
      shadowColor: '#0f172a',
      shadowOpacity: 0.14,
      shadowOffset: { width: 0, height: 8 },
      shadowRadius: 16,
      elevation: 4,
    },
  },
  typography: {
    display: { fontSize: 34, lineHeight: 40, fontWeight: '800' as const },
    title: { fontSize: 28, lineHeight: 34, fontWeight: '800' as const },
    subtitle: { fontSize: 20, lineHeight: 26, fontWeight: '700' as const },
    body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
    bodyStrong: { fontSize: 16, lineHeight: 24, fontWeight: '600' as const },
    caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
    overline: { fontSize: 11, lineHeight: 14, fontWeight: '700' as const, letterSpacing: 0.4 },
  },
  motion: {
    quick: 140,
    standard: 200,
    emphasized: 280,
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
