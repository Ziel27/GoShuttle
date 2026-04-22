import { ThemedText } from '@/components/themed-text';
import { AnimatedPressable } from '@/components/ui/animated-pressable';
import { DesignTokens, OutfitFonts } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { ReactNode } from 'react';
import { StyleProp, StyleSheet, ViewStyle, type AccessibilityState } from 'react-native';

type PremiumButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

type PremiumButtonProps = {
  onPress?: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  variant?: PremiumButtonVariant;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: 'button' | 'link';
  accessibilityState?: AccessibilityState;
};

export function PremiumButton({
  onPress,
  children,
  style,
  disabled = false,
  variant = 'primary',
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole,
  accessibilityState,
}: PremiumButtonProps) {
  const tint = useThemeColor({}, 'tint');
  const danger = useThemeColor({}, 'danger');
  const textInverse = '#FFFFFF';

  const palette =
    variant === 'primary'
      ? { backgroundColor: tint, borderColor: tint, textColor: textInverse, borderWidth: 0 }
      : variant === 'danger'
      ? { backgroundColor: danger, borderColor: danger, textColor: textInverse, borderWidth: 0 }
      : variant === 'ghost'
      ? { backgroundColor: 'transparent', borderColor: 'transparent', textColor: tint, borderWidth: 0 }
      : { backgroundColor: 'transparent', borderColor: tint, textColor: tint, borderWidth: 1 };

  return (
    <AnimatedPressable
      disabled={disabled}
      onPress={onPress}
      accessibilityRole={accessibilityRole ?? 'button'}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState}
      haptic
      style={[
        styles.button,
        {
          backgroundColor: palette.backgroundColor,
          borderColor: palette.borderColor,
          borderWidth: palette.borderWidth,
          opacity: disabled ? 0.6 : 1,
        },
        style,
      ]}>
      {typeof children === 'string' ? (
        <ThemedText style={[styles.buttonText, { color: palette.textColor }]}>{children}</ThemedText>
      ) : (
        children
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: DesignTokens.radius.pill,
    paddingHorizontal: DesignTokens.spacing.md,
    paddingVertical: DesignTokens.spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: DesignTokens.spacing.xs,
  },
  buttonText: {
    fontFamily: OutfitFonts.bold,
    fontSize: DesignTokens.typography.bodyStrong.fontSize,
    letterSpacing: 0.3,
  },
});

