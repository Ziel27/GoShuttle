import { DesignTokens, OutfitFonts } from '@/constants/theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { forwardRef, useState } from 'react';
import { StyleProp, StyleSheet, TextInput, TextInputProps, TextStyle } from 'react-native';

type ThemedInputProps = TextInputProps & {
  style?: StyleProp<TextStyle>;
};

export const ThemedInput = forwardRef<TextInput, ThemedInputProps>(function ThemedInput(
  { style, placeholderTextColor, onFocus, onBlur, ...rest },
  ref
) {
  const [isFocused, setIsFocused] = useState(false);
  const tint = useThemeColor({}, 'tint');
  const border = useThemeColor({ light: '#C6D1DE', dark: '#394460' }, 'border');
  const surfaceMuted = useThemeColor({ light: '#F1F4F8', dark: '#20283C' }, 'surfaceMuted');
  const text = useThemeColor({}, 'text');
  const muted = useThemeColor({}, 'textMuted');

  return (
    <TextInput
      ref={ref}
      placeholderTextColor={placeholderTextColor || muted}
      onFocus={(event) => {
        setIsFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setIsFocused(false);
        onBlur?.(event);
      }}
      style={[
        styles.input,
        {
          borderColor: isFocused ? tint : border,
          color: text,
          backgroundColor: surfaceMuted,
        },
        isFocused && styles.inputFocused,
        style,
      ]}
      {...rest}
    />
  );
});

const styles = StyleSheet.create({
  input: {
    borderWidth: 1.5,
    borderRadius: DesignTokens.radius.md,
    minHeight: 52,
    paddingHorizontal: DesignTokens.spacing.md,
    fontSize: DesignTokens.typography.body.fontSize,
    fontFamily: OutfitFonts.regular,
  },
  inputFocused: {
    borderWidth: 2,
  },
});
