/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Hook to get a theme-aware color or fallback to a provided prop color.
 * @param {{ light?: string; dark?: string }} props - Optional specific colors for light and dark themes.
 * @param {keyof typeof Colors.light & keyof typeof Colors.dark} colorName - The name of the color token.
 * @returns {string} The resolved hex color value.
 */
export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof typeof Colors.light & keyof typeof Colors.dark
): string {
  const theme = useColorScheme() ?? 'light';
  const colorFromProps = props[theme];

  if (colorFromProps) {
    return colorFromProps;
  } else {
    return Colors[theme][colorName];
  }
}
