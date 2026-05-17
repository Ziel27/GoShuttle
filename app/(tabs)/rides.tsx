import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui/empty-state';
import { PremiumButton } from '@/components/ui/premium-button';
import { PremiumCard } from '@/components/ui/premium-card';
import { SectionHeader } from '@/components/ui/section-header';
import { SkeletonList } from '@/components/ui/skeleton-loader';
import { AppPalette, chipActiveBg } from '@/constants/app-ui';
import { DesignTokens, OutfitFonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { getCommunityById } from '@/services/community';
import { connectCommunitySocket } from '@/services/socket';
import { listPassengerRecentRides, PassengerRecentRide } from '@/services/trip';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { formatMoney } from '@/utils/format';
import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type RideWindow = 'all' | '7d' | '30d';

type RideLocationReference = {
  label: string;
  type: 'home' | 'fixed';
  coordinates: [number, number];
};

const EARTH_RADIUS_METERS = 6_371_000;

const toRadians = (value: number) => (value * Math.PI) / 180;

const getCoordinateDistanceMeters = (from: [number, number], to: [number, number]) => {
  const [fromLng, fromLat] = from;
  const [toLng, toLat] = to;

  if (![fromLng, fromLat, toLng, toLat].every((value) => Number.isFinite(value))) {
    return Number.POSITIVE_INFINITY;
  }

  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const lat1 = toRadians(fromLat);
  const lat2 = toRadians(toLat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
};

type RideItemCardProps = {
  ride: PassengerRecentRide;
  pickupLabel: string;
  destinationLabel: string;
  mutedColor: string;
  surfaceMutedColor: string;
  textColor: string;
  tint: string;
  onPress: (ride: PassengerRecentRide) => void;
};

const RideItemCard = memo(function RideItemCard({
  ride,
  pickupLabel,
  destinationLabel,
  mutedColor,
  surfaceMutedColor,
  textColor,
  tint,
  onPress,
}: RideItemCardProps) {
  const requestedTime = new Date(ride.requestedAt).toLocaleString();
  const boardedTime = new Date(ride.boardedAt).toLocaleString();

  return (
    <Pressable
      onPress={() => onPress(ride)}
      accessibilityRole="button"
      accessibilityLabel={`View ride on ${ride.shuttle.plateNumber}`}>
      <PremiumCard style={styles.recentRideRow}>
        <View style={[styles.recentRideIconWrap, { backgroundColor: surfaceMutedColor }]}>
          <Ionicons name="time-outline" size={20} color={tint} />
        </View>
        <View style={styles.recentRideMeta}>
          <ThemedText type="defaultSemiBold" style={{ color: textColor }}>
            {ride.shuttle.plateNumber || 'Shuttle'}
            {ride.shuttle.label ? ` · Electric ${ride.shuttle.label}` : ''}
          </ThemedText>
          {ride.isBookedForOthers && ride.passengerName ? (
            <ThemedText type="caption" style={{ color: tint }}>
              Booked for: {ride.passengerName}{ride.companionCount > 0 ? ` +${ride.companionCount} companion${ride.companionCount > 1 ? 's' : ''}` : ''}
            </ThemedText>
          ) : ride.companionCount > 0 ? (
            <ThemedText type="caption" style={{ color: tint }}>
              +{ride.companionCount} companion{ride.companionCount > 1 ? 's' : ''}
            </ThemedText>
          ) : null}
          <ThemedText type="caption" style={{ color: mutedColor }}>
            Boarded: {boardedTime}
          </ThemedText>
          <ThemedText type="caption" style={{ color: mutedColor }}>
            Requested: {requestedTime}
          </ThemedText>
          <ThemedText type="caption" style={{ color: mutedColor }}>
            Fare: {formatMoney(ride.fareAtBoarding)} · Pickup: {pickupLabel}
          </ThemedText>
          <ThemedText type="caption" style={{ color: mutedColor }}>
            Destination: {destinationLabel}
          </ThemedText>
          <ThemedText type="overline" style={{ color: tint, marginTop: 4 }}>
            Tap to view details
          </ThemedText>
        </View>
      </PremiumCard>
    </Pressable>
  );
});



export default function RidesScreen() {
  const user = useAuthStore((state) => state.user);
  const quietMode = usePreferencesStore((state) => state.quietMode);
  const serviceUpdates = usePreferencesStore((state) => state.serviceUpdates);
  const colorScheme = useColorScheme();
  const tint = useThemeColor({}, 'tint');
  const textColor = useThemeColor({}, 'text');
  const mutedColor = useThemeColor({}, 'textMuted');
  const bgColor = useThemeColor({}, 'background');
  const surfaceColor = useThemeColor({}, 'surface');
  const surfaceMutedColor = useThemeColor({}, 'surfaceMuted');
  const borderColor = useThemeColor({}, 'border');
  const activeChipBackground = chipActiveBg[colorScheme ?? 'light'];
  const [rides, setRides] = useState<PassengerRecentRide[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [rideSearch, setRideSearch] = useState('');
  const [rideWindow, setRideWindow] = useState<RideWindow>('30d');
  const [fixedDestinationReferences, setFixedDestinationReferences] = useState<RideLocationReference[]>([]);
  const [selectedRide, setSelectedRide] = useState<PassengerRecentRide | null>(null);

  const setPreferenceAwareFeedback = useCallback((
    message: string,
    channel: 'service' | 'critical' = 'service'
  ) => {
    if (channel === 'critical') {
      setFeedback(message);
      return;
    }

    if (quietMode || !serviceUpdates) return;
    setFeedback(message);
  }, [quietMode, serviceUpdates]);

  const loadRides = useCallback(async () => {
    if (user?.role !== 'passenger') return;

    setLoading(true);
    if (!quietMode && serviceUpdates) {
      setFeedback('');
    }
    try {
      const items = await listPassengerRecentRides();
      setRides(items);
      setPreferenceAwareFeedback('Recent rides refreshed.', 'service');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load recent rides.';
      setPreferenceAwareFeedback(message, 'critical');
    } finally {
      setLoading(false);
    }
  }, [quietMode, serviceUpdates, setPreferenceAwareFeedback, user?.role]);

  useEffect(() => {
    loadRides();
  }, [loadRides]);

  useEffect(() => {
    if (user?.role !== 'passenger' || !user?.communityId) return;
    const token = useAuthStore.getState().token;
    const socket = connectCommunitySocket(user.communityId, token);
    const onPassengerUnboard = (payload: any) => {
      // If rideIds present, refresh recent rides so history updates immediately
      if (payload?.rideIds && Array.isArray(payload.rideIds) && payload.rideIds.length > 0) {
        void loadRides();
      }
    };
    const refreshRecentRides = () => {
      void loadRides();
    };

    socket.on('dispatch:passenger-assigned', refreshRecentRides);
    socket.on('trip:pickup-claimed', refreshRecentRides);
    socket.on('trip:passenger-boarded', refreshRecentRides);
    socket.on('trip:passenger-unboarded', onPassengerUnboard);
    socket.on('trip:passenger-auto-unboarded', onPassengerUnboard);

    return () => {
      socket.off('dispatch:passenger-assigned', refreshRecentRides);
      socket.off('trip:pickup-claimed', refreshRecentRides);
      socket.off('trip:passenger-boarded', refreshRecentRides);
      socket.off('trip:passenger-unboarded', onPassengerUnboard);
      socket.off('trip:passenger-auto-unboarded', onPassengerUnboard);
      socket.disconnect?.();
    };
  }, [user?.communityId, user?.role, loadRides]);

  useEffect(() => {
    if (user?.role !== 'passenger' || !user?.communityId) {
      setFixedDestinationReferences([]);
      return;
    }

    let active = true;

    const loadFixedDestinations = async () => {
      try {
        const community = await getCommunityById(user.communityId);
        if (!active) return;

        const nextReferences = (community?.fixedDestinations || [])
          .filter((destination) => destination.isActive !== false)
          .filter((destination) => destination.location?.coordinates?.length === 2)
          .map((destination) => ({
            label: destination.name,
            type: 'fixed' as const,
            coordinates: destination.location.coordinates,
          }));

        setFixedDestinationReferences(nextReferences);
      } catch {
        if (!active) return;
        setFixedDestinationReferences([]);
      }
    };

    void loadFixedDestinations();

    return () => {
      active = false;
    };
  }, [user?.communityId, user?.role]);

  const rideLocationReferences = useMemo(() => {
    const references: RideLocationReference[] = [...fixedDestinationReferences];
    const homeCoordinates = user?.homeDestination?.location?.coordinates;

    if (homeCoordinates?.length === 2) {
      references.unshift({
        label: user?.homeDestination?.label?.trim() || 'Saved Home Address',
        type: 'home',
        coordinates: homeCoordinates,
      });
    }

    return references;
  }, [fixedDestinationReferences, user?.homeDestination?.label, user?.homeDestination?.location?.coordinates]);

  const resolvePickupLabel = useCallback((ride: PassengerRecentRide) => {
    const pickupCoordinates = ride.pickupLocation?.coordinates;

    if (pickupCoordinates?.length !== 2) {
      return user?.homeDestination?.label?.trim() || 'Saved Home Address';
    }

    if (rideLocationReferences.length === 0) {
      return ride.destinationType === 'home'
        ? user?.homeDestination?.label?.trim() || 'Saved Home Address'
        : 'Fixed Destination';
    }

    let nearestReference = rideLocationReferences[0];
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const reference of rideLocationReferences) {
      const distance = getCoordinateDistanceMeters(pickupCoordinates, reference.coordinates);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestReference = reference;
      }
    }

    return nearestReference.label;
  }, [rideLocationReferences, user?.homeDestination?.label]);

  const resolveDestinationLabel = useCallback((ride: PassengerRecentRide) => {
    if (ride.destinationType === 'home') {
      return user?.homeDestination?.label?.trim() || ride.destinationLabel || 'Saved Home Address';
    }

    return ride.destinationLabel || 'Fixed Destination';
  }, [user?.homeDestination?.label]);

  const selectedRidePickupLabel = useMemo(() => {
    if (!selectedRide) return '';
    return resolvePickupLabel(selectedRide);
  }, [resolvePickupLabel, selectedRide]);

  const selectedRideDestinationLabel = useMemo(() => {
    if (!selectedRide) return '';
    return resolveDestinationLabel(selectedRide);
  }, [resolveDestinationLabel, selectedRide]);

  const filteredRides = useMemo(() => {
    const now = Date.now();

    return rides.filter((ride) => {
      const boardedAt = new Date(ride.boardedAt).getTime();
      const isWithinWindow =
        rideWindow === 'all'
          ? true
          : rideWindow === '7d'
          ? now - boardedAt <= 7 * 24 * 60 * 60 * 1000
          : now - boardedAt <= 30 * 24 * 60 * 60 * 1000;

      const query = rideSearch.trim().toLowerCase();
      if (!query) return isWithinWindow;

      const target = [
        ride.shuttle.plateNumber,
        ride.shuttle.label,
        new Date(ride.boardedAt).toLocaleString(),
        new Date(ride.requestedAt).toLocaleString(),
      ]
        .join(' ')
        .toLowerCase();

      return isWithinWindow && target.includes(query);
    });
  }, [rides, rideSearch, rideWindow]);

  const handleSelectRide = useCallback((ride: PassengerRecentRide) => {
    setSelectedRide(ride);
  }, []);

  const renderRideItem = useCallback(
    ({ item: ride }: { item: PassengerRecentRide }) => {
      const pickupLabel = resolvePickupLabel(ride);
      const destinationLabel = resolveDestinationLabel(ride);

      return (
        <RideItemCard
          ride={ride}
          pickupLabel={pickupLabel}
          destinationLabel={destinationLabel}
          mutedColor={mutedColor}
          surfaceMutedColor={surfaceMutedColor}
          textColor={textColor}
          tint={tint}
          onPress={handleSelectRide}
        />
      );
    },
    [handleSelectRide, mutedColor, resolveDestinationLabel, resolvePickupLabel, surfaceMutedColor, textColor, tint]
  );

  if (user?.role !== 'passenger') {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
        <PremiumCard style={styles.centerState} muted>
          <Ionicons name="information-circle-outline" size={18} color={mutedColor} />
          <ThemedText style={[styles.centerStateText, { color: mutedColor }]}>Recent rides are available for passengers.</ThemedText>
        </PremiumCard>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bgColor }]} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { borderBottomColor: borderColor }]}>
        <SectionHeader
          title="Activity History"
          subtitle="Track your ride history and fare details"
          titleColor={textColor}
          subtitleColor={mutedColor}
          rightAction={
            <PremiumButton style={styles.refreshBtn} onPress={loadRides} variant="secondary">
              <Ionicons name="refresh" size={18} color={tint} />
              <ThemedText type="defaultSemiBold" style={{ color: tint }}>
                {loading ? 'Refreshing' : 'Refresh'}
              </ThemedText>
            </PremiumButton>
          }
        />
      </View>

      <View style={[styles.filtersCard, { borderColor }]}>
        <TextInput
          value={rideSearch}
          onChangeText={setRideSearch}
          placeholder="Search by shuttle or date"
          placeholderTextColor={mutedColor}
          style={[styles.rideSearchInput, { color: textColor, borderColor, backgroundColor: surfaceColor }]}
        />

        <View style={styles.rideFilterRow}>
          <Pressable
            style={[
              styles.rideFilterChip,
              { borderColor, backgroundColor: surfaceColor },
              rideWindow === '7d' && [styles.rideFilterChipActive, { borderColor: tint, backgroundColor: activeChipBackground }],
            ]}
            onPress={() => setRideWindow('7d')}
            accessibilityRole="button"
            accessibilityState={{ selected: rideWindow === '7d' }}
            accessibilityLabel="Filter to last 7 days"
          >
            <ThemedText
              style={[
                styles.rideFilterText,
                { color: mutedColor },
                rideWindow === '7d' && [styles.rideFilterTextActive, { color: tint }],
              ]}>
              Last 7d
            </ThemedText>
          </Pressable>
          <Pressable
            style={[
              styles.rideFilterChip,
              { borderColor, backgroundColor: surfaceColor },
              rideWindow === '30d' && [styles.rideFilterChipActive, { borderColor: tint, backgroundColor: activeChipBackground }],
            ]}
            onPress={() => setRideWindow('30d')}
            accessibilityRole="button"
            accessibilityState={{ selected: rideWindow === '30d' }}
            accessibilityLabel="Filter to last 30 days"
          >
            <ThemedText
              style={[
                styles.rideFilterText,
                { color: mutedColor },
                rideWindow === '30d' && [styles.rideFilterTextActive, { color: tint }],
              ]}>
              Last 30d
            </ThemedText>
          </Pressable>
          <Pressable
            style={[
              styles.rideFilterChip,
              { borderColor, backgroundColor: surfaceColor },
              rideWindow === 'all' && [styles.rideFilterChipActive, { borderColor: tint, backgroundColor: activeChipBackground }],
            ]}
            onPress={() => setRideWindow('all')}
            accessibilityRole="button"
            accessibilityState={{ selected: rideWindow === 'all' }}
            accessibilityLabel="Show all rides"
          >
            <ThemedText
              style={[
                styles.rideFilterText,
                { color: mutedColor },
                rideWindow === 'all' && [styles.rideFilterTextActive, { color: tint }],
              ]}>
              All
            </ThemedText>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={filteredRides}
        keyExtractor={(ride) => ride.rideId}
        contentContainerStyle={styles.listWrap}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        refreshing={loading}
        onRefresh={loadRides}
        ListEmptyComponent={
          loading ? (
            <SkeletonList count={3} />
          ) : (
            <EmptyState
              icon="trail-sign-outline"
              title="No rides found"
              subtitle="No rides match your current filters. Try a different time range or search term."
            />
          )
        }
        ListFooterComponent={
          feedback ? <ThemedText style={[styles.feedback, { color: mutedColor }]}>{feedback}</ThemedText> : null
        }
        renderItem={renderRideItem}
      />

      <Modal
        visible={Boolean(selectedRide)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedRide(null)}
      >
        <SafeAreaView style={styles.rideModalSafeArea} edges={['top', 'bottom', 'left', 'right']}>
          <View style={styles.rideModalBackdrop}>
            <View style={[styles.rideModalCard, { backgroundColor: surfaceColor, borderColor }]}> 
              <View style={styles.rowBetween}>
                <ThemedText style={[styles.rideModalTitle, { color: textColor }]}>Ride Detail</ThemedText>
                <Pressable
                  onPress={() => setSelectedRide(null)}
                  style={[styles.rideModalCloseBtn, { borderColor, backgroundColor: bgColor }]}
                  accessibilityLabel="Close ride details"
                  accessibilityRole="button"
                >
                  <Ionicons name="close" size={16} color={tint} />
                </Pressable>
              </View>

              {selectedRide ? (
                <View style={styles.rideModalBody}>
                  <ThemedText style={[styles.rideModalLine, { color: mutedColor }]}> 
                    Shuttle: {selectedRide.shuttle.plateNumber || 'Shuttle'}
                    {selectedRide.shuttle.label ? ` · Electric ${selectedRide.shuttle.label}` : ''}
                  </ThemedText>
                  {selectedRide.isBookedForOthers && selectedRide.passengerName ? (
                    <ThemedText style={[styles.rideModalLine, { color: tint }]}>
                      Booked for: {selectedRide.passengerName}{selectedRide.companionCount > 0 ? ` +${selectedRide.companionCount} companion${selectedRide.companionCount > 1 ? 's' : ''}` : ''}
                    </ThemedText>
                  ) : selectedRide.companionCount > 0 ? (
                    <ThemedText style={[styles.rideModalLine, { color: tint }]}>
                      +{selectedRide.companionCount} companion{selectedRide.companionCount > 1 ? 's' : ''}
                    </ThemedText>
                  ) : null}
                  <ThemedText style={[styles.rideModalLine, { color: mutedColor }]}> 
                    Boarded At: {new Date(selectedRide.boardedAt).toLocaleString()}
                  </ThemedText>
                  <ThemedText style={[styles.rideModalLine, { color: mutedColor }]}> 
                    Requested At: {new Date(selectedRide.requestedAt).toLocaleString()}
                  </ThemedText>
                  <ThemedText style={[styles.rideModalLine, { color: mutedColor }]}>Fare: {formatMoney(selectedRide.fareAtBoarding)}</ThemedText>
                  <ThemedText style={[styles.rideModalLine, { color: mutedColor }]}> 
                    Pickup: {selectedRidePickupLabel}
                  </ThemedText>
                  <ThemedText style={[styles.rideModalLine, { color: mutedColor }]}> 
                    Destination: {selectedRideDestinationLabel}
                  </ThemedText>
                </View>
              ) : null}
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    padding: DesignTokens.spacing.md,
    gap: DesignTokens.spacing.sm,
  },
  header: {
    minHeight: 68,
    justifyContent: 'center',
    paddingBottom: DesignTokens.spacing.xs,
    borderBottomWidth: 1,
  },
  refreshBtn: {
    minHeight: 42,
    paddingVertical: DesignTokens.spacing.xxs,
    paddingHorizontal: DesignTokens.spacing.xs,
    alignSelf: 'center',
  },
  filtersCard: {
    gap: DesignTokens.spacing.xs,
    paddingBottom: DesignTokens.spacing.xs,
    borderBottomWidth: 1,
  },
  rideSearchInput: {
    borderWidth: 1.5,
    borderRadius: DesignTokens.radius.md,
    minHeight: 52,
    paddingHorizontal: DesignTokens.spacing.md,
    fontFamily: OutfitFonts.semiBold,
  },
  rideFilterRow: {
    flexDirection: 'row',
    gap: DesignTokens.spacing.xs,
  },
  rideFilterChip: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.pill,
    minHeight: 38,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rideFilterChipActive: {
  },
  rideFilterText: {
    fontSize: DesignTokens.typography.overline.fontSize,
    fontFamily: OutfitFonts.bold,
  },
  rideFilterTextActive: {
  },
  listWrap: {
    paddingBottom: DesignTokens.spacing.lg,
    gap: DesignTokens.spacing.sm,
  },
  recentRideRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: DesignTokens.spacing.sm,
    minHeight: 96,
  },
  recentRideIconWrap: {
    width: 44,
    height: 44,
    borderRadius: DesignTokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentRideMeta: {
    flex: 1,
    gap: 2,
  },
  recentRideHint: {
    fontSize: 10,
    fontFamily: OutfitFonts.bold,
    marginTop: 2,
  },
  centerState: {
    minHeight: 80,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: DesignTokens.spacing.xs,
    paddingHorizontal: DesignTokens.spacing.sm,
  },
  centerStateText: {
    fontFamily: OutfitFonts.semiBold,
  },
  feedback: {
    ...DesignTokens.typography.caption,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rideModalBackdrop: {
    flex: 1,
    backgroundColor: AppPalette.darkOverlaySoft,
    alignItems: 'center',
    justifyContent: 'center',
    padding: DesignTokens.spacing.lg,
  },
  rideModalSafeArea: {
    flex: 1,
  },
  rideModalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: DesignTokens.radius.lg,
    borderWidth: 1,
    padding: DesignTokens.spacing.md,
    gap: DesignTokens.spacing.xs,
  },
  rideModalTitle: {
    fontSize: 16,
    fontFamily: OutfitFonts.extraBold,
  },
  rideModalCloseBtn: {
    minWidth: 30,
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: DesignTokens.radius.pill,
  },
  rideModalBody: {
    gap: 6,
  },
  rideModalLine: {
    fontFamily: OutfitFonts.semiBold,
  },
});
