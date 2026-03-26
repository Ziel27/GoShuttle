import { ThemedText } from '@/components/themed-text';
import { DesignTokens } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { ReactNode } from 'react';
import { Pressable, StyleProp, StyleSheet, ViewStyle } from 'react-native';

type PremiumButtonVariant = 'primary' | 'secondary' | 'danger';

type PremiumButtonProps = {
  onPress?: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  variant?: PremiumButtonVariant;
};

export function PremiumButton({
  onPress,
  children,
  style,
  disabled = false,
  variant = 'primary',
}: PremiumButtonProps) {
  const tint = useThemeColor({}, 'tint');
  const surface = useThemeColor({}, 'surface');
  const border = useThemeColor({}, 'border');
  const danger = useThemeColor({}, 'danger');
  const backgroundText = useThemeColor({}, 'background');

  const palette =
    variant === 'primary'
      ? { backgroundColor: tint, borderColor: tint, textColor: backgroundText }
      : variant === 'danger'
      ? { backgroundColor: danger, borderColor: danger, textColor: '#ffffff' }
      : { backgroundColor: surface, borderColor: border, textColor: tint };

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        {
          backgroundColor: palette.backgroundColor,
          borderColor: palette.borderColor,
          opacity: disabled ? 0.6 : 1,
        },
        style,
      ]}>
      {typeof children === 'string' ? (
        <ThemedText style={[styles.buttonText, { color: palette.textColor }]}>{children}</ThemedText>
      ) : (
        children
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.pill,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: DesignTokens.spacing.xs,
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 14,
  },
});
