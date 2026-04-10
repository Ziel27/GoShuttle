import { StyleSheet, Text, type TextProps } from 'react-native';

import { DesignTokens, OutfitFonts } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?: 'default' | 'title' | 'defaultSemiBold' | 'subtitle' | 'link' | 'display' | 'caption' | 'overline';
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = 'default',
  ...rest
}: ThemedTextProps) {
  const textColor = useThemeColor({ light: lightColor, dark: darkColor }, 'text');
  const tintColor = useThemeColor({ light: lightColor, dark: darkColor }, 'tint');
  const color = type === 'link' ? tintColor : textColor;

  return (
    <Text
      style={[
        { color },
        type === 'display' ? styles.display : undefined,
        type === 'default' ? styles.default : undefined,
        type === 'title' ? styles.title : undefined,
        type === 'defaultSemiBold' ? styles.defaultSemiBold : undefined,
        type === 'subtitle' ? styles.subtitle : undefined,
        type === 'caption' ? styles.caption : undefined,
        type === 'overline' ? styles.overline : undefined,
        type === 'link' ? styles.link : undefined,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  display: {
    ...DesignTokens.typography.display,
    fontFamily: OutfitFonts.extraBold,
  },
  default: {
    ...DesignTokens.typography.body,
    fontFamily: OutfitFonts.regular,
  },
  defaultSemiBold: {
    ...DesignTokens.typography.bodyStrong,
    fontFamily: OutfitFonts.semiBold,
  },
  title: {
    ...DesignTokens.typography.title,
    fontFamily: OutfitFonts.bold,
  },
  subtitle: {
    ...DesignTokens.typography.subtitle,
    fontFamily: OutfitFonts.semiBold,
  },
  caption: {
    ...DesignTokens.typography.caption,
    fontFamily: OutfitFonts.medium,
  },
  overline: {
    ...DesignTokens.typography.overline,
    textTransform: 'uppercase',
    fontFamily: OutfitFonts.bold,
  },
  link: {
    ...DesignTokens.typography.bodyStrong,
    fontFamily: OutfitFonts.semiBold,
    textDecorationLine: 'underline',
  },
});

