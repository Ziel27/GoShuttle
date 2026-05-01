import { ThemedText } from '@/components/themed-text';
import { AppPalette } from '@/constants/app-ui';
import { DesignTokens, OutfitFonts } from '@/constants/theme';
import { Shuttle } from '@/services/shuttle';
import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

export type FixedDestinationOption = {
  _id: string;
  name: string;
  location: { type: 'Point'; coordinates: [number, number] };
  pickupRadiusMeters?: number;
  isActive?: boolean;
  color?: string;
};

type FixedDestinationChipProps = {
  item: FixedDestinationOption;
  selected: boolean;
  borderColor: string;
  bgColor: string;
  textColor: string;
  tint: string;
  onSelect: (destinationId: string) => void;
};

type PassengerFleetRowProps = {
  item: Shuttle;
  borderColor: string;
  surfaceColor: string;
  textColor: string;
  mutedColor: string;
  tint: string;
  successColor: string;
  showEta: boolean;
  getShuttleDriverStatus: (driverId: Shuttle['driverId']) => string;
};

/**
 * Selectable destination chip used in passenger booking controls.
 */
export const FixedDestinationChip = memo(function FixedDestinationChip({
  item,
  selected,
  borderColor,
  bgColor,
  textColor,
  tint,
  onSelect,
}: FixedDestinationChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Select destination ${item.name}`}
      accessibilityHint="Double tap to set pickup destination"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.destinationChip,
        {
          borderColor: selected ? tint : borderColor,
          backgroundColor: selected ? tint : bgColor,
          shadowColor: selected ? tint : AppPalette.navy,
          shadowOpacity: selected ? 0.24 : 0.08,
          shadowOffset: { width: 0, height: selected ? 4 : 2 },
          shadowRadius: selected ? 8 : 4,
          elevation: selected ? 3 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
          opacity: pressed ? 0.95 : 1,
        },
      ]}
      onPress={() => onSelect(item._id)}>
      <View style={styles.destinationChipLead}>
        <Ionicons
          name={selected ? 'checkmark-circle' : 'location-outline'}
          size={16}
          color={selected ? AppPalette.white : tint}
        />
        <ThemedText style={[styles.destinationChipText, { color: selected ? AppPalette.white : textColor }]}>
          {item.name}
        </ThemedText>
      </View>
      <Ionicons
        name="chevron-forward"
        size={14}
        color={selected ? AppPalette.white : tint}
        style={styles.destinationChipChevron}
      />
    </Pressable>
  );
});

/**
 * Fleet row item showing shuttle capacity and driver on-shift state.
 */
export const PassengerFleetRow = memo(function PassengerFleetRow({
  item,
  borderColor,
  surfaceColor,
  textColor,
  mutedColor,
  tint,
  successColor,
  showEta,
  getShuttleDriverStatus,
}: PassengerFleetRowProps) {
  const isOnShift = getShuttleDriverStatus(item.driverId) === 'driving';

  return (
    <View style={[styles.shuttleRow, { borderColor, backgroundColor: surfaceColor }]}>
      <Ionicons name="bus-outline" size={16} color={tint} />
      <View style={styles.shuttleTextWrap}>
        <ThemedText style={[styles.shuttleRowText, { color: textColor }]}>
          {item.plateNumber} · {item.currentCapacity}/{item.maxCapacity}
        </ThemedText>
        <View style={styles.shuttleStatusRow}>
          <View
            style={[
              styles.shuttleStatusDot,
              {
                backgroundColor: isOnShift ? successColor : mutedColor,
              },
            ]}
          />
          <ThemedText style={[styles.shuttleEtaText, { color: mutedColor }]}>
            {isOnShift ? 'On Shift' : 'Not on shift'}
          </ThemedText>
        </View>
        {showEta ? (
          <ThemedText style={[styles.shuttleEtaText, { color: mutedColor }]}>ETA: live tracking</ThemedText>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  destinationChip: {
    flex: 1,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingVertical: DesignTokens.spacing.xs,
    paddingHorizontal: DesignTokens.spacing.md,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  destinationChipLead: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
  },
  destinationChipText: {
    fontFamily: OutfitFonts.bold,
    fontSize: 13,
    flexShrink: 1,
  },
  destinationChipChevron: {
    marginLeft: DesignTokens.spacing.xs,
  },
  shuttleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    minHeight: 56,
  },
  shuttleTextWrap: {
    flex: 1,
  },
  shuttleRowText: {
    fontFamily: OutfitFonts.bold,
  },
  shuttleEtaText: {
    marginTop: 2,
    fontSize: 11,
    fontFamily: OutfitFonts.semiBold,
  },
  shuttleStatusRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xxs,
  },
  shuttleStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
