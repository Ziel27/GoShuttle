import { ThemedText } from '@/components/themed-text';
import { PremiumButton } from '@/components/ui/premium-button';
import { PremiumCard } from '@/components/ui/premium-card';
import { SectionHeader } from '@/components/ui/section-header';
import { AppPalette } from '@/constants/app-ui';
import { DesignTokens } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { listPassengerRecentRides, PassengerRecentRide } from '@/services/trip';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type RideWindow = 'all' | '7d' | '30d';

const formatMoney = (value: number) => {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
};

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
  const onTint = useThemeColor({}, 'background');
  const activeChipBackground = colorScheme === 'dark' ? surfaceMutedColor : '#e2e8f0';
  const [rides, setRides] = useState<PassengerRecentRide[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [rideSearch, setRideSearch] = useState('');
  const [rideWindow, setRideWindow] = useState<RideWindow>('30d');
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
      <PremiumCard style={[styles.header, { backgroundColor: tint, borderColor: tint }]}>
        <SectionHeader
          title="Recent Rides"
          subtitle="Track your ride history and fare details"
          titleColor={onTint}
          subtitleColor={onTint}
          rightAction={
            <PremiumButton style={styles.refreshBtn} onPress={loadRides} variant="secondary">
              <Ionicons name="refresh" size={16} color={tint} />
              <ThemedText style={[styles.refreshText, { color: tint }]}>{loading ? 'Refreshing' : 'Refresh'}</ThemedText>
            </PremiumButton>
          }
        />
      </PremiumCard>

      <PremiumCard style={styles.filtersCard}>
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
      </PremiumCard>

      <ScrollView contentContainerStyle={styles.listWrap}>
        {loading ? (
          <PremiumCard style={styles.centerState} muted>
            <ActivityIndicator color={tint} size="small" />
            <ThemedText style={[styles.centerStateText, { color: mutedColor }]}>Loading recent rides...</ThemedText>
          </PremiumCard>
        ) : filteredRides.length === 0 ? (
          <PremiumCard style={styles.centerState} muted>
            <Ionicons name="trail-sign-outline" size={18} color={mutedColor} />
            <ThemedText style={[styles.centerStateText, { color: mutedColor }]}>No rides match your filters yet.</ThemedText>
          </PremiumCard>
        ) : (
          filteredRides.map((ride) => {
            const requestedTime = new Date(ride.requestedAt).toLocaleString();
            const boardedTime = new Date(ride.boardedAt).toLocaleString();
            const [lng, lat] = ride.pickupLocation.coordinates;

            return (
              <Pressable key={ride.rideId} onPress={() => setSelectedRide(ride)}>
                <PremiumCard style={styles.recentRideRow}>
                  <Ionicons name="time-outline" size={14} color={tint} />
                  <View style={styles.recentRideMeta}>
                    <ThemedText style={[styles.recentRidePrimary, { color: textColor }]}>
                      {ride.shuttle.plateNumber || 'Shuttle'}
                      {ride.shuttle.label ? ` - ${ride.shuttle.label}` : ''}
                    </ThemedText>
                    <ThemedText style={[styles.recentRideSecondary, { color: mutedColor }]}>Boarded: {boardedTime}</ThemedText>
                    <ThemedText style={[styles.recentRideSecondary, { color: mutedColor }]}>Requested: {requestedTime}</ThemedText>
                    <ThemedText style={[styles.recentRideSecondary, { color: mutedColor }]}> 
                      Fare: {ride.fareAtBoarding} · Pickup: {lat.toFixed(4)}, {lng.toFixed(4)}
                    </ThemedText>
                    <ThemedText style={[styles.recentRideHint, { color: tint }]}>Tap to view details</ThemedText>
                  </View>
                </PremiumCard>
              </Pressable>
            );
          })
        )}

        {feedback ? <ThemedText style={[styles.feedback, { color: mutedColor }]}>{feedback}</ThemedText> : null}
      </ScrollView>

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
                <Pressable onPress={() => setSelectedRide(null)} style={[styles.rideModalCloseBtn, { borderColor, backgroundColor: bgColor }]}>
                  <Ionicons name="close" size={16} color={tint} />
                </Pressable>
              </View>

              {selectedRide ? (
                <View style={styles.rideModalBody}>
                  <ThemedText style={[styles.rideModalLine, { color: mutedColor }]}> 
                    Shuttle: {selectedRide.shuttle.plateNumber || 'Shuttle'}
                    {selectedRide.shuttle.label ? ` - ${selectedRide.shuttle.label}` : ''}
                  </ThemedText>
                  <ThemedText style={[styles.rideModalLine, { color: mutedColor }]}> 
                    Boarded At: {new Date(selectedRide.boardedAt).toLocaleString()}
                  </ThemedText>
                  <ThemedText style={[styles.rideModalLine, { color: mutedColor }]}> 
                    Requested At: {new Date(selectedRide.requestedAt).toLocaleString()}
                  </ThemedText>
                  <ThemedText style={[styles.rideModalLine, { color: mutedColor }]}>Fare: {formatMoney(selectedRide.fareAtBoarding)}</ThemedText>
                  <ThemedText style={[styles.rideModalLine, { color: mutedColor }]}> 
                    Pickup: {selectedRide.pickupLocation.coordinates[1].toFixed(5)},{' '}
                    {selectedRide.pickupLocation.coordinates[0].toFixed(5)}
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
    padding: DesignTokens.spacing.sm,
    gap: DesignTokens.spacing.xs,
  },
  header: {
    minHeight: 80,
  },
  refreshBtn: {
    minHeight: 40,
    paddingHorizontal: DesignTokens.spacing.xs,
  },
  refreshText: {
    ...DesignTokens.typography.caption,
  },
  filtersCard: {
    gap: DesignTokens.spacing.xs,
  },
  rideSearchInput: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    minHeight: 44,
    paddingHorizontal: DesignTokens.spacing.xs,
    fontWeight: '600',
  },
  rideFilterRow: {
    flexDirection: 'row',
    gap: DesignTokens.spacing.xs,
  },
  rideFilterChip: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.pill,
    paddingHorizontal: DesignTokens.spacing.xs,
    paddingVertical: DesignTokens.spacing.xxs,
  },
  rideFilterChipActive: {
  },
  rideFilterText: {
    fontSize: DesignTokens.typography.overline.fontSize,
    fontWeight: '700',
  },
  rideFilterTextActive: {
  },
  listWrap: {
    paddingBottom: DesignTokens.spacing.md,
    gap: DesignTokens.spacing.xs,
  },
  recentRideRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: DesignTokens.spacing.xs,
  },
  recentRideMeta: {
    flex: 1,
    gap: 2,
  },
  recentRidePrimary: {
    fontWeight: '700',
    fontSize: 12,
  },
  recentRideSecondary: {
    fontSize: DesignTokens.typography.overline.fontSize,
  },
  recentRideHint: {
    fontSize: 10,
    fontWeight: '700',
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
    fontWeight: '600',
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
    padding: DesignTokens.spacing.sm,
    gap: DesignTokens.spacing.xs,
  },
  rideModalTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  rideModalCloseBtn: {
    minWidth: 30,
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 999,
  },
  rideModalBody: {
    gap: 6,
  },
  rideModalLine: {
    fontWeight: '600',
  },
});
