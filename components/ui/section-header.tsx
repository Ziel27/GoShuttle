import { ThemedText } from '@/components/themed-text';
import { DesignTokens } from '@/constants/theme';
import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  rightAction?: ReactNode;
  titleColor?: string;
  subtitleColor?: string;
};

export function SectionHeader({
  title,
  subtitle,
  rightAction,
  titleColor,
  subtitleColor,
}: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <ThemedText type="subtitle" style={[styles.title, titleColor ? { color: titleColor } : undefined]}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText
            type="caption"
            style={[styles.subtitle, subtitleColor ? { color: subtitleColor } : undefined]}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {rightAction}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: DesignTokens.spacing.sm,
  },
  copy: {
    flex: 1,
  },
  title: {
    lineHeight: 24,
  },
  subtitle: {
    opacity: 0.8,
  },
});
