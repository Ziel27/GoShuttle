import { StyleSheet, Text, type TextProps } from 'react-native';

import { DesignTokens, Fonts } from '@/constants/theme';
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
    fontFamily: Fonts?.rounded,
  },
  default: {
    ...DesignTokens.typography.body,
    fontFamily: Fonts?.sans,
  },
  defaultSemiBold: {
    ...DesignTokens.typography.bodyStrong,
    fontFamily: Fonts?.sans,
  },
  title: {
    ...DesignTokens.typography.title,
    fontFamily: Fonts?.rounded,
  },
  subtitle: {
    ...DesignTokens.typography.subtitle,
    fontFamily: Fonts?.sans,
  },
  caption: {
    ...DesignTokens.typography.caption,
    fontFamily: Fonts?.sans,
  },
  overline: {
    ...DesignTokens.typography.overline,
    textTransform: 'uppercase',
    fontFamily: Fonts?.sans,
  },
  link: {
    ...DesignTokens.typography.bodyStrong,
    textDecorationLine: 'underline',
  },
});
