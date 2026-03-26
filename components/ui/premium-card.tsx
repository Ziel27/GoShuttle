import { DesignTokens } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { ReactNode } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

type PremiumCardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  muted?: boolean;
};

export function PremiumCard({ children, style, muted = false }: PremiumCardProps) {
  const background = useThemeColor({}, muted ? 'surfaceMuted' : 'surface');
  const borderColor = useThemeColor({}, 'border');

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: background,
          borderColor,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.lg,
    padding: DesignTokens.spacing.sm,
    gap: DesignTokens.spacing.xs,
    ...DesignTokens.elevation.card,
  },
});
