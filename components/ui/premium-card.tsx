import { DesignTokens } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { ReactNode } from 'react';
import { StyleProp, StyleSheet, ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

type PremiumCardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  muted?: boolean;
};

export function PremiumCard({ children, style, muted = false }: PremiumCardProps) {
  const background = useThemeColor({}, muted ? 'surfaceMuted' : 'surface');
  const borderColor = useThemeColor({}, 'border');

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      style={[
        styles.card,
        {
          backgroundColor: background,
          borderColor,
        },
        style,
      ]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.lg,
    padding: DesignTokens.spacing.md,
    gap: DesignTokens.spacing.sm,
  },
});
