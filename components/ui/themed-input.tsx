import { DesignTokens } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { forwardRef } from 'react';
import { StyleProp, StyleSheet, TextInput, TextInputProps, TextStyle } from 'react-native';

type ThemedInputProps = TextInputProps & {
  style?: StyleProp<TextStyle>;
};

export const ThemedInput = forwardRef<TextInput, ThemedInputProps>(function ThemedInput(
  { style, placeholderTextColor, ...rest },
  ref
) {
  const border = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'textMuted');

  return (
    <TextInput
      ref={ref}
      placeholderTextColor={placeholderTextColor || muted}
      style={[
        styles.input,
        {
          borderColor: border,
          color: text,
          backgroundColor: surface,
        },
        style,
      ]}
      {...rest}
    />
  );
});

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    minHeight: 50,
    paddingHorizontal: DesignTokens.spacing.sm,
    fontSize: 15,
  },
});
