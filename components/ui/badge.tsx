/**
 * Badge — Semantic status indicator pill.
 *
 * Variants: success | warning | error | info | neutral
 * Sizes:    sm | md
 *
 * Usage:
 *   <Badge variant="success" label="Confirmed" icon="checkmark-circle" />
 *   <Badge variant="warning" label="Pending" size="sm" />
 */

import { Neutral, OutfitFonts, Radius, SemanticColors, Spacing } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';
type BadgeSize = 'sm' | 'md';

type BadgeProps = {
  /** The semantic color variant. */
  variant: BadgeVariant;
  /** Text displayed inside the badge. */
  label: string;
  /** Optional leading Ionicons icon name. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Badge size — sm (compact) or md (default). */
  size?: BadgeSize;
  /** Optional accessibility label override. */
  accessibilityLabel?: string;
};

const VARIANT_COLORS: Record<BadgeVariant, { bg: string; fg: string }> = {
  success: { bg: SemanticColors.successLight, fg: SemanticColors.success },
  warning: { bg: SemanticColors.warningLight, fg: SemanticColors.warning },
  error: { bg: SemanticColors.errorLight, fg: SemanticColors.error },
  info: { bg: SemanticColors.infoLight, fg: SemanticColors.info },
  neutral: { bg: Neutral[100], fg: Neutral[500] },
};

export function Badge({
  variant,
  label,
  icon,
  size = 'md',
  accessibilityLabel: a11yLabel,
}: BadgeProps) {
  const colors = VARIANT_COLORS[variant];
  const isSmall = size === 'sm';

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: colors.bg },
        isSmall && styles.badgeSm,
      ]}
      accessibilityLabel={a11yLabel || label}
      accessibilityRole="text"
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={isSmall ? 10 : 12}
          color={colors.fg}
        />
      ) : null}
      <Text
        style={[
          styles.label,
          { color: colors.fg },
          isSmall && styles.labelSm,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs + 1,
    borderRadius: Radius.pill,
    minHeight: 24,
  },
  badgeSm: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 3,
  },
  label: {
    fontFamily: OutfitFonts.bold,
    fontSize: 11,
    lineHeight: 16,
  },
  labelSm: {
    fontSize: 10,
    lineHeight: 13,
  },
});
