import { ThemedText } from '@/components/themed-text';
import { PremiumButton } from '@/components/ui/premium-button';
import { PremiumCard } from '@/components/ui/premium-card';
import { SectionHeader } from '@/components/ui/section-header';
import { AppPalette, getCapacityColor } from '@/constants/app-ui';
import { DesignTokens, OutfitFonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { getCommunityById } from '@/services/community';
import { toLatLngPoint } from '@/services/map-types';
import {
    AutomationDiagnostics,
    listShuttles,
    Shuttle,
    updateShuttleLocation,
} from '@/services/shuttle';
import { connectCommunitySocket } from '@/services/socket';
import {
    createPickupIntent,
    listOnboardDestinations,
    listPickupIntents,
    OnboardDestinationPassenger,
    PickupIntent,
    unboardPassenger
} from '@/services/trip';
import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import MapView, { Callout, Circle, LatLng, Marker, Polygon, Region } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

const capacityBadgeColor = getCapacityColor;
const DRIVER_PICKUP_INTENTS_POLL_MS = 30_000;
const DRIVER_ONBOARD_DESTINATIONS_POLL_MS = 20_000;
const DRIVER_AUTO_SYNC_MS = 30_000;
const DRIVER_WATCH_TIME_INTERVAL_MS = 3_000;
const DRIVER_WATCH_DISTANCE_INTERVAL_METERS = 5;
const DRIVER_CONTINUOUS_MIN_SYNC_INTERVAL_MS = 5_000;
const DRIVER_CONTINUOUS_MIN_MOVE_METERS = 15;
const POLL_ERROR_NOTICE_COOLDOWN_MS = 120_000;
const COMMUNITY_SETTINGS_SYNC_POLL_MS = 45_000;

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

const toMaxZoomOutRegionFromBoundary = (coordinates: LatLng[]): Region | null => {
  if (coordinates.length < 3) return null;

  const lats = coordinates.map((point) => point.latitude);
  const lngs = coordinates.map((point) => point.longitude);

  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const latitudeDelta = Math.max((maxLat - minLat) * 1.05, 0.005);
  const longitudeDelta = Math.max((maxLng - minLng) * 1.05, 0.005);

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
  destinationType?: 'fixed' | 'home';
  destinationLabel?: string;
  destinationLocation?: {
    type?: 'Point';
    coordinates?: [number, number];
  };
  status?: PickupIntent['status'];
  expiresAt?: string;
};

type PickupClaimedEventPayload = {
  requestId?: string;
  passengerId?: string;
  shuttleId?: string;
  tripId?: string;
};

type PassengerAutoUnboardedPayload = {
  rideIds?: string[];
};

type AutomationDiagnostic = {
  state: 'ready' | 'waiting' | 'blocked';
  label: string;
  detail: string;
};

const describeBoardingReason = (
  reasonCode: AutomationDiagnostics['autoBoarding']['reasonCode'],
  candidateCount: number,
  matchedCount: number
) => {
  if (reasonCode === 'driver_off_shift') return 'Driver is off shift. Start shift to enable automation.';
  if (reasonCode === 'shuttle_full') return 'Shuttle is at full capacity.';
  if (reasonCode === 'location_unavailable') return 'Location is unavailable. Sync GPS again.';
  if (reasonCode === 'nearby_pickups_pending') {
    return `${candidateCount} nearby pickup request${candidateCount === 1 ? '' : 's'} waiting.`;
  }
  if (reasonCode === 'auto_boarded') {
    return `Auto-boarded ${matchedCount} pickup request${matchedCount === 1 ? '' : 's'} on last sync.`;
  }
  if (reasonCode === 'not_driver') return 'Automation requires a driver account.';
  return 'No nearby pickup requests in the queue.';
};

const describeUnboardingReason = (
  reasonCode: AutomationDiagnostics['autoUnboarding']['reasonCode'],
  candidateCount: number,
  matchedCount: number
) => {
  if (reasonCode === 'driver_off_shift') return 'Driver is off shift. Start shift to enable automation.';
  if (reasonCode === 'location_unavailable') return 'Location is unavailable. Sync GPS again.';
  if (reasonCode === 'auto_unboarded') {
    return `Auto-unboarded ${matchedCount} passenger${matchedCount === 1 ? '' : 's'} on last sync.`;
  }
  if (reasonCode === 'no_active_trip') return 'No active trip found yet.';
  if (reasonCode === 'no_onboard_passengers') return 'No onboard passengers to unboard.';
  if (reasonCode === 'arrivals_pending_retry') {
    return `${candidateCount} passenger${candidateCount === 1 ? '' : 's'} near destination. Next sync will finalize.`;
  }
  if (reasonCode === 'not_driver') return 'Automation requires a driver account.';
  return 'No arrived destinations yet.';
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
    destinationType: payload.destinationType || 'fixed',
    destinationLabel: payload.destinationLabel || 'Destination',
    destinationLocation: payload.destinationLocation?.coordinates?.length === 2
      ? {
        type: 'Point',
        coordinates: payload.destinationLocation.coordinates,
      }
      : {
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

type MapIndicatorProps = {
  iconName: keyof typeof Ionicons.glyphMap;
};

const MapIndicator = ({ iconName }: MapIndicatorProps) => (
  <View style={styles.mapIndicatorWrapper}>
    <View style={styles.mapIndicatorBubble}>
      <Ionicons name={iconName} size={10} color={palette.navy} />
    </View>
  </View>
);

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

const toRadians = (value: number) => (value * Math.PI) / 180;

const getDistanceMeters = (from: LatLng, to: LatLng) => {
  const earthRadius = 6_371_000;
  const dLat = toRadians(to.latitude - from.latitude);
  const dLng = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
};

const toCommunityIdString = (communityId: unknown): string | null => {
  if (typeof communityId === 'string' && communityId.trim().length > 0) {
    return communityId;
  }

  if (communityId && typeof communityId === 'object') {
    const candidate = (communityId as { _id?: unknown })._id;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return null;
};

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const user = useAuthStore((state) => state.user);
  const token = useAuthStore((state) => state.token);

  const bgColor = useThemeColor({}, 'background');
  const surfaceColor = useThemeColor({}, 'surface');
  const borderColor = useThemeColor({}, 'border');
  const textColor = useThemeColor({}, 'text');
  const mutedColor = useThemeColor({}, 'textMuted');
  const tint = useThemeColor({}, 'tint');
  const successColor = useThemeColor({}, 'success');
  const dangerColor = useThemeColor({}, 'danger');
  const pickupCtaBg = colorScheme === 'dark' ? successColor : tint;
  const capacityCardBackground = colorScheme === 'dark' ? AppPalette.darkMintBg : AppPalette.successMutedBackground;
  const capacityCardBorder = colorScheme === 'dark' ? successColor : '#a7f3d0';
  const hapticsEnabled = usePreferencesStore((state) => state.hapticsEnabled);
  const compactMapPins = usePreferencesStore((state) => state.compactMapPins);
  const showEta = usePreferencesStore((state) => state.showEta);
  const precisePickup = usePreferencesStore((state) => state.precisePickup);
  const quietMode = usePreferencesStore((state) => state.quietMode);
  const pushAlerts = usePreferencesStore((state) => state.pushAlerts);
  const serviceUpdates = usePreferencesStore((state) => state.serviceUpdates);
  const [shuttles, setShuttles] = useState<Shuttle[]>([]);
  const [feedback, setFeedback] = useState<{ message: string; type: 'ride' | 'service' | 'critical' } | null>(null);
  const [communityBoundary, setCommunityBoundary] = useState<LatLng[]>([]);
  const [maxZoomOutRegion, setMaxZoomOutRegion] = useState<Region | null>(null);
  const [passengerRegion, setPassengerRegion] = useState<Region | null>(null);
  const [driverRegion, setDriverRegion] = useState<Region | null>(null);
  const [pickupIntents, setPickupIntents] = useState<PickupIntent[]>([]);
  const [pickupSubmitting, setPickupSubmitting] = useState(false);
  const [unboardingSubmitting, setUnboardingSubmitting] = useState(false);
  const [selectedDestinationType, setSelectedDestinationType] = useState<'fixed' | 'home' | null>(null);
  const [selectedFixedDestinationId, setSelectedFixedDestinationId] = useState('');
  const [fixedDestinations, setFixedDestinations] = useState<{
    _id: string;
    name: string;
    location: { type: 'Point'; coordinates: [number, number] };
    isActive?: boolean;
  }[]>([]);
  const [communitySyncTick, setCommunitySyncTick] = useState(0);
  const [onboardDestinations, setOnboardDestinations] = useState<OnboardDestinationPassenger[]>([]);
  const [autoSyncStatus, setAutoSyncStatus] = useState<'idle' | 'syncing' | 'error'>('idle');
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState<Date | null>(null);
  const [lastAutomationDiagnostics, setLastAutomationDiagnostics] = useState<AutomationDiagnostics | null>(null);
  const [markerCoordinates, setMarkerCoordinates] = useState<Record<string, LatLng>>({});
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<MapView | null>(null);
  const driverMapRef = useRef<MapView | null>(null);
  const driverConstraintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passengerConstraintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markerRefs = useRef<Record<string, any>>({});
  const previousMarkerCoords = useRef<Record<string, LatLng>>({});
  const markerAnimTimers = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});
  const locationSyncInFlightRef = useRef(false);
  const driverLocationWatchRef = useRef<Location.LocationSubscription | null>(null);
  const lastContinuousSyncRef = useRef<{ at: number; coords: LatLng } | null>(null);
  const pollErrorNoticeRef = useRef<{ pickup: number; onboard: number }>({
    pickup: 0,
    onboard: 0,
  });

  const getDriverId = (driverId: any): string | null => {
    if (typeof driverId === 'string') return driverId;
    if (driverId && typeof driverId === 'object' && driverId._id) return driverId._id;
    return null;
  };

  const getShuttleDriverStatus = (driverId: Shuttle['driverId']) => {
    if (driverId && typeof driverId === 'object') {
      return driverId.status || 'offline';
    }
    return 'offline';
  };

  const isDriverOnShift = user?.role === 'driver' && user?.status === 'driving';
  const hasSavedHomeDestination = (user?.homeDestination?.location?.coordinates || []).length === 2;
  const activeCommunityId = useMemo(() => toCommunityIdString(user?.communityId), [user?.communityId]);

  const assignedShuttle = useMemo(() => {
    if (!user) return null;
    if (user.role !== 'driver') return null;
    return shuttles.find((item) => getDriverId(item.driverId) === user._id) || null;
  }, [shuttles, user]);

  const activePassengerPickupIntents = useMemo(() => {
    const myId = user?._id;
    if (!myId) return [];

    return pickupIntents
      .filter((item) => item.passengerId === myId && item.status === 'pending' && !isExpiredIntent(item))
      .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
  }, [pickupIntents, user?._id]);

  const selectedFixedDestination = useMemo(
    () => fixedDestinations.find((item) => item._id === selectedFixedDestinationId) || null,
    [fixedDestinations, selectedFixedDestinationId]
  );

  const selectedDestinationSummary = useMemo(() => {
    if (!selectedDestinationType) {
      return 'Choose a destination type first';
    }

    if (selectedDestinationType === 'home') {
      if (!hasSavedHomeDestination) {
        return 'Home - not set yet (set it in Settings)';
      }
      return `Home - ${user?.homeDestination?.label || 'Home'}`;
    }

    if (!selectedFixedDestination) {
      return 'Fixed - no destination selected';
    }

    return `Fixed - ${selectedFixedDestination.name}`;
  }, [hasSavedHomeDestination, selectedDestinationType, selectedFixedDestination, user?.homeDestination?.label]);

  const activePickupDestinationSummary = useMemo(() => {
    const activeIntent = activePassengerPickupIntents[0];
    if (!activeIntent) return null;

    return `${activeIntent.destinationType === 'home' ? 'Home' : 'Fixed'} - ${activeIntent.destinationLabel}`;
  }, [activePassengerPickupIntents]);

  const selectedDestinationAccentColor =
    selectedDestinationType === 'home' ? successColor :
      selectedDestinationType === 'fixed' ? tint :
        mutedColor;
  const selectedDestinationCardBackground =
    selectedDestinationType === 'home'
      ? colorScheme === 'dark'
        ? AppPalette.darkMintBg
        : AppPalette.mint
      : selectedDestinationType === 'fixed'
        ? colorScheme === 'dark'
          ? AppPalette.darkSkyBg
          : AppPalette.sky
        : surfaceColor;
  const activePickupDestinationType = activePassengerPickupIntents[0]?.destinationType || selectedDestinationType || 'fixed';
  const activePickupDestinationAccent = activePickupDestinationType === 'home' ? successColor : tint;

  const isDestinationReady =
    selectedDestinationType === 'fixed'
      ? Boolean(selectedFixedDestinationId)
      : selectedDestinationType === 'home'
        ? hasSavedHomeDestination
        : false;

  const pickupDisabled = pickupSubmitting || activePassengerPickupIntents.length > 0;
  const activeCommunityPickupIntents = useMemo(
    () => pickupIntents.filter((item) => item.status === 'pending' && !isExpiredIntent(item)),
    [pickupIntents]
  );

  const autoBoardDiagnostic = useMemo<AutomationDiagnostic>(() => {
    const serverDiagnostic = lastAutomationDiagnostics?.autoBoarding;
    if (serverDiagnostic) {
      const mappedState = serverDiagnostic.state === 'executed' ? 'ready' : serverDiagnostic.state;
      return {
        state: mappedState,
        label:
          mappedState === 'blocked'
            ? 'Auto-Boarding Blocked'
            : mappedState === 'ready'
              ? 'Auto-Boarding Ready'
              : 'Auto-Boarding Waiting',
        detail: describeBoardingReason(
          serverDiagnostic.reasonCode,
          Number(serverDiagnostic.candidateCount || 0),
          Number(serverDiagnostic.matchedCount || 0)
        ),
      };
    }

    if (!assignedShuttle) {
      return {
        state: 'blocked',
        label: 'Auto-Boarding Blocked',
        detail: 'No shuttle is assigned to this driver.',
      };
    }

    if (!isDriverOnShift) {
      return {
        state: 'blocked',
        label: 'Auto-Boarding Blocked',
        detail: 'Driver is off shift. Start shift to enable automation.',
      };
    }

    if (assignedShuttle.currentCapacity >= assignedShuttle.maxCapacity) {
      return {
        state: 'blocked',
        label: 'Auto-Boarding Blocked',
        detail: 'Shuttle is at full capacity.',
      };
    }

    if (activeCommunityPickupIntents.length === 0) {
      return {
        state: 'waiting',
        label: 'Auto-Boarding Waiting',
        detail: 'No pending pickup requests in the queue.',
      };
    }

    return {
      state: 'ready',
      label: 'Auto-Boarding Ready',
      detail: 'Will auto-board when GPS is within pickup radius.',
    };
  }, [activeCommunityPickupIntents.length, assignedShuttle, isDriverOnShift, lastAutomationDiagnostics]);

  const autoUnboardDiagnostic = useMemo<AutomationDiagnostic>(() => {
    const serverDiagnostic = lastAutomationDiagnostics?.autoUnboarding;
    if (serverDiagnostic) {
      const mappedState = serverDiagnostic.state === 'executed' ? 'ready' : serverDiagnostic.state;
      return {
        state: mappedState,
        label:
          mappedState === 'blocked'
            ? 'Auto-Unboarding Blocked'
            : mappedState === 'ready'
              ? 'Auto-Unboarding Ready'
              : 'Auto-Unboarding Waiting',
        detail: describeUnboardingReason(
          serverDiagnostic.reasonCode,
          Number(serverDiagnostic.candidateCount || 0),
          Number(serverDiagnostic.matchedCount || 0)
        ),
      };
    }

    if (!assignedShuttle) {
      return {
        state: 'blocked',
        label: 'Auto-Unboarding Blocked',
        detail: 'No shuttle is assigned to this driver.',
      };
    }

    if (!isDriverOnShift) {
      return {
        state: 'blocked',
        label: 'Auto-Unboarding Blocked',
        detail: 'Driver is off shift. Start shift to enable automation.',
      };
    }

    if (assignedShuttle.currentCapacity === 0) {
      return {
        state: 'waiting',
        label: 'Auto-Unboarding Waiting',
        detail: 'No onboard passengers to unboard.',
      };
    }

    if (onboardDestinations.length === 0) {
      return {
        state: 'waiting',
        label: 'Auto-Unboarding Waiting',
        detail: 'No destination data available for onboard passengers.',
      };
    }

    return {
      state: 'ready',
      label: 'Auto-Unboarding Ready',
      detail: 'Will auto-unboard when GPS reaches a passenger destination.',
    };
  }, [assignedShuttle, isDriverOnShift, lastAutomationDiagnostics, onboardDestinations.length]);

  const automationReliabilityScore = useMemo(() => {
    if (!assignedShuttle) return 0;

    let score = 0;

    if (isDriverOnShift) score += 40;
    if (autoSyncStatus !== 'error') score += 20;
    if (lastAutoSyncAt && Date.now() - lastAutoSyncAt.getTime() <= DRIVER_AUTO_SYNC_MS * 2) score += 20;
    if (assignedShuttle.currentCapacity < assignedShuttle.maxCapacity) score += 10;
    if (activeCommunityPickupIntents.length > 0 || onboardDestinations.length > 0) score += 10;

    return Math.max(0, Math.min(100, score));
  }, [
    activeCommunityPickupIntents.length,
    assignedShuttle,
    autoSyncStatus,
    isDriverOnShift,
    lastAutoSyncAt,
    onboardDestinations.length,
  ]);

  const automationReliabilityLabel = useMemo(() => {
    if (automationReliabilityScore >= 80) return 'High';
    if (automationReliabilityScore >= 50) return 'Medium';
    return 'Low';
  }, [automationReliabilityScore]);

  const getDiagnosticColor = useCallback((state: AutomationDiagnostic['state']) => {
    if (state === 'ready') return successColor;
    if (state === 'blocked') return dangerColor;
    return tint;
  }, [dangerColor, successColor, tint]);

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
    const activeShiftCount = shuttles.filter(
      (item) => item.driverId && typeof item.driverId === 'object' && item.driverId.status === 'driving'
    ).length;
    const offShiftCount = Math.max(0, shuttles.length - activeShiftCount);

    return {
      availableSeats,
      fullCount,
      activeShiftCount,
      offShiftCount,
    };
  }, [shuttles]);

  const setPreferenceAwareFeedback = useCallback((
    message: string,
    channel: 'ride' | 'service' | 'critical' = 'ride'
  ) => {
    if (channel === 'critical') {
      setFeedback({ message, type: channel });
      return;
    }

    if (quietMode) return;
    if (channel === 'ride' && !pushAlerts) return;
    if (channel === 'service' && !serviceUpdates) return;

    setFeedback({ message, type: channel });
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
    if (!activeCommunityId) return;

    loadShuttles();
    const socket = connectCommunitySocket(activeCommunityId, token);

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

    const onPickupClaimed = (payload: PickupClaimedEventPayload) => {
      if (!payload.passengerId || payload.passengerId !== user?._id) return;
      setPickupIntents((items) =>
        items.filter((item) => item._id !== payload.requestId)
      );
      setPreferenceAwareFeedback('Pickup successful. You have boarded.', 'ride');
    };

    const onPassengerAutoUnboarded = (payload: PassengerAutoUnboardedPayload) => {
      if (!payload.rideIds || payload.rideIds.length === 0) return;
      setOnboardDestinations((items) => items.filter((item) => !payload.rideIds!.includes(item.rideId)));
      if (user?.role === 'passenger') {
        setPreferenceAwareFeedback('You reached your destination. Unboarded automatically.', 'ride');
      }
    };

    const onCommunitySettingsUpdated = (payload?: { communityId?: string; source?: string }) => {
      if (payload?.communityId && payload.communityId !== activeCommunityId) return;
      setCommunitySyncTick((current) => current + 1);
      setPreferenceAwareFeedback('Community map settings updated. Syncing latest geofence...', 'service');
    };

    socket.on('shuttle:location-updated', onLocationUpdated);
    socket.on('shuttle:capacity-updated', onCapacityUpdated);
    socket.on('trip:pickup-intent', onPickupIntent);
    socket.on('trip:pickup-claimed', onPickupClaimed);
    socket.on('trip:passenger-auto-unboarded', onPassengerAutoUnboarded);
    socket.on('community:settings-updated', onCommunitySettingsUpdated);

    return () => {
      socket.off('shuttle:location-updated', onLocationUpdated);
      socket.off('shuttle:capacity-updated', onCapacityUpdated);
      socket.off('trip:pickup-intent', onPickupIntent);
      socket.off('trip:pickup-claimed', onPickupClaimed);
      socket.off('trip:passenger-auto-unboarded', onPassengerAutoUnboarded);
      socket.off('community:settings-updated', onCommunitySettingsUpdated);
    };
  }, [activeCommunityId, loadShuttles, setPreferenceAwareFeedback, token, user?._id, user?.role]);

  useEffect(() => {
    if (!activeCommunityId || user?.role !== 'driver') return;

    let mounted = true;

    const loadPickupIntents = async () => {
      try {
        const requests = await listPickupIntents();
        if (!mounted) return;
        setPickupIntents(requests.filter((item) => item.status === 'pending' && !isExpiredIntent(item)));
      } catch (error) {
        const now = Date.now();
        if (now - pollErrorNoticeRef.current.pickup >= POLL_ERROR_NOTICE_COOLDOWN_MS) {
          pollErrorNoticeRef.current.pickup = now;
          const message =
            error instanceof Error && error.message
              ? `Pickup refresh delayed: ${error.message}`
              : 'Pickup refresh delayed. Retrying automatically.';
          setPreferenceAwareFeedback(message, 'service');
        }
      }
    };

    loadPickupIntents();
    const timer = setInterval(loadPickupIntents, DRIVER_PICKUP_INTENTS_POLL_MS);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [activeCommunityId, setPreferenceAwareFeedback, user?.role]);

  useEffect(() => {
    if (user?.role !== 'driver' || !assignedShuttle?._id) return;
    let mounted = true;

    const loadOnboardDestinations = async () => {
      try {
        const passengers = await listOnboardDestinations(assignedShuttle._id);
        if (!mounted) return;
        setOnboardDestinations(passengers);
      } catch (error) {
        const now = Date.now();
        if (now - pollErrorNoticeRef.current.onboard >= POLL_ERROR_NOTICE_COOLDOWN_MS) {
          pollErrorNoticeRef.current.onboard = now;
          const message =
            error instanceof Error && error.message
              ? `Onboard destination refresh delayed: ${error.message}`
              : 'Onboard destination refresh delayed. Retrying automatically.';
          setPreferenceAwareFeedback(message, 'service');
        }
      }
    };

    loadOnboardDestinations();
    const timer = setInterval(loadOnboardDestinations, DRIVER_ONBOARD_DESTINATIONS_POLL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [assignedShuttle?._id, setPreferenceAwareFeedback, user?.role]);

  useEffect(() => {
    if (!activeCommunityId) return;

    let active = true;

    const loadCommunityBoundary = async () => {
      try {
        const community = await getCommunityById(activeCommunityId);
        const ring = community?.boundaries?.coordinates?.[0] || [];
        const destinationRows = (community?.fixedDestinations || []).filter((item) => item.isActive !== false);
        setFixedDestinations(destinationRows);

        const normalized = ring
          .map((point) => {
            const longitude = Number(point?.[0]);
            const latitude = Number(point?.[1]);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
            return { latitude, longitude };
          })
          .filter((point): point is LatLng => point !== null);

        if (!active) return;

        setCommunityBoundary(normalized);
        const maxZoomRegion = toMaxZoomOutRegionFromBoundary(normalized);
        if (maxZoomRegion) {
          setMaxZoomOutRegion(maxZoomRegion);
        }

        const regionFromBoundary = toRegionFromBoundary(normalized);
        if (regionFromBoundary) {
          if (user?.role === 'passenger') {
            setPassengerRegion(regionFromBoundary);
          } else {
            setDriverRegion(regionFromBoundary);
          }
        } else {
          // No boundary data — fall back to device location or default
          try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status === 'granted') {
              const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
              if (active) {
                const region = {
                  latitude: loc.coords.latitude,
                  longitude: loc.coords.longitude,
                  latitudeDelta: 0.015,
                  longitudeDelta: 0.015,
                };
                if (user?.role === 'passenger') {
                  setPassengerRegion(region);
                } else {
                  setDriverRegion(region);
                }
              }
              return;
            }
          } catch {
            if (active) {
              setPreferenceAwareFeedback('Device GPS unavailable. Showing default map region.', 'service');
            }
          }
          const defaultRegion = {
            latitude: 14.5995,
            longitude: 120.9842,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          };
          if (active) {
            if (user?.role === 'passenger') {
              setPassengerRegion(defaultRegion);
            } else {
              setDriverRegion(defaultRegion);
            }
          }
        }
      } catch (error) {
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Failed to load community boundary.';
        setPreferenceAwareFeedback(message, 'critical');
        // Still show the map even on error — use a default region
        const defaultRegion = {
          latitude: 14.5995,
          longitude: 120.9842,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        };
        if (user?.role === 'passenger') {
          setPassengerRegion(defaultRegion);
        } else {
          setDriverRegion(defaultRegion);
        }
      }
    };

    loadCommunityBoundary();
    const timer = setInterval(loadCommunityBoundary, COMMUNITY_SETTINGS_SYNC_POLL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [activeCommunityId, communitySyncTick, setPreferenceAwareFeedback, user?.role]);

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
    const timers = markerAnimTimers.current;

    return () => {
      for (const timer of Object.values(timers)) {
        if (timer) clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (driverConstraintTimer.current) clearTimeout(driverConstraintTimer.current);
      if (passengerConstraintTimer.current) clearTimeout(passengerConstraintTimer.current);
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

  const handleUnboardPassenger = async () => {
    if (!assignedShuttle) {
      setPreferenceAwareFeedback('No shuttle assigned to this driver account.', 'critical');
      return;
    }

    if (!isDriverOnShift) {
      setPreferenceAwareFeedback('Start your shift first before unboarding passengers.', 'critical');
      return;
    }

    if (assignedShuttle.currentCapacity === 0) {
      setPreferenceAwareFeedback('No passengers to unboard.', 'critical');
      return;
    }

    try {
      setUnboardingSubmitting(true);
      await unboardPassenger(assignedShuttle._id, 1);
      await loadShuttles();
      setPreferenceAwareFeedback('Passenger drop-off recorded.', 'ride');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to record drop-off.';
      setPreferenceAwareFeedback(message, 'critical');
    } finally {
      setUnboardingSubmitting(false);
    }
  };

  const syncDriverLocation = useCallback(async (options?: {
    silent?: boolean;
    coords?: LatLng;
    skipPermissionRequest?: boolean;
  }) => {
    const silent = options?.silent === true;
    if (!assignedShuttle || locationSyncInFlightRef.current) {
      return;
    }

    if (user?.role === 'driver' && user?.status !== 'driving') {
      if (!silent) {
        setPreferenceAwareFeedback('Start your shift first before syncing location.', 'critical');
      }
      return;
    }

    locationSyncInFlightRef.current = true;
    if (silent) {
      setAutoSyncStatus('syncing');
    }
    try {
      let latitude = options?.coords?.latitude;
      let longitude = options?.coords?.longitude;

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        if (!options?.skipPermissionRequest) {
          const permission = await Location.requestForegroundPermissionsAsync();
          if (permission.status !== 'granted') {
            if (!silent) {
              setPreferenceAwareFeedback('Location permission is required to sync GPS.', 'critical');
            }
            return;
          }
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        latitude = position.coords.latitude;
        longitude = position.coords.longitude;
      }

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return;
      }

      const normalizedLatitude = Number(latitude);
      const normalizedLongitude = Number(longitude);

      const locationSync = await updateShuttleLocation(
        assignedShuttle._id,
        normalizedLatitude,
        normalizedLongitude
      );
      setLastAutomationDiagnostics(locationSync.automationDiagnostics || null);

      if (locationSync.shuttle?._id) {
        setShuttles((current) =>
          current.map((item) =>
            item._id === locationSync.shuttle._id
              ? {
                ...item,
                ...locationSync.shuttle,
              }
              : item
          )
        );
      }

      const autoBoardedCount = locationSync.autoBoardedCount || 0;
      const autoUnboardedCount = locationSync.autoUnboardedCount || 0;
      setLastAutoSyncAt(new Date());
      if (silent) {
        setAutoSyncStatus('idle');
      }
      if (autoBoardedCount > 0) {
        setPreferenceAwareFeedback(
          `GPS synced. Auto-boarded ${autoBoardedCount} pickup request${autoBoardedCount > 1 ? 's' : ''}.`,
          'ride'
        );
      } else if (autoUnboardedCount > 0) {
        setPreferenceAwareFeedback(
          `GPS synced. Auto-unboarded ${autoUnboardedCount} passenger${autoUnboardedCount > 1 ? 's' : ''}.`,
          'ride'
        );
      } else if (!silent) {
        setPreferenceAwareFeedback('GPS synced successfully.', 'service');
      }
    } catch (error) {
      if (silent) {
        setAutoSyncStatus('error');
      }
      if (!silent) {
        const message = error instanceof Error ? error.message : 'Failed to sync location.';
        setPreferenceAwareFeedback(message, 'critical');
      }
    } finally {
      locationSyncInFlightRef.current = false;
    }
  }, [assignedShuttle, setPreferenceAwareFeedback, user?.role, user?.status]);

  const handleSyncLocation = async () => {
    if (!assignedShuttle) {
      setPreferenceAwareFeedback('No shuttle assigned to this driver account.', 'critical');
      return;
    }
    await syncDriverLocation({ silent: false });
  };

  useEffect(() => {
    if (user?.role !== 'driver' || !assignedShuttle || user?.status !== 'driving') return;

    // Continuous watcher for near-real-time movement updates + periodic fallback.
    let active = true;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;

    const bootDriverTracking = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setPreferenceAwareFeedback('Location permission is required for live driver tracking.', 'critical');
        return;
      }

      await syncDriverLocation({ silent: true, skipPermissionRequest: true });

      fallbackTimer = setInterval(() => {
        void syncDriverLocation({ silent: true, skipPermissionRequest: true });
      }, DRIVER_AUTO_SYNC_MS);

      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: DRIVER_WATCH_TIME_INTERVAL_MS,
          distanceInterval: DRIVER_WATCH_DISTANCE_INTERVAL_METERS,
        },
        (position) => {
          if (!active) return;

          const nextCoords: LatLng = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };

          const now = Date.now();
          const lastSync = lastContinuousSyncRef.current;
          const elapsed = lastSync ? now - lastSync.at : Number.POSITIVE_INFINITY;
          const moved = lastSync ? getDistanceMeters(lastSync.coords, nextCoords) : Number.POSITIVE_INFINITY;

          if (
            elapsed < DRIVER_CONTINUOUS_MIN_SYNC_INTERVAL_MS &&
            moved < DRIVER_CONTINUOUS_MIN_MOVE_METERS
          ) {
            return;
          }

          lastContinuousSyncRef.current = { at: now, coords: nextCoords };
          void syncDriverLocation({
            silent: true,
            coords: nextCoords,
            skipPermissionRequest: true,
          });
        }
      );

      if (!active) {
        subscription.remove();
        return;
      }

      driverLocationWatchRef.current = subscription;
    };

    void bootDriverTracking();

    return () => {
      active = false;
      if (fallbackTimer) {
        clearInterval(fallbackTimer);
      }
      if (driverLocationWatchRef.current) {
        driverLocationWatchRef.current.remove();
        driverLocationWatchRef.current = null;
      }
      lastContinuousSyncRef.current = null;
    };
  }, [assignedShuttle, setPreferenceAwareFeedback, syncDriverLocation, user?.role, user?.status]);

  const handleRequestPickup = async () => {
    if (pickupDisabled) {
      if (activePassengerPickupIntents.length > 0) {
        setPreferenceAwareFeedback('Pickup request already active. Waiting for driver confirmation.', 'ride');
      }
      return;
    }

    if (!selectedDestinationType) {
      setPreferenceAwareFeedback('Select Fixed or Home destination first.', 'critical');
      return;
    }

    if (selectedDestinationType === 'fixed' && !selectedFixedDestinationId) {
      setPreferenceAwareFeedback('Select a fixed destination first.', 'critical');
      return;
    }

    const savedHomeCoords = user?.homeDestination?.location?.coordinates;
    if (selectedDestinationType === 'home' && !hasSavedHomeDestination) {
      setPreferenceAwareFeedback('Set your Home destination in Settings first.', 'critical');
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

      const pickupIntent = await createPickupIntent(
        pickupLatitude,
        pickupLongitude,
        selectedDestinationType === 'fixed'
          ? {
            type: 'fixed',
            fixedDestinationId: selectedFixedDestinationId,
          }
          : {
            type: 'home',
            latitude: savedHomeCoords![1],
            longitude: savedHomeCoords![0],
            label: user?.homeDestination?.label || 'Home',
          }
      );
      setPickupIntents((items) => upsertPickupIntent(items, pickupIntent));
      setPreferenceAwareFeedback('Pickup request sent. Drivers in your community were notified.', 'ride');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit pickup request.';
      setPreferenceAwareFeedback(message, 'critical');
    } finally {
      setPickupSubmitting(false);
    }
  };

  const onDriverUnboard = async () => {
    if (hapticsEnabled) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    await handleUnboardPassenger();
  };



  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bgColor }]} edges={['top', 'left', 'right']}>
      <PremiumCard style={styles.topBar}>
        <SectionHeader
          title="GoShuttle"
          subtitle={`${user?.firstName} ${user?.lastName} · ${user?.role}`}
          titleColor={palette.white}
          subtitleColor="#cbd5e1"
        />
      </PremiumCard>

      {user?.role === 'driver' ? (
        <View style={styles.driverLayout}>
          <View style={styles.mapWrap}>
            {driverRegion ? (
              <MapView
                ref={driverMapRef}
                style={styles.map}
                initialRegion={driverRegion}
                scrollEnabled={true}
                zoomEnabled={true}
                rotateEnabled={false}
                pitchEnabled={false}
                toolbarEnabled={false}
                onRegionChange={(region) => {
                  // Debounce the constraint check for smooth animation
                  if (driverConstraintTimer.current) {
                    clearTimeout(driverConstraintTimer.current);
                  }
                  driverConstraintTimer.current = setTimeout(() => {
                    if (maxZoomOutRegion && (region.latitudeDelta > maxZoomOutRegion.latitudeDelta || region.longitudeDelta > maxZoomOutRegion.longitudeDelta)) {
                      if (driverMapRef.current) {
                        driverMapRef.current.animateToRegion(maxZoomOutRegion, 600);
                      }
                    }
                  }, 100);
                }}
              >
                {communityBoundary.length >= 3 ? (
                  <Polygon
                    coordinates={communityBoundary}
                    fillColor={AppPalette.navyOverlaySoft}
                    strokeColor={palette.navy}
                    strokeWidth={2}
                  />
                ) : null}

                {assignedShuttle && toShuttleCoordinate(assignedShuttle) ? (
                  <Marker
                    coordinate={toShuttleCoordinate(assignedShuttle)!}
                    title={assignedShuttle.plateNumber}
                    description={`${assignedShuttle.currentCapacity}/${assignedShuttle.maxCapacity} seated`}
                    anchor={{ x: 0.5, y: 0.5 }}
                  >
                    <MapIndicator iconName="bus" />
                  </Marker>
                ) : null}

                {pickupIntents
                  .filter((item) => item.status === 'pending' && !isExpiredIntent(item))
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
                        anchor={{ x: 0.5, y: 0.5 }}
                      >
                        <MapIndicator iconName="person" />
                      </Marker>,
                    ];
                  })}
                {onboardDestinations.map((item) => {
                  const [longitude, latitude] = item.destinationLocation.coordinates;
                  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
                  return (
                    <Marker
                      key={`destination-${item.rideId}`}
                      coordinate={{ latitude, longitude }}
                      title={item.destinationLabel}
                      description={`${item.passengerName} destination`}
                      pinColor={palette.emerald}
                    />
                  );
                })}
              </MapView>
            ) : (
              <View style={styles.mapPlaceholder}>
                <ActivityIndicator color={palette.white} size="small" />
                <ThemedText style={styles.mapPlaceholderText}>Loading Fleet Map</ThemedText>
                <ThemedText style={styles.mapPlaceholderHint}>Fetching geofence boundary</ThemedText>
              </View>
            )}

            <View style={styles.mapLockBadge}>
              <Ionicons name="lock-closed" size={12} color={palette.white} />
              <ThemedText style={styles.mapLockText}>Map Locked to Community</ThemedText>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.driverInfoScroll} showsVerticalScrollIndicator={false}>
            <PremiumCard style={[styles.driverInfoCard, { backgroundColor: surfaceColor, borderColor }]}>
              <SectionHeader
                title="Driver Operations"
                subtitle={assignedShuttle ? `Assigned: ${assignedShuttle.plateNumber} · Auto Mode` : 'No assigned shuttle'}
                rightAction={
                  <PremiumButton style={styles.iconButton} onPress={loadShuttles} variant="secondary">
                    <Ionicons name="refresh" size={18} color={tint} />
                  </PremiumButton>
                }
              />

              {assignedShuttle ? (
                <>
                  <View
                    style={[
                      styles.capacityStatusCard,
                      {
                        backgroundColor: capacityCardBackground,
                        borderColor: capacityCardBorder,
                      },
                    ]}
                  >
                    <View style={styles.capacityLeftSide}>
                      <ThemedText style={[styles.capacityLabel, { color: mutedColor }]}>Current Passengers</ThemedText>
                      <ThemedText style={[styles.capacityValue, { color: textColor }]}>
                        {assignedShuttle.currentCapacity}/{assignedShuttle.maxCapacity}
                      </ThemedText>
                    </View>
                    <View
                      style={[
                        styles.capacityIndicator,
                        {
                          backgroundColor: capacityBadgeColor(
                            assignedShuttle.currentCapacity,
                            assignedShuttle.maxCapacity
                          ),
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.statusSection}>
                    <View style={styles.rowBetween}>
                      <ThemedText style={[styles.metaText, { color: mutedColor }]}>Pickup Requests</ThemedText>
                      <ThemedText style={[styles.valueSmallText, { color: textColor }]}>{activeCommunityPickupIntents.length} active</ThemedText>
                    </View>
                    <View style={styles.rowBetween}>
                      <ThemedText style={[styles.metaText, { color: mutedColor }]}>Shift Status</ThemedText>
                      <ThemedText style={[styles.valueSmallText, { color: isDriverOnShift ? successColor : dangerColor }]}>
                        {isDriverOnShift ? 'On Shift' : 'Off Shift'}
                      </ThemedText>
                    </View>
                    <View style={styles.rowBetween}>
                      <ThemedText style={[styles.metaText, { color: mutedColor }]}>Auto Sync</ThemedText>
                      <ThemedText style={[styles.valueSmallText, { color: textColor }]}>
                        {autoSyncStatus === 'syncing'
                          ? 'Syncing...'
                          : autoSyncStatus === 'error'
                            ? 'Retrying'
                            : lastAutoSyncAt
                              ? `Last ${lastAutoSyncAt.toLocaleTimeString()}`
                              : 'Waiting'}
                      </ThemedText>
                    </View>
                  </View>

                  <View
                    style={[
                      styles.automationCard,
                      {
                        borderColor,
                        backgroundColor: colorScheme === 'dark' ? AppPalette.darkSkyBg : AppPalette.sky,
                      },
                    ]}
                  >
                    <View style={styles.rowBetween}>
                      <ThemedText style={[styles.automationTitle, { color: textColor }]}>Automation Diagnostics</ThemedText>
                      <ThemedText style={[styles.automationReliability, { color: textColor }]}>
                        Reliability {automationReliabilityScore}% ({automationReliabilityLabel})
                      </ThemedText>
                    </View>

                    <View style={styles.automationRow}>
                      <View style={[styles.automationDot, { backgroundColor: getDiagnosticColor(autoBoardDiagnostic.state) }]} />
                      <View style={styles.automationCopy}>
                        <ThemedText style={[styles.automationLabel, { color: textColor }]}>{autoBoardDiagnostic.label}</ThemedText>
                        <ThemedText style={[styles.automationDetail, { color: mutedColor }]}>{autoBoardDiagnostic.detail}</ThemedText>
                      </View>
                    </View>

                    <View style={styles.automationRow}>
                      <View style={[styles.automationDot, { backgroundColor: getDiagnosticColor(autoUnboardDiagnostic.state) }]} />
                      <View style={styles.automationCopy}>
                        <ThemedText style={[styles.automationLabel, { color: textColor }]}>{autoUnboardDiagnostic.label}</ThemedText>
                        <ThemedText style={[styles.automationDetail, { color: mutedColor }]}>{autoUnboardDiagnostic.detail}</ThemedText>
                      </View>
                    </View>
                  </View>

                  <View style={styles.quickActionRow}>
                    <PremiumButton style={styles.quickActionBtn} onPress={handleSyncLocation} variant="secondary">
                      <Ionicons name="locate-outline" size={16} color={tint} />
                      <ThemedText style={[styles.quickActionTxt, { color: tint }]}>Sync Now</ThemedText>
                    </PremiumButton>
                  </View>
                  <View style={styles.statusSection}>
                    <ThemedText style={[styles.metaText, { color: mutedColor }]}>Onboard Destination List</ThemedText>
                    {onboardDestinations.length === 0 ? (
                      <ThemedText style={[styles.metaText, { color: mutedColor }]}>No onboard passengers.</ThemedText>
                    ) : onboardDestinations.map((item) => (
                      <View key={item.rideId} style={styles.rowBetween}>
                        <ThemedText style={[styles.metaText, { color: textColor }]}>{item.passengerName}</ThemedText>
                        <ThemedText style={[styles.metaText, { color: mutedColor }]}>{item.destinationLabel}</ThemedText>
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <ThemedText style={[styles.noShuttleText, { color: dangerColor }]}> 
                  No shuttle assigned. Please contact your dispatcher.
                </ThemedText>
              )}

              {feedback ? (
                <ThemedText
                  style={[
                    styles.feedback,
                    {
                      color:
                        feedback.type === 'critical'
                          ? dangerColor
                          : successColor,
                    },
                  ]}
                >
                  {feedback.message}
                </ThemedText>
              ) : null}
            </PremiumCard>
          </ScrollView>

          {assignedShuttle && (
            <View style={styles.driverButtonRow}>
              <Pressable
                style={[
                  styles.driverActionButton,
                  { backgroundColor: palette.rose },
                  (unboardingSubmitting || assignedShuttle.currentCapacity === 0 || !isDriverOnShift) && styles.driverActionButtonDisabled,
                ]}
                onPress={onDriverUnboard}
                disabled={unboardingSubmitting || assignedShuttle.currentCapacity === 0 || !isDriverOnShift}
              >
                <Ionicons name={unboardingSubmitting ? 'time-outline' : 'remove-circle'} size={32} color={palette.white} />
                <ThemedText style={styles.driverActionButtonText}>{unboardingSubmitting ? '...' : '-1'}</ThemedText>
              </Pressable>
            </View>
          )}
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
                scrollEnabled={true}
                zoomEnabled={true}
                rotateEnabled={false}
                pitchEnabled={false}
                toolbarEnabled={false}
                onRegionChange={(region) => {
                  // Debounce the constraint check for smooth animation
                  if (passengerConstraintTimer.current) {
                    clearTimeout(passengerConstraintTimer.current);
                  }
                  passengerConstraintTimer.current = setTimeout(() => {
                    if (maxZoomOutRegion && (region.latitudeDelta > maxZoomOutRegion.latitudeDelta || region.longitudeDelta > maxZoomOutRegion.longitudeDelta)) {
                      if (mapRef.current) {
                        mapRef.current.animateToRegion(maxZoomOutRegion, 600);
                      }
                    }
                  }, 100);
                }}
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
                      anchor={{ x: 0.5, y: 0.5 }}
                    >
                      <MapIndicator iconName="bus" />
                      <Callout tooltip>
                        <View style={[styles.calloutContainer, { backgroundColor: bgColor, borderColor }]}>
                          <ThemedText type="defaultSemiBold" style={{ color: textColor, fontSize: 14 }}>
                            {item.label || item.plateNumber}
                          </ThemedText>
                          <View style={[styles.calloutSeparator, { backgroundColor: borderColor }]} />
                          <ThemedText type="caption" style={{ color: mutedColor, fontSize: 12 }}>
                            Capacity: {item.currentCapacity}/{item.maxCapacity}
                          </ThemedText>
                          <ThemedText
                            type="caption"
                            style={{
                              color: item.currentCapacity >= item.maxCapacity ? '#ef4444' : '#10b981',
                              fontSize: 12,
                              marginTop: 4,
                            }}
                          >
                            {item.currentCapacity >= item.maxCapacity ? 'Full' : `${Math.max(0, item.maxCapacity - item.currentCapacity)} seats available`}
                          </ThemedText>
                        </View>
                      </Callout>
                    </Marker>
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
                        anchor={{ x: 0.5, y: 0.5 }}
                      >
                        <MapIndicator iconName="person" />
                      </Marker>,
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

              <View style={[styles.fleetStatCard, { 
                backgroundColor: colorScheme === 'dark' ? surfaceColor : tint,
                borderColor: colorScheme === 'dark' ? borderColor : 'transparent',
                borderWidth: colorScheme === 'dark' ? 1 : 0,
              }]}>
                <View style={[styles.fleetStatIconWrap, { 
                  backgroundColor: colorScheme === 'dark' ? borderColor : 'rgba(255, 255, 255, 0.2)'
                }]}>
                  <Ionicons name="bus" size={28} color={colorScheme === 'dark' ? tint : palette.white} />
                </View>
                <View style={styles.fleetStatTextWrap}>
                  <ThemedText style={[styles.fleetStatLabel, { color: colorScheme === 'dark' ? mutedColor : palette.white }]}>Active Fleet (On Shift)</ThemedText>
                  <ThemedText style={[styles.fleetStatValue, { color: colorScheme === 'dark' ? textColor : palette.white }]}>{passengerStats.activeShiftCount}</ThemedText>
                </View>
              </View>

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

              <View style={styles.passengerStatsRow}>
                <Pressable
                  style={[
                    styles.passengerStatPill,
                    { borderColor, backgroundColor: bgColor },
                    selectedDestinationType === 'fixed' && {
                      borderColor: tint,
                      backgroundColor: colorScheme === 'dark' ? AppPalette.darkSkyBg : AppPalette.sky,
                    },
                  ]}
                  onPress={() => setSelectedDestinationType('fixed')}
                >
                  <Ionicons name="flag-outline" size={14} color={selectedDestinationType === 'fixed' ? tint : mutedColor} />
                  <ThemedText style={[styles.passengerStatText, { color: textColor }]}>Fixed</ThemedText>
                </Pressable>
                <Pressable
                  style={[
                    styles.passengerStatPill,
                    { borderColor, backgroundColor: bgColor },
                    selectedDestinationType === 'home' && {
                      borderColor: successColor,
                      backgroundColor: colorScheme === 'dark' ? AppPalette.darkMintBg : AppPalette.mint,
                    },
                  ]}
                  onPress={() => setSelectedDestinationType('home')}
                >
                  <Ionicons name="home-outline" size={14} color={selectedDestinationType === 'home' ? successColor : mutedColor} />
                  <ThemedText style={[styles.passengerStatText, { color: textColor }]}>Home</ThemedText>
                </Pressable>
              </View>

              <View style={styles.passengerStatsRow}>
                <View style={[styles.passengerStatPill, { borderColor, backgroundColor: bgColor }]}>
                  <Ionicons name="play-circle-outline" size={14} color={successColor} />
                  <ThemedText style={[styles.passengerStatText, { color: textColor }]}>On Shift: {passengerStats.activeShiftCount}</ThemedText>
                </View>
                <View style={[styles.passengerStatPill, { borderColor, backgroundColor: bgColor }]}>
                  <Ionicons name="pause-circle-outline" size={14} color={mutedColor} />
                  <ThemedText style={[styles.passengerStatText, { color: textColor }]}>Off Shift: {passengerStats.offShiftCount}</ThemedText>
                </View>
              </View>

              {selectedDestinationType === 'fixed' ? (
                <View style={styles.statusSection}>
                  <ThemedText style={[styles.metaText, { color: mutedColor }]}>Select destination</ThemedText>
                  {fixedDestinations.length === 0 ? (
                    <ThemedText style={[styles.metaText, { color: dangerColor }]}>No fixed destinations configured by admin yet.</ThemedText>
                  ) : null}
                  {fixedDestinations.map((item) => (
                    <Pressable
                      key={item._id}
                      style={[
                        styles.passengerStatPill,
                        { borderColor, backgroundColor: bgColor },
                        selectedFixedDestinationId === item._id && { borderColor: tint },
                      ]}
                      onPress={() => setSelectedFixedDestinationId(item._id)}
                    >
                      <ThemedText style={[styles.passengerStatText, { color: textColor }]}>{item.name}</ThemedText>
                    </Pressable>
                  ))}
                </View>
              ) : selectedDestinationType === 'home' ? (
                <ThemedText style={[styles.metaText, { color: mutedColor }]}>Home destination uses your GPS location.</ThemedText>
              ) : (
                <ThemedText style={[styles.metaText, { color: mutedColor }]}>Choose Fixed or Home before requesting pickup.</ThemedText>
              )}

              <View
                style={[
                  styles.destinationIndicatorCard,
                  {
                    borderColor: selectedDestinationAccentColor,
                    backgroundColor: selectedDestinationCardBackground,
                  },
                ]}
              >
                <Ionicons
                  name={
                    selectedDestinationType === 'home'
                      ? 'home-outline'
                      : selectedDestinationType === 'fixed'
                        ? 'flag-outline'
                        : 'navigate-outline'
                  }
                  size={14}
                  color={selectedDestinationAccentColor}
                />
                <View style={styles.destinationIndicatorCopy}>
                  <ThemedText style={[styles.destinationIndicatorLabel, { color: selectedDestinationAccentColor }]}>Selected Destination</ThemedText>
                  <ThemedText style={[styles.destinationIndicatorValue, { color: textColor }]}>{selectedDestinationSummary}</ThemedText>
                </View>
              </View>

              {passengerFleet.slice(0, 4).map((item) => (
                <View key={item._id} style={[styles.shuttleRow, { borderColor, backgroundColor: surfaceColor }]}>
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
                            backgroundColor: getShuttleDriverStatus(item.driverId) === 'driving' ? successColor : mutedColor,
                          },
                        ]}
                      />
                      <ThemedText style={[styles.shuttleEtaText, { color: mutedColor }]}> 
                        {getShuttleDriverStatus(item.driverId) === 'driving' ? 'On Shift' : 'Not on shift'}
                      </ThemedText>
                    </View>
                    {showEta ? (
                      <ThemedText style={[styles.shuttleEtaText, { color: mutedColor }]}>ETA: live tracking</ThemedText>
                    ) : null}
                  </View>
                </View>
              ))}

              <Pressable
                style={[
                  styles.passengerPrimaryButton,
                  (pickupDisabled || !isDestinationReady) && styles.passengerPrimaryButtonDisabled,
                  { backgroundColor: pickupCtaBg },
                ]}
                onPress={handleRequestPickup}
                disabled={pickupDisabled || !isDestinationReady || (selectedDestinationType === 'fixed' && fixedDestinations.length === 0)}
              >
                <Ionicons
                  name={pickupSubmitting ? 'time-outline' : 'navigate'}
                  size={18}
                  color={palette.white}
                />
                <ThemedText style={styles.passengerPrimaryText}>
                  {!selectedDestinationType
                    ? 'Select Destination'
                    : pickupSubmitting
                    ? 'Sending Pickup...'
                    : activePassengerPickupIntents.length > 0
                      ? 'Pickup Active'
                      : 'Request Pickup'}
                </ThemedText>
              </Pressable>

              {activePassengerPickupIntents.length > 0 ? (
                <View
                  style={[
                    styles.pickupStatusCard,
                    {
                      borderColor: colorScheme === 'dark' ? dangerColor : AppPalette.dangerMutedBorder,
                      backgroundColor: colorScheme === 'dark' ? AppPalette.dangerOverlaySoft : AppPalette.dangerMutedBackground,
                    },
                  ]}
                >
                  <Ionicons name="radio-outline" size={14} color={palette.rose} />
                  <View style={styles.pickupStatusCopy}>
                    <ThemedText
                      style={[
                        styles.pickupStatusText,
                        { color: colorScheme === 'dark' ? dangerColor : AppPalette.dangerStrongText },
                      ]}
                    >
                      Drivers can see your request now. Status updates automatically once boarded.
                    </ThemedText>
                    <View style={styles.pickupDestinationRow}>
                      <Ionicons
                        name={activePickupDestinationType === 'home' ? 'home-outline' : 'flag-outline'}
                        size={12}
                        color={activePickupDestinationAccent}
                      />
                      <ThemedText
                        style={[
                          styles.pickupStatusMeta,
                          { color: activePickupDestinationAccent },
                        ]}
                      >
                        Destination: {activePickupDestinationSummary || selectedDestinationSummary}
                      </ThemedText>
                    </View>
                  </View>
                </View>
              ) : null}

              {feedback ? (
                <ThemedText
                  style={[
                    styles.feedback,
                    {
                      color:
                        feedback.type === 'critical'
                          ? dangerColor
                          : successColor,
                    },
                  ]}
                >
                  {feedback.message}
                </ThemedText>
              ) : null}
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
    fontFamily: OutfitFonts.extraBold,
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
  driverLayout: {
    flex: 1,
    gap: 0,
  },
  driverInfoScroll: {
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
    gap: DesignTokens.spacing.sm,
    flexGrow: 1,
  },
  driverInfoCard: {
    gap: DesignTokens.spacing.sm,
  },
  statusSection: {
    gap: DesignTokens.spacing.xs,
  },
  separator: {
    height: 1,
    marginVertical: DesignTokens.spacing.xs,
  },
  valueSmallText: {
    fontSize: 16,
    fontFamily: OutfitFonts.bold,
  },
  noShuttleText: {
    fontFamily: OutfitFonts.semiBold,
    textAlign: 'center',
    marginVertical: DesignTokens.spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: OutfitFonts.bold,
    color: palette.navy,
  },
  valueText: {
    fontSize: 30,
    lineHeight: 36,
    fontFamily: OutfitFonts.extraBold,
    color: palette.navy,
  },
  metaText: {
    color: palette.slateText,
    fontSize: 14,
    fontFamily: OutfitFonts.semiBold,
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
    fontFamily: OutfitFonts.bold,
  },
  iconButton: {
    minHeight: 40,
    minWidth: 40,
    paddingHorizontal: DesignTokens.spacing.xs,
  },
  driverButtonRow: {
    flexDirection: 'row',
    gap: DesignTokens.spacing.sm,
    marginHorizontal: DesignTokens.spacing.sm,
    marginVertical: DesignTokens.spacing.sm,
  },
  driverActionButton: {
    flex: 1,
    minHeight: 96,
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
  driverActionButtonDisabled: {
    opacity: 0.5,
  },
  driverActionButtonText: {
    color: palette.white,
    fontSize: 28,
    fontFamily: OutfitFonts.extraBold,
    letterSpacing: 0.6,
  },
  capacityStatusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: DesignTokens.spacing.sm,
    paddingHorizontal: DesignTokens.spacing.sm,
    borderRadius: DesignTokens.radius.lg,
    borderWidth: 1,
  },
  capacityLeftSide: {
    flex: 1,
  },
  capacityLabel: {
    fontSize: 12,
    fontFamily: OutfitFonts.semiBold,
    marginBottom: DesignTokens.spacing.xxs,
  },
  capacityValue: {
    fontSize: 28,
    fontFamily: OutfitFonts.extraBold,
    lineHeight: 32,
  },
  capacityIndicator: {
    width: 64,
    height: 64,
    borderRadius: DesignTokens.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  automationCard: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.lg,
    paddingVertical: DesignTokens.spacing.xs,
    paddingHorizontal: DesignTokens.spacing.sm,
    gap: DesignTokens.spacing.xs,
  },
  automationTitle: {
    fontSize: 12,
    fontFamily: OutfitFonts.extraBold,
    letterSpacing: 0.4,
  },
  automationReliability: {
    fontSize: 11,
    fontFamily: OutfitFonts.bold,
  },
  automationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: DesignTokens.spacing.xs,
  },
  automationDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
  },
  automationCopy: {
    flex: 1,
    gap: 2,
  },
  automationLabel: {
    fontSize: 13,
    fontFamily: OutfitFonts.bold,
  },
  automationDetail: {
    fontSize: 12,
    fontFamily: OutfitFonts.semiBold,
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
    fontFamily: OutfitFonts.extraBold,
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
    fontFamily: OutfitFonts.bold,
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
  fleetStatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.sm,
    padding: DesignTokens.spacing.sm,
    borderRadius: DesignTokens.radius.lg,
    minHeight: 80,
  },
  fleetStatIconWrap: {
    width: 56,
    height: 56,
    borderRadius: DesignTokens.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fleetStatTextWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  fleetStatLabel: {
    fontSize: 12,
    fontFamily: OutfitFonts.semiBold,
  },
  fleetStatValue: {
    fontSize: 32,
    fontFamily: OutfitFonts.extraBold,
    lineHeight: 38,
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
    gap: 6,
  },
  shuttleStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
    fontFamily: OutfitFonts.extraBold,
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
    fontFamily: OutfitFonts.bold,
    fontSize: 12,
  },
  destinationIndicatorCard: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingVertical: DesignTokens.spacing.xs,
    paddingHorizontal: DesignTokens.spacing.xs,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
  },
  destinationIndicatorCopy: {
    flex: 1,
    gap: 2,
  },
  destinationIndicatorLabel: {
    fontSize: 11,
    fontFamily: OutfitFonts.bold,
  },
  destinationIndicatorValue: {
    fontSize: 12,
    fontFamily: OutfitFonts.semiBold,
  },
  pickupStatusCard: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingVertical: DesignTokens.spacing.xs,
    paddingHorizontal: DesignTokens.spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
    minHeight: 48,
  },
  pickupStatusCopy: {
    flex: 1,
    gap: 2,
  },
  pickupDestinationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pickupStatusText: {
    fontFamily: OutfitFonts.bold,
    fontSize: 12,
  },
  pickupStatusMeta: {
    fontFamily: OutfitFonts.semiBold,
    fontSize: 11,
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
    fontFamily: OutfitFonts.bold,
    color: palette.navy,
  },
  summaryText: {
    color: palette.slateText,
  },
  summaryRevenue: {
    color: palette.emerald,
    fontFamily: OutfitFonts.extraBold,
  },
  calloutContainer: {
    backgroundColor: palette.white,
    borderRadius: DesignTokens.radius.md,
    padding: DesignTokens.spacing.sm,
    minWidth: 160,
    borderWidth: 1,
  },
  calloutSeparator: {
    height: 1,
    marginVertical: DesignTokens.spacing.xs,
  },
  mapIndicatorWrapper: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapIndicatorBubble: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#94a3b8',
    backgroundColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 1.5,
    elevation: 1,
  },
});
