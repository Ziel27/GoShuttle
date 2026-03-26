import { ThemedText } from '@/components/themed-text';
import { PremiumButton } from '@/components/ui/premium-button';
import { PremiumCard } from '@/components/ui/premium-card';
import { SectionHeader } from '@/components/ui/section-header';
import { AppPalette, getCapacityColor } from '@/constants/app-ui';
import { DesignTokens } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { getCommunityById } from '@/services/community';
import { toLatLngPoint } from '@/services/map-types';
import {
    addOfflineBoarding,
    getOfflineBoardings,
    setOfflineBoardings,
} from '@/services/offline-boarding-queue';
import {
    listShuttles,
    Shuttle,
    updateShuttleLocation,
} from '@/services/shuttle';
import { connectCommunitySocket, getSocket } from '@/services/socket';
import {
    boardPassenger,
    createPickupIntent,
    endShift,
    PickupIntent,
    ShiftSummary,
} from '@/services/trip';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import MapView, { Circle, LatLng, Marker, Polygon, Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

const PICKUP_COOLDOWN_MS = 45_000;

const capacityBadgeColor = getCapacityColor;

const palette = {
  navy: AppPalette.navy,
  emerald: AppPalette.success,
  slateBg: AppPalette.slateBg,
  slateBorder: AppPalette.slateBorder,
  slateText: AppPalette.slateText,
  white: AppPalette.white,
  rose: AppPalette.danger,
};

const toShuttleCoordinate = (shuttle: Shuttle): LatLng | null => {
  return toLatLngPoint(shuttle.location?.coordinates || []);
};

const toRegionFromBoundary = (coordinates: LatLng[]): Region | null => {
  if (coordinates.length < 3) return null;

  const lats = coordinates.map((point) => point.latitude);
  const lngs = coordinates.map((point) => point.longitude);

  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const latitudeDelta = Math.max((maxLat - minLat) * 1.4, 0.005);
  const longitudeDelta = Math.max((maxLng - minLng) * 1.4, 0.005);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta,
    longitudeDelta,
  };
};

type PickupIntentEventPayload = {
  requestId?: string;
  _id?: string;
  passengerId?: string;
  location?: {
    type?: 'Point';
    coordinates?: [number, number];
  };
  status?: PickupIntent['status'];
  expiresAt?: string;
};

const toPickupIntent = (payload: PickupIntentEventPayload): PickupIntent | null => {
  const id = payload._id || payload.requestId;
  const coordinates = payload.location?.coordinates;

  if (!coordinates || coordinates.length !== 2) {
    return null;
  }

  const [longitude, latitude] = coordinates;

  const point = toLatLngPoint([longitude, latitude]);
  if (!id || !point) {
    return null;
  }

  return {
    _id: id,
    communityId: '',
    passengerId: payload.passengerId || '',
    location: {
      type: 'Point',
      coordinates: [point.longitude, point.latitude],
    },
    status: payload.status || 'pending',
    expiresAt: payload.expiresAt || new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };
};

const isExpiredIntent = (intent: PickupIntent) => new Date(intent.expiresAt).getTime() <= Date.now();

const upsertPickupIntent = (items: PickupIntent[], nextItem: PickupIntent) => {
  const withoutExisting = items.filter((item) => item._id !== nextItem._id && !isExpiredIntent(item));
  return [nextItem, ...withoutExisting];
};

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

const formatSeconds = (totalSeconds: number) => {
  const safe = Math.max(0, totalSeconds);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);
  const logout = useAuthStore((state) => state.logout);
  const bgColor = useThemeColor({}, 'background');
  const surfaceColor = useThemeColor({}, 'surface');
  const borderColor = useThemeColor({}, 'border');
  const textColor = useThemeColor({}, 'text');
  const mutedColor = useThemeColor({}, 'textMuted');
  const tint = useThemeColor({}, 'tint');
  const successColor = useThemeColor({}, 'success');
  const pickupCtaBg = colorScheme === 'dark' ? successColor : tint;
  const hapticsEnabled = usePreferencesStore((state) => state.hapticsEnabled);
  const compactMapPins = usePreferencesStore((state) => state.compactMapPins);
  const showEta = usePreferencesStore((state) => state.showEta);
  const precisePickup = usePreferencesStore((state) => state.precisePickup);
  const quietMode = usePreferencesStore((state) => state.quietMode);
  const pushAlerts = usePreferencesStore((state) => state.pushAlerts);
  const serviceUpdates = usePreferencesStore((state) => state.serviceUpdates);
  const [shuttles, setShuttles] = useState<Shuttle[]>([]);
  const [feedback, setFeedback] = useState('');
  const [lastSummary, setLastSummary] = useState<ShiftSummary | null>(null);
  const [queuedBoardings, setQueuedBoardings] = useState(0);
  const [communityBoundary, setCommunityBoundary] = useState<LatLng[]>([]);
  const [passengerRegion, setPassengerRegion] = useState<Region | null>(null);
  const [pickupIntents, setPickupIntents] = useState<PickupIntent[]>([]);
  const [pickupSubmitting, setPickupSubmitting] = useState(false);
  const [pickupCooldownUntil, setPickupCooldownUntil] = useState<number | null>(null);
  const [nowTs, setNowTs] = useState(Date.now());
  const [markerCoordinates, setMarkerCoordinates] = useState<Record<string, LatLng>>({});
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<MapView | null>(null);
  const markerRefs = useRef<Record<string, any>>({});
  const previousMarkerCoords = useRef<Record<string, LatLng>>({});
  const markerAnimTimers = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});

  const assignedShuttle = useMemo(() => {
    if (!user) return null;
    if (user.role !== 'driver') return null;
    return shuttles.find((item) => item.driverId === user._id) || null;
  }, [shuttles, user]);

  const activePassengerPickupIntents = useMemo(() => {
    const myId = user?._id;
    if (!myId) return [];

    return pickupIntents
      .filter((item) => item.passengerId === myId && item.status === 'pending' && !isExpiredIntent(item))
      .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
  }, [pickupIntents, user?._id]);

  const pickupCooldownRemainingMs = pickupCooldownUntil ? Math.max(0, pickupCooldownUntil - nowTs) : 0;
  const pickupDisabled = pickupSubmitting || pickupCooldownRemainingMs > 0 || activePassengerPickupIntents.length > 0;

  const passengerFleet = useMemo(() => {
    return [...shuttles].sort((a, b) => {
      const ratioA = a.maxCapacity > 0 ? a.currentCapacity / a.maxCapacity : 0;
      const ratioB = b.maxCapacity > 0 ? b.currentCapacity / b.maxCapacity : 0;
      return ratioA - ratioB;
    });
  }, [shuttles]);

  const mapShuttles = useMemo(() => {
    if (!compactMapPins) return shuttles;
    return passengerFleet.slice(0, 6);
  }, [compactMapPins, passengerFleet, shuttles]);

  const passengerStats = useMemo(() => {
    const availableSeats = shuttles.reduce(
      (sum, item) => sum + Math.max(0, item.maxCapacity - item.currentCapacity),
      0
    );
    const fullCount = shuttles.filter((item) => item.currentCapacity >= item.maxCapacity).length;

    return {
      availableSeats,
      fullCount,
    };
  }, [shuttles]);

  const setPreferenceAwareFeedback = useCallback((
    message: string,
    channel: 'ride' | 'service' | 'critical' = 'ride'
  ) => {
    if (channel === 'critical') {
      setFeedback(message);
      return;
    }

    if (quietMode) return;
    if (channel === 'ride' && !pushAlerts) return;
    if (channel === 'service' && !serviceUpdates) return;

    setFeedback(message);
  }, [pushAlerts, quietMode, serviceUpdates]);

  const loadShuttles = useCallback(async () => {
    try {
      const items = await listShuttles();
      setShuttles(items);
      setPreferenceAwareFeedback('Fleet refreshed.', 'service');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch shuttles.';
      setPreferenceAwareFeedback(message, 'critical');
    }
  }, [setPreferenceAwareFeedback]);

  useEffect(() => {
    if (!user?.communityId) return;

    loadShuttles();
    getOfflineBoardings().then((items) => setQueuedBoardings(items.length));
    const socket = connectCommunitySocket(user.communityId, token);

    const onLocationUpdated = (payload: { shuttleId: string } & Partial<Shuttle>) => {
      setShuttles((current) =>
        current.map((item) =>
          item._id === payload.shuttleId ? { ...item, ...payload } as Shuttle : item
        )
      );
    };

    const onCapacityUpdated = (payload: {
      shuttleId: string;
      currentCapacity?: number;
      capacityStatus?: Shuttle['capacityStatus'];
      maxCapacity?: number;
    }) => {
      setShuttles((current) =>
        current.map((item) =>
          item._id === payload.shuttleId
            ? {
                ...item,
                currentCapacity: payload.currentCapacity ?? item.currentCapacity,
                maxCapacity: payload.maxCapacity ?? item.maxCapacity,
                capacityStatus: payload.capacityStatus ?? item.capacityStatus,
              }
            : item
        )
      );
    };

    const onPickupIntent = (payload: PickupIntentEventPayload) => {
      const intent = toPickupIntent(payload);
      if (!intent || intent.status !== 'pending' || isExpiredIntent(intent)) return;
      setPickupIntents((items) => upsertPickupIntent(items, intent));
    };

    socket.on('shuttle:location-updated', onLocationUpdated);
    socket.on('shuttle:capacity-updated', onCapacityUpdated);
    socket.on('trip:pickup-intent', onPickupIntent);

    return () => {
      socket.off('shuttle:location-updated', onLocationUpdated);
      socket.off('shuttle:capacity-updated', onCapacityUpdated);
      socket.off('trip:pickup-intent', onPickupIntent);
    };
  }, [loadShuttles, token, user?.communityId]);

  useEffect(() => {
    if (!user?.communityId || user.role !== 'passenger') return;

    let active = true;

    const loadCommunityBoundary = async () => {
      try {
        const community = await getCommunityById(user.communityId);
        const ring = community?.boundaries?.coordinates?.[0] || [];

        const normalized = ring
          .map((point) => {
            const [longitude, latitude] = point;
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
            return { latitude, longitude };
          })
          .filter((point): point is LatLng => point !== null);

        if (!active) return;

        setCommunityBoundary(normalized);
        setPassengerRegion(toRegionFromBoundary(normalized));
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Failed to load community boundary.';
        setPreferenceAwareFeedback(message, 'critical');
      }
    };

    loadCommunityBoundary();

    return () => {
      active = false;
    };
  }, [setPreferenceAwareFeedback, user?.communityId, user?.role]);

  useEffect(() => {
    if (user?.role !== 'passenger') return;

    const timeoutMs = 90;
    const stepCount = 8;
    const activeIds = new Set<string>();
    const nextCoordinates: Record<string, LatLng> = {};
    const previousIds = Object.keys(previousMarkerCoords.current);

    for (const shuttle of mapShuttles) {
      const coordinate = toShuttleCoordinate(shuttle);
      if (!coordinate) continue;

      activeIds.add(shuttle._id);
      nextCoordinates[shuttle._id] = coordinate;
      const previous = previousMarkerCoords.current[shuttle._id];

      if (!previous) {
        continue;
      }

      if (Platform.OS === 'android') {
        markerRefs.current[shuttle._id]?.animateMarkerToCoordinate(coordinate, 800);
      } else if (
        previous.latitude !== coordinate.latitude ||
        previous.longitude !== coordinate.longitude
      ) {
        if (markerAnimTimers.current[shuttle._id]) {
          clearTimeout(markerAnimTimers.current[shuttle._id]!);
        }

        let step = 0;
        const animateStep = () => {
          step += 1;
          const t = Math.min(step / stepCount, 1);
          setMarkerCoordinates((current) => ({
            ...current,
            [shuttle._id]: {
              latitude: lerp(previous.latitude, coordinate.latitude, t),
              longitude: lerp(previous.longitude, coordinate.longitude, t),
            },
          }));

          if (t < 1) {
            markerAnimTimers.current[shuttle._id] = setTimeout(animateStep, timeoutMs);
          }
        };

        markerAnimTimers.current[shuttle._id] = setTimeout(animateStep, timeoutMs);
      }
    }

    previousMarkerCoords.current = nextCoordinates;

    setMarkerCoordinates((current) => {
      const next: Record<string, LatLng> = {};

      for (const shuttleId of Object.keys(nextCoordinates)) {
        next[shuttleId] = current[shuttleId] || nextCoordinates[shuttleId];
      }

      return next;
    });

    for (const shuttleId of previousIds) {
      if (!activeIds.has(shuttleId)) {
        if (markerAnimTimers.current[shuttleId]) {
          clearTimeout(markerAnimTimers.current[shuttleId]!);
        }
        delete markerAnimTimers.current[shuttleId];
        delete markerRefs.current[shuttleId];
      }
    }
  }, [mapShuttles, user?.role]);

  useEffect(() => {
    const timer = setInterval(() => {
      setPickupIntents((items) => items.filter((item) => !isExpiredIntent(item)));
    }, 30_000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (user?.role !== 'passenger') return;

    const timer = setInterval(() => {
      setNowTs(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, [user?.role]);

  useEffect(() => {
    const timers = markerAnimTimers.current;

    return () => {
      for (const timer of Object.values(timers)) {
        if (timer) clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current || communityBoundary.length < 3) return;

    mapRef.current.fitToCoordinates(communityBoundary, {
      edgePadding: {
        top: 40,
        right: 40,
        bottom: 40,
        left: 40,
      },
      animated: false,
    });
  }, [communityBoundary, mapReady]);

  const handleBoardPassenger = async () => {
    if (!assignedShuttle) {
      setPreferenceAwareFeedback('No shuttle assigned to this driver account.', 'critical');
      return;
    }

    try {
      await boardPassenger(assignedShuttle._id, 1);
      await loadShuttles();
      setPreferenceAwareFeedback('Passenger boarding recorded.', 'ride');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to record passenger.';
      const canQueue = /(network|timeout|request failed|socket|connect|offline)/i.test(message);

      if (canQueue) {
        await addOfflineBoarding(assignedShuttle._id, 1);
        const queue = await getOfflineBoardings();
        setQueuedBoardings(queue.length);
        setPreferenceAwareFeedback(`No connection. Boarding cached locally (${queue.length} queued).`, 'critical');
      } else {
        setPreferenceAwareFeedback(message, 'critical');
      }
    }
  };

  const handleSyncOfflineBoardings = async () => {
    const queue = await getOfflineBoardings();

    if (queue.length === 0) {
      setPreferenceAwareFeedback('No queued boardings to sync.', 'service');
      return;
    }

    let successCount = 0;
    const failed = [];

    for (const item of queue) {
      try {
        await boardPassenger(item.shuttleId, item.boardedCount);
        successCount += 1;
      } catch {
        failed.push(item);
      }
    }

    await setOfflineBoardings(failed);
    setQueuedBoardings(failed.length);
    await loadShuttles();
    setPreferenceAwareFeedback(`Synced ${successCount}/${queue.length} queued boardings.`, 'service');
  };

  const handleShiftEnd = async () => {
    if (!assignedShuttle) {
      setPreferenceAwareFeedback('No shuttle assigned to this driver account.', 'critical');
      return;
    }

    try {
      const summary = await endShift(assignedShuttle._id);
      setLastSummary(summary);
      await loadShuttles();
      setPreferenceAwareFeedback('Shift closed successfully.', 'ride');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to end shift.';
      setPreferenceAwareFeedback(message, 'critical');
    }
  };

  const handleSyncLocation = async () => {
    if (!assignedShuttle) {
      setPreferenceAwareFeedback('No shuttle assigned to this driver account.', 'critical');
      return;
    }

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setPreferenceAwareFeedback('Location permission is required to sync GPS.', 'critical');
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      await updateShuttleLocation(
        assignedShuttle._id,
        position.coords.latitude,
        position.coords.longitude
      );

      await loadShuttles();

      const socket = getSocket();
      socket?.emit('driver-location', {
        shuttleId: assignedShuttle._id,
        communityId: user?.communityId,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });

      setPreferenceAwareFeedback('GPS synced successfully.', 'service');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sync location.';
      setPreferenceAwareFeedback(message, 'critical');
    }
  };

  const handleRequestPickup = async () => {
    if (pickupDisabled) {
      if (activePassengerPickupIntents.length > 0) {
        const expiresAt = new Date(activePassengerPickupIntents[0].expiresAt).getTime();
        setPreferenceAwareFeedback(`Pickup request active (${formatSeconds(Math.ceil((expiresAt - nowTs) / 1000))} left).`, 'ride');
      }
      return;
    }

    try {
      setPickupSubmitting(true);
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setPreferenceAwareFeedback('Location permission is required to request pickup.', 'critical');
        setPickupSubmitting(false);
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const pickupLatitude = precisePickup
        ? position.coords.latitude
        : Number(position.coords.latitude.toFixed(4));
      const pickupLongitude = precisePickup
        ? position.coords.longitude
        : Number(position.coords.longitude.toFixed(4));

      const pickupIntent = await createPickupIntent(pickupLatitude, pickupLongitude);
      setPickupIntents((items) => upsertPickupIntent(items, pickupIntent));
      setPickupCooldownUntil(Date.now() + PICKUP_COOLDOWN_MS);
      setPreferenceAwareFeedback('Pickup request sent. Drivers in your community were notified.', 'ride');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit pickup request.';
      setPreferenceAwareFeedback(message, 'critical');
    } finally {
      setPickupSubmitting(false);
    }
  };

  const onDriverBoard = async () => {
    if (hapticsEnabled) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    await handleBoardPassenger();
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/(auth)/login');
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bgColor }]} edges={['top', 'left', 'right']}>
      <PremiumCard style={styles.topBar}>
        <SectionHeader
          title="GoShuttle"
          subtitle={`${user?.firstName} ${user?.lastName} · ${user?.role}`}
          titleColor={palette.white}
          subtitleColor="#cbd5e1"
          rightAction={
            <PremiumButton style={styles.topPill} onPress={handleLogout} variant="secondary">
              <Ionicons name="log-out-outline" size={16} color={tint} />
              <ThemedText style={[styles.logoutText, { color: tint }]}>Logout</ThemedText>
            </PremiumButton>
          }
        />
      </PremiumCard>

      {user?.role === 'driver' ? (
        <View style={styles.driverLayout}>
          <PremiumCard style={[styles.driverInfoCard, { backgroundColor: surfaceColor, borderColor }]}>
            <SectionHeader
              title="Driver Operations"
              subtitle={assignedShuttle ? `Assigned: ${assignedShuttle.plateNumber}` : 'No assigned shuttle'}
              rightAction={
                <PremiumButton style={styles.iconButton} onPress={loadShuttles} variant="secondary">
                  <Ionicons name="refresh" size={18} color={tint} />
                </PremiumButton>
              }
            />

            <ThemedText style={[styles.valueText, { color: textColor }]}>
              {assignedShuttle ? assignedShuttle.plateNumber : 'No Assigned Shuttle'}
            </ThemedText>

            {assignedShuttle ? (
              <View style={styles.rowBetween}>
                <ThemedText style={[styles.metaText, { color: mutedColor }]}>
                  Load {assignedShuttle.currentCapacity}/{assignedShuttle.maxCapacity}
                </ThemedText>
                <View
                  style={[
                    styles.capacityDot,
                    {
                      backgroundColor: capacityBadgeColor(
                        assignedShuttle.currentCapacity,
                        assignedShuttle.maxCapacity
                      ),
                    },
                  ]}
                />
              </View>
            ) : null}

            <ThemedText style={[styles.metaText, { color: mutedColor }]}>Offline queue: {queuedBoardings}</ThemedText>

            <View style={styles.quickActionRow}>
              <PremiumButton style={styles.quickActionBtn} onPress={handleSyncLocation} variant="secondary">
                <Ionicons name="locate-outline" size={16} color={tint} />
                <ThemedText style={[styles.quickActionTxt, { color: tint }]}>Sync GPS</ThemedText>
              </PremiumButton>
              <PremiumButton style={styles.quickActionBtn} onPress={handleSyncOfflineBoardings} variant="secondary">
                <Ionicons name="cloud-upload-outline" size={16} color={tint} />
                <ThemedText style={[styles.quickActionTxt, { color: tint }]}>Sync Queue</ThemedText>
              </PremiumButton>
              <PremiumButton style={styles.quickActionBtn} onPress={handleShiftEnd} variant="secondary">
                <Ionicons name="flag-outline" size={16} color={tint} />
                <ThemedText style={[styles.quickActionTxt, { color: tint }]}>End Shift</ThemedText>
              </PremiumButton>
            </View>

            {lastSummary ? (
              <PremiumCard style={styles.summaryBox} muted>
                <ThemedText style={styles.summaryTitle}>Last Shift</ThemedText>
                <ThemedText style={styles.summaryText}>
                  Passengers: {lastSummary.passengersBoarded}
                </ThemedText>
                <ThemedText style={styles.summaryRevenue}>
                  Revenue: {lastSummary.revenueCollected}
                </ThemedText>
              </PremiumCard>
            ) : null}

            {feedback ? <ThemedText style={[styles.feedback, { color: mutedColor }]}>{feedback}</ThemedText> : null}
          </PremiumCard>

          <Pressable style={[styles.driverPrimaryButton, { backgroundColor: successColor }]} onPress={onDriverBoard}>
            <Ionicons name="add-circle" size={40} color={palette.white} />
            <ThemedText style={styles.driverPrimaryText}>+1 BOARDED</ThemedText>
          </Pressable>
        </View>
      ) : (
        <View style={styles.passengerLayout}>
          <View style={styles.mapWrap}>
            {passengerRegion ? (
              <MapView
                ref={mapRef}
                style={styles.map}
                initialRegion={passengerRegion}
                onMapReady={() => setMapReady(true)}
                scrollEnabled={false}
                zoomEnabled={false}
                rotateEnabled={false}
                pitchEnabled={false}
                toolbarEnabled={false}
              >
                {communityBoundary.length >= 3 ? (
                  <Polygon
                    coordinates={communityBoundary}
                    fillColor={AppPalette.navyOverlaySoft}
                    strokeColor={palette.navy}
                    strokeWidth={2}
                  />
                ) : null}

                {mapShuttles.map((item) => {
                  const fallback = toShuttleCoordinate(item);
                  const coordinate = markerCoordinates[item._id] || fallback;
                  if (!coordinate) return null;

                  return (
                    <Marker
                      key={item._id}
                      ref={(ref) => {
                        markerRefs.current[item._id] = ref;
                      }}
                      coordinate={coordinate}
                      title={item.plateNumber}
                      description={`${item.currentCapacity}/${item.maxCapacity} seated`}
                      pinColor={capacityBadgeColor(item.currentCapacity, item.maxCapacity)}
                    />
                  );
                })}

                {pickupIntents
                  .filter((item) => item.status === 'pending' && !isExpiredIntent(item) && item.passengerId === user?._id)
                  .map((item) => {
                    const [longitude, latitude] = item.location.coordinates;
                    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

                    const coordinate = { latitude, longitude };

                    return [
                      <Circle
                        key={`pickup-circle-${item._id}`}
                        center={coordinate}
                        radius={45}
                        fillColor={AppPalette.dangerOverlaySoft}
                        strokeColor={AppPalette.dangerOverlayMedium}
                        strokeWidth={1}
                      />,
                      <Marker
                        key={`pickup-pin-${item._id}`}
                        coordinate={coordinate}
                        title="Pickup Request"
                        description="Passenger waiting"
                        pinColor={palette.rose}
                      />,
                    ];
                  })}
              </MapView>
            ) : (
              <View style={styles.mapPlaceholder}>
                <ActivityIndicator color={palette.white} size="small" />
                <ThemedText style={styles.mapPlaceholderText}>Loading Community Map</ThemedText>
                <ThemedText style={styles.mapPlaceholderHint}>Fetching geofence boundary</ThemedText>
              </View>
            )}

            <View style={styles.mapLockBadge}>
              <Ionicons name="lock-closed" size={12} color={palette.white} />
              <ThemedText style={styles.mapLockText}>Map Locked to Community</ThemedText>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.sheet}>
            <PremiumCard style={styles.passengerHubCard}>
              <SectionHeader
                title="Ride Center"
                subtitle="Live fleet and pickup status"
                rightAction={
                  <PremiumButton style={styles.iconButton} onPress={loadShuttles} variant="secondary">
                    <Ionicons name="refresh" size={18} color={tint} />
                  </PremiumButton>
                }
              />

              <ThemedText style={[styles.valueText, { color: textColor }]}>Active Fleet: {shuttles.length}</ThemedText>

              <View style={styles.passengerStatsRow}>
                <View style={[styles.passengerStatPill, { borderColor, backgroundColor: bgColor }]}>
                  <Ionicons name="people-outline" size={14} color={tint} />
                  <ThemedText style={[styles.passengerStatText, { color: textColor }]}>
                    Seats Open: {passengerStats.availableSeats}
                  </ThemedText>
                </View>
                <View style={[styles.passengerStatPill, { borderColor, backgroundColor: bgColor }]}>
                  <Ionicons name="warning-outline" size={14} color={palette.rose} />
                  <ThemedText style={[styles.passengerStatText, { color: textColor }]}>
                    Full Shuttles: {passengerStats.fullCount}
                  </ThemedText>
                </View>
              </View>

              {passengerFleet.slice(0, 4).map((item) => (
                <View key={item._id} style={[styles.shuttleRow, { borderColor, backgroundColor: surfaceColor }]}>
                  <Ionicons name="bus-outline" size={16} color={tint} />
                  <View style={styles.shuttleTextWrap}>
                    <ThemedText style={[styles.shuttleRowText, { color: textColor }]}>
                      {item.plateNumber} · {item.currentCapacity}/{item.maxCapacity}
                    </ThemedText>
                    {showEta ? (
                      <ThemedText style={[styles.shuttleEtaText, { color: mutedColor }]}>ETA: live tracking</ThemedText>
                    ) : null}
                  </View>
                </View>
              ))}

              <Pressable
                style={[styles.passengerPrimaryButton, pickupDisabled && styles.passengerPrimaryButtonDisabled, { backgroundColor: pickupCtaBg }]}
                onPress={handleRequestPickup}
                disabled={pickupDisabled}
              >
                <Ionicons
                  name={pickupSubmitting ? 'time-outline' : 'navigate'}
                  size={18}
                  color={palette.white}
                />
                <ThemedText style={styles.passengerPrimaryText}>
                  {pickupSubmitting
                    ? 'Sending Pickup...'
                    : activePassengerPickupIntents.length > 0
                    ? `Pickup Active (${formatSeconds(Math.max(0, Math.ceil((new Date(activePassengerPickupIntents[0].expiresAt).getTime() - nowTs) / 1000)))})`
                    : pickupCooldownRemainingMs > 0
                    ? `Retry in ${Math.ceil(pickupCooldownRemainingMs / 1000)}s`
                    : 'Request Pickup'}
                </ThemedText>
              </Pressable>

              {activePassengerPickupIntents.length > 0 ? (
                <View style={styles.pickupStatusCard}>
                  <Ionicons name="radio-outline" size={14} color={palette.rose} />
                  <ThemedText style={styles.pickupStatusText}>
                    Drivers can see your request now. It expires in{' '}
                    {formatSeconds(
                      Math.max(
                        0,
                        Math.ceil((new Date(activePassengerPickupIntents[0].expiresAt).getTime() - nowTs) / 1000)
                      )
                    )}
                    .
                  </ThemedText>
                </View>
              ) : null}

              {feedback ? <ThemedText style={[styles.feedback, { color: mutedColor }]}>{feedback}</ThemedText> : null}
            </PremiumCard>
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.slateBg,
  },
  topBar: {
    backgroundColor: palette.navy,
    marginHorizontal: DesignTokens.spacing.sm,
    marginTop: DesignTokens.spacing.xs,
    marginBottom: DesignTokens.spacing.xs,
    borderRadius: DesignTokens.radius.xl,
    borderWidth: 0,
  },
  topTitle: {
    color: palette.white,
    fontSize: 22,
    fontWeight: '800',
  },
  topSubtitle: {
    color: '#cbd5e1',
    fontSize: 13,
  },
  topActions: {
    flexDirection: 'row',
    gap: 8,
  },
  topPill: {
    minHeight: 40,
    paddingHorizontal: DesignTokens.spacing.xs,
    paddingVertical: DesignTokens.spacing.xxs,
  },
  logoutText: {
    fontWeight: '700',
    fontSize: 12,
  },
  driverLayout: {
    flex: 1,
    padding: DesignTokens.spacing.sm,
    paddingTop: DesignTokens.spacing.xs,
  },
  driverInfoCard: {
    flex: 1,
    gap: DesignTokens.spacing.xs,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: palette.navy,
  },
  valueText: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    color: palette.navy,
  },
  metaText: {
    color: palette.slateText,
    fontSize: 14,
    fontWeight: '600',
  },
  capacityDot: {
    width: 16,
    height: 16,
    borderRadius: DesignTokens.radius.pill,
  },
  quickActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: DesignTokens.spacing.xs,
  },
  quickActionBtn: {
    paddingVertical: DesignTokens.spacing.xs,
    paddingHorizontal: DesignTokens.spacing.xs,
    minHeight: 48,
    flex: 1,
  },
  quickActionTxt: {
    color: palette.navy,
    fontWeight: '700',
  },
  iconButton: {
    minHeight: 40,
    minWidth: 40,
    paddingHorizontal: DesignTokens.spacing.xs,
  },
  driverPrimaryButton: {
    minHeight: '30%',
    marginTop: DesignTokens.spacing.sm,
    borderRadius: DesignTokens.radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: DesignTokens.spacing.xs,
    shadowColor: '#0f172a',
    shadowOpacity: 0.16,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 12,
    elevation: 4,
  },
  driverPrimaryText: {
    color: palette.white,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  passengerLayout: {
    flex: 1,
  },
  mapWrap: {
    height: '58%',
    backgroundColor: palette.navy,
    overflow: 'hidden',
    marginHorizontal: DesignTokens.spacing.sm,
    borderRadius: DesignTokens.radius.xl,
  },
  map: {
    flex: 1,
  },
  mapPlaceholder: {
    flex: 1,
    backgroundColor: palette.navy,
    alignItems: 'center',
    justifyContent: 'center',
    gap: DesignTokens.spacing.xs,
  },
  mapPlaceholderText: {
    color: palette.white,
    fontSize: 20,
    fontWeight: '800',
  },
  mapPlaceholderHint: {
    color: '#cbd5e1',
    fontSize: 13,
  },
  mapLockBadge: {
    position: 'absolute',
    top: DesignTokens.spacing.sm,
    left: DesignTokens.spacing.sm,
    backgroundColor: AppPalette.darkOverlayStrong,
    borderRadius: DesignTokens.radius.pill,
    paddingHorizontal: DesignTokens.spacing.xs,
    paddingVertical: DesignTokens.spacing.xxs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
  },
  mapLockText: {
    color: palette.white,
    fontWeight: '700',
    fontSize: 12,
  },
  sheet: {
    backgroundColor: 'transparent',
    marginTop: DesignTokens.spacing.xs,
    padding: DesignTokens.spacing.sm,
    gap: DesignTokens.spacing.xs,
    minHeight: 260,
  },
  passengerHubCard: {
    gap: DesignTokens.spacing.xs,
  },
  shuttleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
    padding: DesignTokens.spacing.sm,
    borderColor: palette.slateBorder,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    minHeight: 48,
  },
  shuttleTextWrap: {
    flex: 1,
  },
  shuttleRowText: {
    color: palette.navy,
    fontWeight: '700',
  },
  shuttleEtaText: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
  },
  passengerPrimaryButton: {
    marginTop: DesignTokens.spacing.xs,
    borderRadius: DesignTokens.radius.md,
    paddingVertical: DesignTokens.spacing.sm,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: DesignTokens.spacing.xs,
  },
  passengerPrimaryButtonDisabled: {
    opacity: 0.75,
  },
  passengerPrimaryText: {
    color: palette.white,
    fontWeight: '800',
    fontSize: 17,
  },
  passengerStatsRow: {
    flexDirection: 'row',
    gap: DesignTokens.spacing.xs,
  },
  passengerStatPill: {
    flex: 1,
    borderColor: palette.slateBorder,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingVertical: DesignTokens.spacing.xs,
    paddingHorizontal: DesignTokens.spacing.xs,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
    backgroundColor: '#f8fafc',
  },
  passengerStatText: {
    color: palette.navy,
    fontWeight: '700',
    fontSize: 12,
  },
  pickupStatusCard: {
    borderColor: AppPalette.dangerMutedBorder,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingVertical: DesignTokens.spacing.xs,
    paddingHorizontal: DesignTokens.spacing.xs,
    backgroundColor: AppPalette.dangerMutedBackground,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
    minHeight: 48,
  },
  pickupStatusText: {
    color: AppPalette.dangerStrongText,
    fontWeight: '700',
    fontSize: 12,
    flex: 1,
  },
  feedback: {
    fontSize: 13,
  },
  summaryBox: {
    padding: DesignTokens.spacing.xs,
    borderRadius: DesignTokens.radius.md,
    backgroundColor: AppPalette.successMutedBackground,
    gap: DesignTokens.spacing.xxs,
  },
  summaryTitle: {
    fontWeight: '700',
    color: palette.navy,
  },
  summaryText: {
    color: palette.slateText,
  },
  summaryRevenue: {
    color: palette.emerald,
    fontWeight: '800',
  },
});
