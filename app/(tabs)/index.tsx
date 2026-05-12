import { HowToBookModal } from '@/components/HowToBookModal';
import { ThemedText } from '@/components/themed-text';
import { MapIndicator, MapLoadingPlaceholder } from '@/components/ui/home-map-primitives';
import {
    FixedDestinationChip,
    type FixedDestinationOption,
} from '@/components/ui/home-screen-primitives';
import { PremiumButton } from '@/components/ui/premium-button';
import { SectionHeader } from '@/components/ui/section-header';
import { StatusBanner } from '@/components/ui/status-banner';
import { AppPalette, getCapacityColor } from '@/constants/app-ui';
import { DesignTokens, OutfitFonts, SemanticColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { getCommunityById, getPhaseGeofences, type PhaseGeofence } from '@/services/community';
import { syncOfflineBoardings } from '@/services/offline-boarding-queue';
import {
    AutomationDiagnostics,
    listShuttles,
    Shuttle,
    updateShuttleLocation,
} from '@/services/shuttle';
import { connectCommunitySocket } from '@/services/socket';
import {
    AssignedShuttle,
    boardPassenger,
    cancelPickupIntent,
    createPickupIntent,
    listOnboardDestinations,
    listPickupIntents,
    OnboardDestinationPassenger,
    PickupIntent,
    QueueReason,
    unboardPassenger
} from '@/services/trip';
import { getMyDiscountVerification } from '@/services/user';
import { formatPhaseLabel, formatShuttleLabel } from '@/utils/format';


import { useAuthStore } from '@/store/auth';
import { usePreferencesStore } from '@/store/preferences';
import {
    describeBoardingReason,
    describeUnboardingReason,
    detectPhaseFromCoordinates,
    detectPickupOrigin,
    getDistanceMeters,
    getPickupIntentCoordinate,
    isExpiredIntent,
    type PickupIntentEventPayload,
    type PickupOriginContext,
    toMaxZoomOutRegionFromBoundary,
    toPickupIntent,
    toRegionFromBoundary,
    toShuttleCoordinate,
    upsertPickupIntent
} from '@/utils/home-screen';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
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
const AUTOMATION_STALE_MULTIPLIER = 2;
const MANUAL_AUTOMATION_COOLDOWN_MS = 15_000;
const DRIVER_PICKUP_RADIUS_METERS = 80;
const DRIVER_DROPOFF_RADIUS_METERS = 80;

type ManifestDraftEntry = {
  id: string;
  name: string;
  discountType: 'student' | 'pwd' | 'senior' | 'none';
};

type SelfPassengerEntry = {
  id: string;
  name: string;
  passengerId?: string;
  discountType: 'student' | 'pwd' | 'senior' | 'none';
  isOwner: boolean;
};

type CommunityDiscountSettings = {
  studentDiscount: number;
  pwdDiscount: number;
  seniorDiscount: number;
};

const palette = {
  navy: AppPalette.navy,
  emerald: AppPalette.success,
  slateBg: AppPalette.slateBg,
  slateBorder: AppPalette.slateBorder,
  slateText: AppPalette.slateText,
  white: AppPalette.white,
  rose: AppPalette.danger,
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

type PickupCancelledEventPayload = {
  requestId?: string;
  passengerId?: string;
  status?: string;
  cancelledBy?: string;
  cancelledAt?: string;
};

type SocketErrorEventPayload = {
  error?: string;
  message?: string;
};

type AutomationDiagnostic = {
  state: 'ready' | 'waiting' | 'blocked';
  label: string;
  detail: string;
};

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

type MapMarkerRef = ComponentRef<typeof Marker>;

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
  const capacityCardBorder = colorScheme === 'dark' ? successColor : SemanticColors.successLight;
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
  const [pickupCancelling, setPickupCancelling] = useState(false);
  const [boardingSubmitting, setBoardingSubmitting] = useState(false);
  const [unboardingSubmitting, setUnboardingSubmitting] = useState(false);
  const [selectedDestinationType, setSelectedDestinationType] = useState<'fixed' | 'home' | null>(null);
  const [selectedFixedDestinationId, setSelectedFixedDestinationId] = useState('');
  const [fixedDestinations, setFixedDestinations] = useState<FixedDestinationOption[]>([]);
  const [pickupOriginContext, setPickupOriginContext] = useState<PickupOriginContext | null>(null);
  const [bookForOthers, setBookForOthers] = useState(false);
  const [rideNote, setRideNote] = useState('');
  const [pickupSearchQuery, setPickupSearchQuery] = useState('');
  const [manifestDraft, setManifestDraft] = useState<ManifestDraftEntry[]>([
    { id: 'guest-1', name: '', discountType: 'none' },
  ]);
  const [guestPickupType, setGuestPickupType] = useState<'fixed' | 'home' | null>(null);
  const [guestPickupFixedId, setGuestPickupFixedId] = useState<string>('');
  const [guestDropoffType, setGuestDropoffType] = useState<'fixed' | 'home' | null>(null);
  const [guestDropoffFixedId, setGuestDropoffFixedId] = useState<string>('');
  const [communitySyncTick, setCommunitySyncTick] = useState(0);
  const [activePassengerManualBoardCount, setActivePassengerManualBoardCount] = useState(0);
  const [onboardDestinations, setOnboardDestinations] = useState<OnboardDestinationPassenger[]>([]);
  const [autoSyncStatus, setAutoSyncStatus] = useState<'idle' | 'syncing' | 'error'>('idle');
  const [lastAutoSyncAt, setLastAutoSyncAt] = useState<Date | null>(null);
  const [lastAutomationDiagnostics, setLastAutomationDiagnostics] = useState<AutomationDiagnostics | null>(null);
  const [isManualAutomationCooldownActive, setIsManualAutomationCooldownActive] = useState(false);
  const [markerCoordinates, setMarkerCoordinates] = useState<Record<string, LatLng>>({});
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<MapView | null>(null);
  const driverMapRef = useRef<MapView | null>(null);
  const driverConstraintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passengerConstraintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markerRefs = useRef<Record<string, MapMarkerRef | null>>({});
  const previousMarkerCoords = useRef<Record<string, LatLng>>({});
  const markerAnimTimers = useRef<Record<string, ReturnType<typeof setTimeout> | null>>({});
  const locationSyncInFlightRef = useRef(false);
  const driverLocationWatchRef = useRef<Location.LocationSubscription | null>(null);
  const driverFallbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const manualAutomationCooldownUntilRef = useRef(0);
  const manualAutomationCooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastContinuousSyncRef = useRef<{ at: number; coords: LatLng } | null>(null);
  const pollErrorNoticeRef = useRef<{ pickup: number; onboard: number }>({
    pickup: 0,
    onboard: 0,
  });
  const offlineSyncNoticeRef = useRef(0);
  const recentPickupCancelEventRef = useRef<{ requestId: string; at: number } | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const pickupOriginDetectionKeyRef = useRef('');

  // ── Dispatch state (passenger-only) ───────────────────────────────────────
  const [fareType, setFareType] = useState<'standard' | 'priority'>('standard');
  const [passengerCount, setPassengerCount] = useState(1);
  const [selfPassengerDraft, setSelfPassengerDraft] = useState<SelfPassengerEntry[]>([]);
  const [dispatchedShuttle, setDispatchedShuttle] = useState<AssignedShuttle | null>(null);
  const [queueNotice, setQueueNotice] = useState<{
    position: number | null;
    reason: QueueReason | null;
    message: string;
  } | null>(null);

  const queueReasonMessage = useCallback((reason: QueueReason | null) => {
    if (reason === 'no_shuttles_on_duty') {
      return 'No shuttles are on duty right now. You’ll be dispatched automatically when a driver starts.';
    }
    if (reason === 'dispatch_race') {
      return 'A seat was taken just before assignment. Retrying — you should hear back shortly.';
    }
    if (reason === 'all_shuttles_full') {
      return 'All shuttles are full. You’ll be notified and auto-dispatched when a seat opens.';
    }
    return 'You are in the queue and will be dispatched when a shuttle is available.';
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;
    });

    return () => subscription.remove();
  }, []);

  const isAppActive = useCallback(() => appStateRef.current === 'active', []);

  const [communityFares, setCommunityFares] = useState<{ base: number; priorityMultiplier: number } | null>(null);
  const [communityDiscounts, setCommunityDiscounts] = useState<CommunityDiscountSettings>({
    studentDiscount: 0,
    pwdDiscount: 0,
    seniorDiscount: 0,
  });
  const [ownerVerifiedDiscountType, setOwnerVerifiedDiscountType] = useState<'student' | 'pwd' | 'senior' | 'none'>('none');
  const [phaseGeofences, setPhaseGeofences] = useState<PhaseGeofence[]>([]);
  const [opsBypassMode, setOpsBypassMode] = useState(false);
  const [showHowToBookModal, setShowHowToBookModal] = useState(false);
  const [dismissedWarningIds, setDismissedWarningIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user || bookForOthers) return;

    setSelfPassengerDraft((current) => {
      const ownerName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Me';
      const next: SelfPassengerEntry[] = [];

      for (let i = 0; i < passengerCount; i += 1) {
        if (i === 0) {
          next.push({
            id: 'self-owner',
            name: ownerName,
            passengerId: user._id,
            discountType: ownerVerifiedDiscountType,
            isOwner: true,
          });
          continue;
        }

        const existing = current[i];
        next.push({
          id: existing?.id || `self-companion-${i}`,
          name: existing?.name || `Companion ${i}`,
          discountType: existing?.discountType || 'none',
          isOwner: false,
        });
      }

      return next;
    });
  }, [user, passengerCount, bookForOthers, ownerVerifiedDiscountType]);

  useEffect(() => {
    if (user?.role !== 'passenger') {
      setOwnerVerifiedDiscountType('none');
      return;
    }

    let active = true;
    const loadOwnerDiscountStatus = async () => {
      try {
        const verification = await getMyDiscountVerification();
        if (!active) return;
        if (verification.status === 'approved' && verification.discountType) {
          setOwnerVerifiedDiscountType(verification.discountType);
          return;
        }
        setOwnerVerifiedDiscountType('none');
      } catch {
        if (active) setOwnerVerifiedDiscountType('none');
      }
    };

    loadOwnerDiscountStatus();
    return () => {
      active = false;
    };
  }, [user?.role]);

  useEffect(() => {
    async function loadDismissedWarnings() {
      try {
        const raw = await AsyncStorage.getItem('@dismissed_warnings');
        if (raw) setDismissedWarningIds(new Set(JSON.parse(raw)));
      } catch { /* ignore */ }
    }
    loadDismissedWarnings();
  }, []);

  const handleDismissWarning = useCallback(async (warningId: string) => {
    const next = new Set(dismissedWarningIds);
    next.add(warningId);
    setDismissedWarningIds(next);
    try {
      await AsyncStorage.setItem('@dismissed_warnings', JSON.stringify([...next]));
    } catch { /* ignore */ }
  }, [dismissedWarningIds]);

  useEffect(() => {
    async function checkHowToBook() {
      if (user?.role === 'passenger') {
        const seen = await AsyncStorage.getItem('@how_to_book_seen');
        if (!seen) {
          setShowHowToBookModal(true);
        }
      }
    }
    checkHowToBook();
  }, [user?.role]);

  const activePassengerPickupIntents = useMemo(
    () =>
      pickupIntents.filter(
        (item) =>
          item.passengerId === user?._id &&
          ['pending', 'claimed', 'queued', 'dispatched'].includes(item.status)
      ),
    [pickupIntents, user?._id]
  );

  const activePassengerPickupRequest = activePassengerPickupIntents[0] ?? null;
  const activePassengerPickupRequestCount = Math.max(
    1,
    activePassengerPickupRequest?.passengerManifest?.length || 1
  );
  const activePassengerPickupCoordinate = activePassengerPickupRequest
    ? getPickupIntentCoordinate(activePassengerPickupRequest)
    : null;
  const activePassengerDropoffCoordinate = activePassengerPickupRequest?.destinationLocation?.coordinates?.length === 2
    ? {
        latitude: activePassengerPickupRequest.destinationLocation.coordinates[1],
        longitude: activePassengerPickupRequest.destinationLocation.coordinates[0],
      }
    : null;

  const activeCommunityId = user?.communityId ?? null;

  const assignedShuttle: Shuttle | null = user?.role === 'driver'
    ? (shuttles.find((s) =>
        (typeof s.driverId === 'object' && s.driverId !== null && s.driverId._id === user._id) ||
        s.driverId === user._id
      ) ?? null)
    : null;

  const assignedShuttleId = assignedShuttle?._id;

  const isDriverOnShift = user?.status === 'driving';

  const hasSavedHomeDestination = Boolean(
    user?.homeDestination?.location?.coordinates?.length === 2
  );

  const allowedPickupDestinationTypes: Array<'fixed' | 'home'> =
    pickupOriginContext?.type === 'home'
      ? ['fixed']
      : pickupOriginContext?.type === 'fixed'
        ? ['home']
        : ['fixed', 'home'];

  const assignedShuttleCoordinate = assignedShuttle?.location?.coordinates?.length === 2
    ? {
        latitude: assignedShuttle.location.coordinates[1],
        longitude: assignedShuttle.location.coordinates[0],
      }
    : null;
  const activePassengerPickupDistanceMeters = assignedShuttleCoordinate && activePassengerPickupCoordinate
    ? getDistanceMeters(assignedShuttleCoordinate, activePassengerPickupCoordinate)
    : null;
  const activePassengerDropoffDistanceMeters = assignedShuttleCoordinate && activePassengerDropoffCoordinate
    ? getDistanceMeters(assignedShuttleCoordinate, activePassengerDropoffCoordinate)
    : null;

  // ETA for passenger: find the dispatched shuttle's live location from the shuttles list
  const dispatchedShuttleLiveCoord = useMemo(() => {
    if (!dispatchedShuttle) return null;
    const live = shuttles.find((s) => s._id === dispatchedShuttle.shuttleId);
    if (live?.location?.coordinates?.length === 2) {
      return { latitude: live.location.coordinates[1], longitude: live.location.coordinates[0] };
    }
    if (dispatchedShuttle.location?.coordinates?.length === 2) {
      return { latitude: dispatchedShuttle.location.coordinates[1], longitude: dispatchedShuttle.location.coordinates[0] };
    }
    return null;
  }, [dispatchedShuttle, shuttles]);

  const dispatchedShuttleEtaMinutes = useMemo(() => {
    if (!dispatchedShuttleLiveCoord || !activePassengerPickupCoordinate) return null;
    const distM = getDistanceMeters(dispatchedShuttleLiveCoord, activePassengerPickupCoordinate);
    return Math.max(1, Math.round(distM / 500));
  }, [dispatchedShuttleLiveCoord, activePassengerPickupCoordinate]);
  const isWithinPickupRadius =
    activePassengerPickupDistanceMeters !== null && activePassengerPickupDistanceMeters <= DRIVER_PICKUP_RADIUS_METERS;
  const isWithinDropoffRadius =
    activePassengerDropoffDistanceMeters !== null && activePassengerDropoffDistanceMeters <= DRIVER_DROPOFF_RADIUS_METERS;
  const remainingManualPickupSlots = Math.max(0, activePassengerPickupRequestCount - activePassengerManualBoardCount);
  const activePassengerPickupFitsCapacity = Boolean(
    assignedShuttle && assignedShuttle.currentCapacity + activePassengerPickupRequestCount <= assignedShuttle.maxCapacity
  );
  const activePassengerPickupVisible = Boolean(
    activePassengerPickupRequest && remainingManualPickupSlots > 0 && activePassengerPickupFitsCapacity
  );
  const activeDropoffPassengers = useMemo(
    () =>
      assignedShuttleCoordinate
        ? onboardDestinations.filter((item) => {
            const destinationCoordinates = item.destinationLocation?.coordinates;
            if (!destinationCoordinates || destinationCoordinates.length !== 2) return false;

            const destinationPoint = {
              latitude: destinationCoordinates[1],
              longitude: destinationCoordinates[0],
            };

            return getDistanceMeters(assignedShuttleCoordinate, destinationPoint) <= DRIVER_DROPOFF_RADIUS_METERS;
          })
        : [],
    [assignedShuttleCoordinate, onboardDestinations]
  );
  const activeDropoffPassengerCount = activeDropoffPassengers.length;

  useEffect(() => {
    setActivePassengerManualBoardCount(0);
  }, [activePassengerPickupRequest?._id]);

  const activePickupDestinationSummary = useMemo(() => {
    const activeIntent = activePassengerPickupIntents[0];
    if (!activeIntent) return null;

    return `${activeIntent.destinationType === 'home' ? 'Home' : 'Fixed'} - ${activeIntent.destinationLabel}`;
  }, [activePassengerPickupIntents]);

  const selectedDestinationSummary = useMemo(() => {
    if (selectedDestinationType === 'home') {
      return user?.homeDestination?.label || 'Saved Home';
    }
    if (selectedDestinationType === 'fixed') {
      const found = fixedDestinations.find((d) => d._id === selectedFixedDestinationId);
      return found?.name || '';
    }
    return '';
  }, [fixedDestinations, selectedDestinationType, selectedFixedDestinationId, user?.homeDestination?.label]);

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
  const activePickupManifestSummary = useMemo(() => {
    const manifest = activePassengerPickupIntents[0]?.passengerManifest || [];
    if (manifest.length === 0) return null;

    return manifest
      .map((entry) => entry.name || 'Guest')
      .join(', ');
  }, [activePassengerPickupIntents]);

  const manifestSummary = useMemo(() => {
    const filledEntries = manifestDraft
      .map((entry) => entry.name.trim())
      .filter((name) => name.length > 0);

    if (filledEntries.length === 0) return null;

    return filledEntries.map((name) => name || 'Guest').join(', ');
  }, [manifestDraft]);

  const normalizedPassengerManifest = useMemo(
    () =>
      manifestDraft
        .map((entry) => ({ name: entry.name.trim() }))
        .filter((entry) => entry.name.length > 0),
    [manifestDraft]
  );

  // The total number of seats being reserved in the current booking flow
  const farePassengerCount = useMemo(() => {
    if (bookForOthers) {
      // For guest bookings, count filled manifest entries (min 1 so UI always shows something)
      return Math.max(1, normalizedPassengerManifest.length);
    }
    return passengerCount;
  }, [bookForOthers, normalizedPassengerManifest.length, passengerCount]);

  const regularBookingFareBreakdown = useMemo(() => {
    if (bookForOthers || !communityFares || selfPassengerDraft.length === 0) {
      return null;
    }

    const perSeatBase = fareType === 'priority'
      ? communityFares.base * communityFares.priorityMultiplier
      : communityFares.base;

    const discountPctFor = (discountType: SelfPassengerEntry['discountType']) => {
      if (discountType === 'student') return communityDiscounts.studentDiscount;
      if (discountType === 'pwd') return communityDiscounts.pwdDiscount;
      if (discountType === 'senior') return communityDiscounts.seniorDiscount;
      return 0;
    };

    const rows = selfPassengerDraft.map((entry) => {
      const discountPct = discountPctFor(entry.discountType);
      const finalFare = discountPct > 0
        ? Number((perSeatBase * (1 - discountPct / 100)).toFixed(2))
        : Number(perSeatBase.toFixed(2));
      return {
        id: entry.id,
        label: entry.isOwner ? `${entry.name} (You)` : entry.name,
        discountType: entry.discountType,
        discountPct,
        finalFare,
      };
    });

    const total = Number(rows.reduce((sum, row) => sum + row.finalFare, 0).toFixed(2));

    return {
      rows,
      total,
    };
  }, [bookForOthers, communityDiscounts, communityFares, fareType, selfPassengerDraft]);

  const guestBookingFareBreakdown = useMemo(() => {
    if (!bookForOthers || !communityFares || normalizedPassengerManifest.length === 0) {
      return null;
    }

    const perSeatBase = fareType === 'priority'
      ? communityFares.base * communityFares.priorityMultiplier
      : communityFares.base;

    const discountPctFor = (discountType: ManifestDraftEntry['discountType']) => {
      if (discountType === 'student') return communityDiscounts.studentDiscount;
      if (discountType === 'pwd') return communityDiscounts.pwdDiscount;
      if (discountType === 'senior') return communityDiscounts.seniorDiscount;
      return 0;
    };

    const rows = manifestDraft
      .filter((entry) => entry.name.trim().length > 0)
      .map((entry, idx) => {
        const discountPct = discountPctFor(entry.discountType);
        const finalFare = discountPct > 0
          ? Number((perSeatBase * (1 - discountPct / 100)).toFixed(2))
          : Number(perSeatBase.toFixed(2));

        return {
          id: entry.id,
          label: entry.name.trim() || `Guest ${idx + 1}`,
          discountType: entry.discountType,
          discountPct,
          finalFare,
        };
      });

    if (rows.length === 0) return null;

    const total = Number(rows.reduce((sum, row) => sum + row.finalFare, 0).toFixed(2));

    return {
      rows,
      total,
    };
  }, [bookForOthers, communityDiscounts, communityFares, fareType, manifestDraft, normalizedPassengerManifest.length]);

  // When booking for others, ensure the guest pickup/dropoff types are opposite
  useEffect(() => {
    if (!bookForOthers) return;
    if (guestPickupType === 'fixed' && guestDropoffType === 'fixed') {
      setGuestDropoffType('home');
    }
    if (guestPickupType === 'home' && guestDropoffType === 'home') {
      setGuestDropoffType('fixed');
    }
  }, [bookForOthers, guestPickupType, guestDropoffType]);

  const pickupOriginCopy = useMemo(() => {
    if (user?.role !== 'passenger') return '';

    if (!pickupOriginContext) {
      return '';
    }

    if (pickupOriginContext.type === 'home') {
      return `Pickup detected at ${pickupOriginContext.label}. Only fixed destinations are shown.`;
    }

    if (pickupOriginContext.type === 'fixed') {
      return `Pickup detected at ${pickupOriginContext.label}. Only home destinations are shown.`;
    }

    return '';
  }, [pickupOriginContext, user?.role]);

  const canUsePickupDestinationType = useCallback(
    (type: 'fixed' | 'home') => allowedPickupDestinationTypes.some((item) => item === type),
    [allowedPickupDestinationTypes]
  );

  const feedbackVariant = useMemo(() => {
    if (feedback?.type === 'critical') return 'error' as const;
    if (feedback?.type === 'service') return 'info' as const;
    return 'success' as const;
  }, [feedback?.type]);

  const feedbackBanner = (
    <StatusBanner
      visible={Boolean(feedback)}
      message={feedback?.message || ''}
      variant={feedbackVariant}
      onDismiss={() => setFeedback(null)}
    />
  );

  const isDestinationReady =
    bookForOthers
      ? normalizedPassengerManifest.length > 0 && (
          (guestDropoffType === 'fixed' && Boolean(guestDropoffFixedId)) ||
          (guestDropoffType === 'home' && hasSavedHomeDestination)
        )
      : selectedDestinationType === 'fixed'
        ? Boolean(selectedFixedDestinationId)
        : selectedDestinationType === 'home'
          ? hasSavedHomeDestination
          : false;
  const activeCommunityPickupIntents = useMemo(
    () => pickupIntents.filter((item) => item.status === 'pending' && !isExpiredIntent(item)),
    [pickupIntents]
  );

  const filteredPickupIntents = useMemo(() => {
    const q = pickupSearchQuery.trim().toLowerCase();
    if (!q) return activeCommunityPickupIntents;
    return activeCommunityPickupIntents.filter((item) => {
      const names = (item.passengerManifest || []).map((g) => (g.name || '').toLowerCase()).join(' ');
      const dest = item.destinationLabel.toLowerCase();
      const note = (item.note || '').toLowerCase();
      return names.includes(q) || dest.includes(q) || note.includes(q);
    });
  }, [activeCommunityPickupIntents, pickupSearchQuery]);

  const autoBoardDiagnostic = useMemo<AutomationDiagnostic>(() => {
    if (!isDriverOnShift) {
      return {
        state: 'blocked',
        label: 'Manual Boarding Blocked',
        detail: 'Driver is off shift. Start shift to enable automation.',
      };
    }

    const serverDiagnostic = lastAutomationDiagnostics?.autoBoarding;
    if (serverDiagnostic) {
      const mappedState = serverDiagnostic.state === 'executed' ? 'ready' : serverDiagnostic.state;
      return {
        state: mappedState,
        label:
          mappedState === 'blocked'
            ? 'Manual Boarding Blocked'
            : mappedState === 'ready'
              ? 'Manual Boarding Ready'
              : 'Manual Boarding Waiting',
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
        label: 'Manual Boarding Blocked',
        detail: 'No shuttle is assigned to this driver.',
      };
    }

    if (assignedShuttle.currentCapacity >= assignedShuttle.maxCapacity) {
      return {
        state: 'blocked',
        label: 'Manual Boarding Blocked',
        detail: 'Shuttle is at full capacity.',
      };
    }

    if (activeCommunityPickupIntents.length === 0) {
      return {
        state: 'waiting',
        label: 'Manual Boarding Waiting',
        detail: 'No pending pickup requests in the queue.',
      };
    }

    return {
      state: 'ready',
      label: 'Manual Boarding Ready',
      detail: 'Board manually when the shuttle is within pickup radius and passengers remain on the request.',
    };
  }, [activeCommunityPickupIntents.length, assignedShuttle, isDriverOnShift, lastAutomationDiagnostics]);

  const autoUnboardDiagnostic = useMemo<AutomationDiagnostic>(() => {
    if (!isDriverOnShift) {
      return {
        state: 'blocked',
        label: 'Manual Unboarding Blocked',
        detail: 'Driver is off shift. Start shift to enable automation.',
      };
    }

    const serverDiagnostic = lastAutomationDiagnostics?.autoUnboarding;
    if (serverDiagnostic) {
      const mappedState = serverDiagnostic.state === 'executed' ? 'ready' : serverDiagnostic.state;
      return {
        state: mappedState,
        label:
          mappedState === 'blocked'
            ? 'Manual Unboarding Blocked'
            : mappedState === 'ready'
              ? 'Manual Unboarding Ready'
              : 'Manual Unboarding Waiting',
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
        label: 'Manual Unboarding Blocked',
        detail: 'No shuttle is assigned to this driver.',
      };
    }

    if (assignedShuttle.currentCapacity === 0) {
      return {
        state: 'waiting',
        label: 'Manual Unboarding Waiting',
        detail: 'No onboard passengers to unboard.',
      };
    }

    if (onboardDestinations.length === 0) {
      return {
        state: 'waiting',
        label: 'Manual Unboarding Waiting',
        detail: 'No destination data available for onboard passengers.',
      };
    }

    return {
      state: 'ready',
      label: 'Manual Unboarding Ready',
      detail: 'Unboard manually when the shuttle reaches the drop-off radius for the request.',
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

  const isAutomationSyncStale = useMemo(() => {
    if (!isDriverOnShift) return false;
    if (!lastAutoSyncAt) return true;
    return Date.now() - lastAutoSyncAt.getTime() > DRIVER_AUTO_SYNC_MS * AUTOMATION_STALE_MULTIPLIER;
  }, [isDriverOnShift, lastAutoSyncAt]);

  const manualBoardFallbackEnabled = useMemo(() => {
    if (!isDriverOnShift || !assignedShuttle) return false;
    if (autoSyncStatus === 'error' || isAutomationSyncStale) return true;
    return autoBoardDiagnostic.state === 'blocked';
  }, [assignedShuttle, autoBoardDiagnostic.state, autoSyncStatus, isAutomationSyncStale, isDriverOnShift]);

  const manualUnboardFallbackEnabled = useMemo(() => {
    if (!isDriverOnShift || !assignedShuttle) return false;
    if (autoSyncStatus === 'error' || isAutomationSyncStale) return true;
    return autoUnboardDiagnostic.state === 'blocked';
  }, [assignedShuttle, autoSyncStatus, autoUnboardDiagnostic.state, isAutomationSyncStale, isDriverOnShift]);

  const manualFallbackStatusCopy = useMemo(() => {
    if (isManualAutomationCooldownActive) {
      return 'Manual count recorded. The next tap still depends on request count and radius.';
    }

    if (!activePassengerPickupRequest) {
      return 'Waiting for a pickup request to be assigned to this driver.';
    }

    if (remainingManualPickupSlots > 0) {
      if (!isWithinPickupRadius) {
        return 'An active request is assigned. Move into pickup radius to board the next passenger.';
      }

      return `Manual boarding is ready for ${remainingManualPickupSlots} remaining passenger${remainingManualPickupSlots === 1 ? '' : 's'}.`;
    }

    if (!isWithinDropoffRadius) {
      return 'All requested passengers are onboard. Move into drop-off radius to unboard them manually.';
    }

    return 'Manual unboarding is ready for the active request.';
  }, [
    activePassengerPickupRequest,
    activePassengerManualBoardCount,
    isManualAutomationCooldownActive,
    isWithinDropoffRadius,
    isWithinPickupRadius,
    remainingManualPickupSlots,
  ]);

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
    const activeShuttles = shuttles.filter(
      (item) => item.driverId && typeof item.driverId === 'object' && item.driverId.status === 'driving'
    );
    const availableSeats = activeShuttles.reduce(
      (sum, item) => sum + Math.max(0, item.maxCapacity - item.currentCapacity),
      0
    );
    const fullCount = activeShuttles.filter((item) => item.currentCapacity >= item.maxCapacity).length;
    const activeShiftCount = activeShuttles.length;
    const offShiftCount = Math.max(0, shuttles.length - activeShiftCount);

    return {
      availableSeats,
      fullCount,
      activeShiftCount,
      offShiftCount,
    };
  }, [shuttles]);

  const noDriversOnDuty = passengerStats.activeShiftCount === 0;
  const pickupDisabled = pickupSubmitting || activePassengerPickupIntents.length > 0 || (!opsBypassMode && noDriversOnDuty);

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

  const startManualAutomationCooldown = useCallback((durationMs: number = MANUAL_AUTOMATION_COOLDOWN_MS) => {
    const normalizedDurationMs = Number.isFinite(durationMs)
      ? Math.max(0, Math.floor(durationMs))
      : MANUAL_AUTOMATION_COOLDOWN_MS;

    manualAutomationCooldownUntilRef.current = Date.now() + normalizedDurationMs;
    setIsManualAutomationCooldownActive(true);
    setAutoSyncStatus('idle');

    if (manualAutomationCooldownTimerRef.current) {
      clearTimeout(manualAutomationCooldownTimerRef.current);
    }

    manualAutomationCooldownTimerRef.current = setTimeout(() => {
      manualAutomationCooldownUntilRef.current = 0;
      manualAutomationCooldownTimerRef.current = null;
      setIsManualAutomationCooldownActive(false);
    }, normalizedDurationMs);
  }, []);

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

  const handleDriverMapRegionChange = useCallback((region: Region) => {
    if (driverConstraintTimer.current) {
      clearTimeout(driverConstraintTimer.current);
    }

    driverConstraintTimer.current = setTimeout(() => {
      if (
        maxZoomOutRegion &&
        (region.latitudeDelta > maxZoomOutRegion.latitudeDelta ||
          region.longitudeDelta > maxZoomOutRegion.longitudeDelta)
      ) {
        driverMapRef.current?.animateToRegion(maxZoomOutRegion, 600);
      }
    }, 100);
  }, [maxZoomOutRegion]);

  const handlePassengerMapRegionChange = useCallback((region: Region) => {
    if (passengerConstraintTimer.current) {
      clearTimeout(passengerConstraintTimer.current);
    }

    passengerConstraintTimer.current = setTimeout(() => {
      if (
        maxZoomOutRegion &&
        (region.latitudeDelta > maxZoomOutRegion.latitudeDelta ||
          region.longitudeDelta > maxZoomOutRegion.longitudeDelta)
      ) {
        mapRef.current?.animateToRegion(maxZoomOutRegion, 600);
      }
    }, 100);
  }, [maxZoomOutRegion]);

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
      if (payload.requestId) {
        setPickupIntents((items) =>
          items.map((item) =>
            item._id === payload.requestId
              ? { ...item, status: 'claimed' }
              : item
          )
        );
      }

      if (payload.passengerId && payload.passengerId === user?._id) {
        setPreferenceAwareFeedback('Pickup successful. You have boarded.', 'ride');
      }
    };

    const onPassengerAutoUnboarded = (payload: PassengerAutoUnboardedPayload) => {
      if (!payload.rideIds || payload.rideIds.length === 0) return;
      setOnboardDestinations((items) => items.filter((item) => !payload.rideIds!.includes(item.rideId)));
      if (user?.role === 'passenger') {
        setPreferenceAwareFeedback('You reached your destination. Unboarded automatically.', 'ride');
      }
    };

    const onPickupIntentCancelled = (payload: PickupCancelledEventPayload) => {
      if (!payload.requestId) return;

      const requestId = String(payload.requestId);
      const now = Date.now();
      const recent = recentPickupCancelEventRef.current;
      if (recent && recent.requestId === requestId && now - recent.at < 1200) {
        return;
      }
      recentPickupCancelEventRef.current = { requestId, at: now };

      setPickupIntents((items) => items.filter((item) => item._id !== requestId));

      if (payload.passengerId && payload.passengerId === user?._id) {
        setPreferenceAwareFeedback('Pickup request cancelled.', 'ride');
        return;
      }

      if (user?.role === 'driver') {
        setPreferenceAwareFeedback('A pickup request was cancelled by a passenger.', 'service');
      }
    };

    const onSocketError = (payload: SocketErrorEventPayload | string) => {
      const message =
        typeof payload === 'string'
          ? payload
          : payload?.error || payload?.message;

      if (!message) return;
      setPreferenceAwareFeedback(`Realtime issue: ${message}`, 'critical');
    };

    const onCommunitySettingsUpdated = (payload?: { communityId?: string; source?: string }) => {
      if (payload?.communityId && payload.communityId !== activeCommunityId) return;
      setCommunitySyncTick((current) => current + 1);
      setPreferenceAwareFeedback('Community map settings updated. Syncing latest geofence...', 'service');
    };

    const onAnnouncementNew = (payload: any) => {
      const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
      const level = typeof payload?.level === 'string' ? payload.level : 'info';
      if (!title) return;
      const channel = level === 'critical' ? 'critical' : 'service';
      setPreferenceAwareFeedback(`Announcement: ${title}`, channel);
    };

    // DISPATCH: Passenger receives confirmation of which shuttle was assigned
    const onDispatchPassengerAssigned = (payload: any) => {
      if (!user?._id || user.role !== 'passenger') return;
      if (String(payload?.passengerId) !== user._id) return;

      const shuttle = payload?.shuttle as AssignedShuttle | undefined;
      if (shuttle) {
        setDispatchedShuttle(shuttle);
        setQueueNotice(null);
        setPreferenceAwareFeedback(
          `Shuttle ${shuttle.plateNumber || shuttle.label || ''} is on the way!`,
          'ride'
        );
      }
    };

    // DISPATCH: Passenger is put in waiting queue
    const onDispatchQueued = (payload: any) => {
      if (!user?._id || user.role !== 'passenger') return;
      const position = typeof payload?.queuePosition === 'number' ? payload.queuePosition : null;
      const reason = (payload?.queueReason as QueueReason) ?? null;
      const message = typeof payload?.message === 'string' && payload.message.trim()
        ? payload.message.trim()
        : queueReasonMessage(reason);
      setQueueNotice({ position, reason, message });
      setDispatchedShuttle(null);
      setPreferenceAwareFeedback(
        message,
        'service'
      );
    };


    // DISPATCH: Shuttle pending count updated — refresh dispatched shuttle location if it matches
    const onDispatchShuttlePendingUpdated = (payload: any) => {
      if (dispatchedShuttle && String(payload?.shuttleId) === String(dispatchedShuttle.shuttleId)) {
        setDispatchedShuttle((prev) =>
          prev ? { ...prev, pendingPickupCount: payload.pendingPickupCount ?? prev.pendingPickupCount } : prev
        );
      }
    };


    socket.on('shuttle:location-updated', onLocationUpdated);
    socket.on('shuttle:capacity-updated', onCapacityUpdated);
    socket.on('trip:pickup-intent', onPickupIntent);
    socket.on('trip:pickup-claimed', onPickupClaimed);
    socket.on('trip:passenger-auto-unboarded', onPassengerAutoUnboarded);
    socket.on('trip:passenger-unboarded', onPassengerAutoUnboarded);
    socket.on('pickup-intent:cancelled', onPickupIntentCancelled);
    socket.on('trip:pickup-intent-cancelled', onPickupIntentCancelled);
    socket.on('socket:error', onSocketError);
    socket.on('community:settings-updated', onCommunitySettingsUpdated);
    socket.on('announcement:new', onAnnouncementNew);
    socket.on('dispatch:passenger-assigned', onDispatchPassengerAssigned);
    socket.on('dispatch:queued', onDispatchQueued);
    socket.on('dispatch:shuttle-pending-updated', onDispatchShuttlePendingUpdated);

    return () => {
      socket.off('shuttle:location-updated', onLocationUpdated);
      socket.off('shuttle:capacity-updated', onCapacityUpdated);
      socket.off('trip:pickup-intent', onPickupIntent);
      socket.off('trip:pickup-claimed', onPickupClaimed);
      socket.off('trip:passenger-auto-unboarded', onPassengerAutoUnboarded);
      socket.off('trip:passenger-unboarded', onPassengerAutoUnboarded);
      socket.off('pickup-intent:cancelled', onPickupIntentCancelled);
      socket.off('trip:pickup-intent-cancelled', onPickupIntentCancelled);
      socket.off('socket:error', onSocketError);
      socket.off('community:settings-updated', onCommunitySettingsUpdated);
      socket.off('announcement:new', onAnnouncementNew);
      socket.off('dispatch:passenger-assigned', onDispatchPassengerAssigned);
      socket.off('dispatch:queued', onDispatchQueued);
      socket.off('dispatch:shuttle-pending-updated', onDispatchShuttlePendingUpdated);
    };
  }, [activeCommunityId, dispatchedShuttle, loadShuttles, setPreferenceAwareFeedback, token, user?._id, user?.role]);


  useEffect(() => {
    if (!activeCommunityId || user?.role !== 'driver') return;

    let mounted = true;

    const loadPickupIntents = async () => {
      if (!isAppActive()) return;

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
    if (user?.role !== 'passenger') return;

    const detectionKey = JSON.stringify({
      communityId: activeCommunityId,
      homeCoordinates: user?.homeDestination?.location?.coordinates ?? null,
      homeLabel: user?.homeDestination?.label ?? null,
      fixedDestinations: fixedDestinations.map((item) => ({
        id: item._id,
        name: item.name,
        coordinates: item.location.coordinates,
      })),
    });

    if (pickupOriginDetectionKeyRef.current === detectionKey) return;
    pickupOriginDetectionKeyRef.current = detectionKey;

    let active = true;

    const detectCurrentPickupOrigin = async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          if (active) {
            setPickupOriginContext({
              type: 'unknown',
              label: 'Location permission is required to detect your pickup location.',
              matchedDestinationId: null,
              matchedDestinationLabel: null,
            });
          }
          return;
        }

        const lastKnownPosition = await Location.getLastKnownPositionAsync();
        const position = lastKnownPosition || await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (!active) return;

        const detectedOrigin = detectPickupOrigin({
          currentLocation: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          },
          homeDestination: user?.homeDestination
            ? {
              label: user.homeDestination.label,
              location: {
                coordinates: user.homeDestination.location.coordinates,
              },
            }
            : null,
          fixedDestinations,
          detectionRadiusMeters: precisePickup ? 50 : 80,
        });

        if (!active) return;
        setPickupOriginContext(detectedOrigin);
      } catch (error) {
        if (!active) return;
        setPickupOriginContext({
          type: 'unknown',
          label: error instanceof Error ? error.message : 'Unable to detect your current pickup location.',
          matchedDestinationId: null,
          matchedDestinationLabel: null,
        });
      }
    };

    void detectCurrentPickupOrigin();

    return () => {
      active = false;
    };
  }, [activeCommunityId, fixedDestinations, precisePickup, user?.homeDestination?.label, user?.homeDestination?.location?.coordinates, user?.role]);

  useEffect(() => {
    if (allowedPickupDestinationTypes.length === 1) {
      const [onlyAllowedType] = allowedPickupDestinationTypes;
      if (selectedDestinationType !== onlyAllowedType) {
        setSelectedDestinationType(onlyAllowedType);
      }
      return;
    }

    if (selectedDestinationType && !canUsePickupDestinationType(selectedDestinationType)) {
      setSelectedDestinationType(null);
    }
  }, [allowedPickupDestinationTypes, canUsePickupDestinationType, selectedDestinationType]);

  useEffect(() => {
    if (selectedDestinationType !== 'fixed' && selectedFixedDestinationId) {
      setSelectedFixedDestinationId('');
      return;
    }

    if (
      selectedDestinationType === 'fixed' &&
      selectedFixedDestinationId &&
      !fixedDestinations.some((item) => item._id === selectedFixedDestinationId)
    ) {
      setSelectedFixedDestinationId('');
    }
  }, [fixedDestinations, selectedDestinationType, selectedFixedDestinationId]);

  useEffect(() => {
    if (user?.role !== 'driver' || !assignedShuttle?._id) return;
    let mounted = true;

    const loadOnboardDestinations = async () => {
      if (!isAppActive()) return;

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
      if (!isAppActive()) return;

      try {
        const community = await getCommunityById(activeCommunityId);
        const ring = community?.boundaries?.coordinates?.[0] || [];
        const destinationRows = (community?.fixedDestinations || []).filter((item) => item.isActive !== false);
        setFixedDestinations(destinationRows);
        setOpsBypassMode(Boolean((community as any)?.opsBypassMode));

        // Capture fare info for passenger UI
        if (community?.baseFare !== undefined) {
          setCommunityFares({
            base: community.baseFare,
            priorityMultiplier: community.priorityFareMultiplier ?? 1.5,
          });
        }

        const communityAny = community as {
          discountSettings?: Partial<CommunityDiscountSettings>;
        };
        setCommunityDiscounts({
          studentDiscount: Number(communityAny.discountSettings?.studentDiscount ?? 0),
          pwdDiscount: Number(communityAny.discountSettings?.pwdDiscount ?? 0),
          seniorDiscount: Number(communityAny.discountSettings?.seniorDiscount ?? 0),
        });


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

        // Build an extended set of points that includes both community boundary and fixed destinations
        // so the map region encompasses everything, even destinations outside the boundary.
        const allPoints: LatLng[] = [...normalized];
        for (const dest of destinationRows) {
          if (dest.location?.coordinates?.length === 2) {
            const [lng, lat] = dest.location.coordinates;
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
              allPoints.push({ latitude: lat, longitude: lng });
            }
          }
        }

        const maxZoomRegion = toMaxZoomOutRegionFromBoundary(allPoints);
        if (maxZoomRegion) {
          setMaxZoomOutRegion(maxZoomRegion);
        }

        const regionFromBoundary = toRegionFromBoundary(allPoints);
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

  // Load phase geofences for the community
  useEffect(() => {
    if (!activeCommunityId) return;

    let active = true;

    const loadPhaseGeofencesData = async () => {
      if (!isAppActive()) return;

      try {
        const phases = await getPhaseGeofences(activeCommunityId);
        if (!active) return;
        setPhaseGeofences(phases);
      } catch (error) {
        console.warn('Failed to load phase geofences:', error);
      }
    };

    loadPhaseGeofencesData();
    const timer = setInterval(loadPhaseGeofencesData, COMMUNITY_SETTINGS_SYNC_POLL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [activeCommunityId, communitySyncTick]);

  useEffect(() => {
    if (user?.role !== 'passenger' || !isAppActive()) return;

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
        markerRefs.current[shuttle._id]?.animateMarkerToCoordinate?.(coordinate, 800);
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
  }, [isAppActive, mapShuttles, user?.role]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!isAppActive()) return;

      setPickupIntents((items) => items.filter((item) => !isExpiredIntent(item)));
    }, 30_000);

    return () => {
      clearInterval(timer);
    };
  }, [isAppActive]);

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
      if (manualAutomationCooldownTimerRef.current) {
        clearTimeout(manualAutomationCooldownTimerRef.current);
        manualAutomationCooldownTimerRef.current = null;
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

    if (!isWithinDropoffRadius) {
      setPreferenceAwareFeedback('Move the shuttle into the drop-off radius before unboarding.', 'critical');
      return;
    }

    try {
      setUnboardingSubmitting(true);
      await unboardPassenger(assignedShuttle._id, 1);
      await loadShuttles();
      setPreferenceAwareFeedback('Passenger drop-off recorded manually.', 'ride');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to record drop-off.';
      setPreferenceAwareFeedback(message, 'critical');
    } finally {
      setUnboardingSubmitting(false);
    }
  };

  const handleManualBoardPassenger = async () => {
    if (!assignedShuttle) {
      setPreferenceAwareFeedback('No shuttle assigned to this driver account.', 'critical');
      return;
    }

    if (!isDriverOnShift) {
      setPreferenceAwareFeedback('Start your shift first before boarding passengers.', 'critical');
      return;
    }

    if (assignedShuttle.currentCapacity >= assignedShuttle.maxCapacity) {
      setPreferenceAwareFeedback('Shuttle is already full.', 'critical');
      return;
    }

    if (!activePassengerPickupRequest) {
      setPreferenceAwareFeedback('No pickup request has been sent to this driver yet.', 'critical');
      return;
    }

    if (remainingManualPickupSlots === 0) {
      setPreferenceAwareFeedback('All passengers in this request are already boarded.', 'critical');
      return;
    }

    if (!isWithinPickupRadius) {
      setPreferenceAwareFeedback('Move the shuttle into the pickup radius before boarding.', 'critical');
      return;
    }

    if (!activePassengerPickupFitsCapacity) {
      setPreferenceAwareFeedback('This pickup request is too large for the remaining shuttle capacity.', 'critical');
      return;
    }

    try {
      setBoardingSubmitting(true);
      await boardPassenger(assignedShuttle._id, 1);
      startManualAutomationCooldown();
      await loadShuttles();
      const nextCount = Math.min(activePassengerPickupRequestCount, activePassengerManualBoardCount + 1);
      setActivePassengerManualBoardCount(nextCount);
      if (activePassengerPickupRequest && nextCount >= activePassengerPickupRequestCount) {
        setPickupIntents((items) => items.filter((item) => item._id !== activePassengerPickupRequest._id));
        setActivePassengerManualBoardCount(0);
      }
      setPreferenceAwareFeedback('Passenger boarding recorded manually.', 'ride');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to record boarding.';
      setPreferenceAwareFeedback(message, 'critical');
    } finally {
      setBoardingSubmitting(false);
    }
  };

  const syncDriverLocation = useCallback(async (options?: {
    silent?: boolean;
    coords?: LatLng;
    skipPermissionRequest?: boolean;
  }) => {
    const silent = options?.silent === true;
    if (!assignedShuttleId || locationSyncInFlightRef.current) {
      if (silent && !locationSyncInFlightRef.current) {
        setAutoSyncStatus('idle');
      }
      return;
    }

    if (user?.role === 'driver' && user?.status !== 'driving') {
      if (silent) {
        setAutoSyncStatus('idle');
      }
      if (!silent) {
        setPreferenceAwareFeedback('Start your shift first before syncing location.', 'critical');
      }
      return;
    }

    const manualCooldownRemainingMs = Math.max(0, manualAutomationCooldownUntilRef.current - Date.now());
    if (manualCooldownRemainingMs > 0) {
      if (silent) {
        setAutoSyncStatus('idle');
      } else {
        const secondsRemaining = Math.ceil(manualCooldownRemainingMs / 1000);
        setPreferenceAwareFeedback(
          `Auto-processing is paused for ${secondsRemaining}s after manual boarding/unboarding to prevent duplicate counts.`,
          'service'
        );
      }
      return;
    }

    locationSyncInFlightRef.current = true;
    if (silent) {
      setAutoSyncStatus('syncing');
    }
    let silentSyncFailed = false;

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
        assignedShuttleId,
        normalizedLatitude,
        normalizedLongitude
      );
      setLastAutomationDiagnostics(locationSync.automationDiagnostics || null);

      const backendManualCooldownSeconds = Math.max(
        0,
        Number(locationSync.manualAutomationCooldownSeconds || 0)
      );
      if (backendManualCooldownSeconds > 0) {
        startManualAutomationCooldown(backendManualCooldownSeconds * 1000);
      }

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
      } else if (!silent && backendManualCooldownSeconds > 0) {
        setPreferenceAwareFeedback(
          `GPS synced. Automation remains paused for ${backendManualCooldownSeconds}s to prevent duplicate counts.`,
          'service'
        );
      } else if (!silent) {
        setPreferenceAwareFeedback('GPS synced successfully.', 'service');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const isWriteConflict = /conflicted with another write/i.test(message);
      if (silent) {
        silentSyncFailed = !isWriteConflict;
        if (!isWriteConflict) {
          setAutoSyncStatus('error');
        }
      }
      if (!silent) {
        setPreferenceAwareFeedback(message || 'Failed to sync location.', 'critical');
      }
    } finally {
      if (silent && !silentSyncFailed) {
        setAutoSyncStatus('idle');
      }
      locationSyncInFlightRef.current = false;
    }
  }, [assignedShuttleId, setPreferenceAwareFeedback, startManualAutomationCooldown, user?.role, user?.status]);

  const handleSyncLocation = async () => {
    if (!assignedShuttle) {
      setPreferenceAwareFeedback('No shuttle assigned to this driver account.', 'critical');
      return;
    }
    await syncDriverLocation({ silent: false });
  };

  useEffect(() => {
    if (user?.role !== 'driver') return;
    if (user?.status === 'driving') return;

    if (driverFallbackIntervalRef.current) {
      clearInterval(driverFallbackIntervalRef.current);
      driverFallbackIntervalRef.current = null;
    }
    if (driverLocationWatchRef.current) {
      driverLocationWatchRef.current.remove();
      driverLocationWatchRef.current = null;
    }

    setAutoSyncStatus('idle');
    setLastAutoSyncAt(null);
    setLastAutomationDiagnostics(null);
    locationSyncInFlightRef.current = false;
    lastContinuousSyncRef.current = null;
    manualAutomationCooldownUntilRef.current = 0;
    setIsManualAutomationCooldownActive(false);
    if (manualAutomationCooldownTimerRef.current) {
      clearTimeout(manualAutomationCooldownTimerRef.current);
      manualAutomationCooldownTimerRef.current = null;
    }
  }, [user?.role, user?.status]);

  useEffect(() => {
    if (user?.role !== 'driver' || !assignedShuttleId || user?.status !== 'driving') return;

    // Continuous watcher for near-real-time movement updates + periodic fallback.
    let active = true;

    const bootDriverTracking = async () => {
      if (driverFallbackIntervalRef.current) {
        clearInterval(driverFallbackIntervalRef.current);
        driverFallbackIntervalRef.current = null;
      }
      if (driverLocationWatchRef.current) {
        driverLocationWatchRef.current.remove();
        driverLocationWatchRef.current = null;
      }

      const permission = await Location.requestForegroundPermissionsAsync();
      if (!active) return;

      if (permission.status !== 'granted') {
        setPreferenceAwareFeedback('Location permission is required for live driver tracking.', 'critical');
        return;
      }

      await syncDriverLocation({ silent: true, skipPermissionRequest: true });
      if (!active) return;

      driverFallbackIntervalRef.current = setInterval(() => {
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
      if (driverFallbackIntervalRef.current) {
        clearInterval(driverFallbackIntervalRef.current);
        driverFallbackIntervalRef.current = null;
      }
      if (driverLocationWatchRef.current) {
        driverLocationWatchRef.current.remove();
        driverLocationWatchRef.current = null;
      }
      lastContinuousSyncRef.current = null;
    };
  }, [assignedShuttleId, setPreferenceAwareFeedback, syncDriverLocation, user?.role, user?.status]);

  useEffect(() => {
    if (user?.role !== 'driver' || user?.status !== 'driving' || !assignedShuttle?._id) return;

    let mounted = true;

    const replayOfflineBoardings = async (periodic = false) => {
      try {
        const result = await syncOfflineBoardings(async (queuedShuttleId, boardedCount) => {
          if (queuedShuttleId !== assignedShuttle._id) {
            throw new Error('Queued boarding belongs to a different shuttle assignment.');
          }

          await boardPassenger(queuedShuttleId, boardedCount);
        });

        if (!mounted) return;

        if (result.synced > 0) {
          setPreferenceAwareFeedback(
            `Recovered ${result.synced} offline boarding update${result.synced > 1 ? 's' : ''}.`,
            periodic ? 'service' : 'ride'
          );
        }

        if (result.failed > 0) {
          const now = Date.now();
          if (now - offlineSyncNoticeRef.current >= POLL_ERROR_NOTICE_COOLDOWN_MS) {
            offlineSyncNoticeRef.current = now;
            setPreferenceAwareFeedback(
              `Offline queue still has ${result.failed} unsynced boarding update${result.failed > 1 ? 's' : ''}.`,
              'service'
            );
          }
        }
      } catch (error) {
        const now = Date.now();
        if (now - offlineSyncNoticeRef.current < POLL_ERROR_NOTICE_COOLDOWN_MS) {
          return;
        }

        offlineSyncNoticeRef.current = now;
        const message =
          error instanceof Error && error.message
            ? `Offline queue sync failed: ${error.message}`
            : 'Offline queue sync failed. Retrying automatically.';
        setPreferenceAwareFeedback(message, 'service');
      }
    };

    void replayOfflineBoardings(false);
    const timer = setInterval(() => {
      void replayOfflineBoardings(true);
    }, DRIVER_AUTO_SYNC_MS);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [assignedShuttle?._id, setPreferenceAwareFeedback, user?.role, user?.status]);

  const handleRequestPickup = async () => {
    if (pickupDisabled) {
      if (activePassengerPickupIntents.length > 0) {
        setPreferenceAwareFeedback('Pickup request already active. Waiting for driver confirmation.', 'ride');
      }
      return;
    }

    // Validate either normal booking or guest booking fields.
    const savedHomeCoords = user?.homeDestination?.location?.coordinates;
    if (!bookForOthers) {
      if (!selectedDestinationType) {
        setPreferenceAwareFeedback('Select Fixed or Home destination first.', 'critical');
        return;
      }

      if (!canUsePickupDestinationType(selectedDestinationType)) {
        setPreferenceAwareFeedback('Select the destination that is opposite your current pickup location.', 'critical');
        return;
      }

      if (selectedDestinationType === 'fixed' && !selectedFixedDestinationId) {
        setPreferenceAwareFeedback('Select a fixed destination first.', 'critical');
        return;
      }

      if (selectedDestinationType === 'home' && !hasSavedHomeDestination) {
        setPreferenceAwareFeedback('Set your Home destination in Settings first.', 'critical');
        return;
      }
    } else {
      // booking for others: validate guest pickup/dropoff choices
      if (normalizedPassengerManifest.length === 0) {
        setPreferenceAwareFeedback('Add at least one guest to the manifest.', 'critical');
        return;
      }
      if (guestPickupType === 'fixed' && !guestPickupFixedId) {
        setPreferenceAwareFeedback('Select a fixed pickup location for the guest.', 'critical');
        return;
      }
      if (guestPickupType === 'home' && !hasSavedHomeDestination) {
        setPreferenceAwareFeedback('Booking owner has no saved Home destination.', 'critical');
        return;
      }
      if (guestDropoffType === 'fixed' && !guestDropoffFixedId) {
        setPreferenceAwareFeedback('Select a fixed drop-off location for the guest.', 'critical');
        return;
      }
      if (guestDropoffType === 'home' && !hasSavedHomeDestination) {
        setPreferenceAwareFeedback('Booking owner has no saved Home destination.', 'critical');
        return;
      }
    }

    try {
      // If guest booking uses a fixed pickup, prefer that explicit coordinate and skip requesting GPS.
      // Compute explicit pickup location from fixed destination if present.
      let explicitPickupLocation: { latitude: number; longitude: number } | undefined = undefined;
      if (bookForOthers && guestPickupType === 'fixed' && guestPickupFixedId) {
        const fixed = fixedDestinations.find((d) => d._id === guestPickupFixedId);
        if (fixed && fixed.location?.coordinates?.length === 2) {
          explicitPickupLocation = {
            latitude: Number(fixed.location.coordinates[1]),
            longitude: Number(fixed.location.coordinates[0]),
          };
        }
      }

      setPickupSubmitting(true);

      let pickupLatitude: number | undefined;
      let pickupLongitude: number | undefined;

      if (explicitPickupLocation) {
        pickupLatitude = explicitPickupLocation.latitude;
        pickupLongitude = explicitPickupLocation.longitude;
      } else {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          setPreferenceAwareFeedback('Location permission is required to request pickup.', 'critical');
          setPickupSubmitting(false);
          return;
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        pickupLatitude = precisePickup
          ? position.coords.latitude
          : Number(position.coords.latitude.toFixed(4));
        pickupLongitude = precisePickup
          ? position.coords.longitude
          : Number(position.coords.longitude.toFixed(4));
      }

      // Detect current phase from live GPS location
      const currentPickupLocationPoint = { latitude: pickupLatitude, longitude: pickupLongitude };
      const detectedPhase = detectPhaseFromCoordinates(currentPickupLocationPoint, phaseGeofences);
      // Build guest-specific pickupLocation override and destination when booking for others
      let explicitPickupLocationForOptions: { latitude: number; longitude: number } | undefined = undefined;
      let requestedDestination: any =
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
            };

      if (bookForOthers && normalizedPassengerManifest.length > 0) {
        // guest pickup override: if guestPickupType is fixed, capture coords to send as options
        if (guestPickupType === 'fixed' && guestPickupFixedId) {
          const fixed = fixedDestinations.find((d) => d._id === guestPickupFixedId);
          if (fixed && fixed.location?.coordinates?.length === 2) {
            explicitPickupLocationForOptions = {
              latitude: Number(fixed.location.coordinates[1]),
              longitude: Number(fixed.location.coordinates[0]),
            };
          }
        }

        // guest dropoff override: if guestDropoffType specified, use it as the destination
        if (guestDropoffType === 'fixed' && guestDropoffFixedId) {
          requestedDestination = {
            type: 'fixed',
            fixedDestinationId: guestDropoffFixedId,
          };
        } else if (guestDropoffType === 'home') {
          // Use booking owner's saved home as the 'home' destination for guests
          if (hasSavedHomeDestination) {
            requestedDestination = {
              type: 'home',
              latitude: savedHomeCoords![1],
              longitude: savedHomeCoords![0],
              label: user?.homeDestination?.label || 'Home',
            };
          }
        }
      }

      // Build manifest for self-booking including per-passenger discount selections.
      let selfBookingOptions: { passengerManifest?: { name?: string; phone?: string; passengerId?: string; discountType?: 'student' | 'pwd' | 'senior' }[] } | undefined = undefined;
      if (!bookForOthers && selfPassengerDraft.length > 0 && user) {
        const ownerPhone = user.phone || undefined;
        const manifest = selfPassengerDraft.map((entry, idx) => ({
          name: entry.name,
          ...(idx === 0 ? { passengerId: user._id, phone: ownerPhone } : {}),
          ...(entry.discountType !== 'none' ? { discountType: entry.discountType } : {}),
        }));
        selfBookingOptions = { passengerManifest: manifest };
      }

      const result = await createPickupIntent(
        pickupLatitude,
        pickupLongitude,
        requestedDestination,
        fareType,
        detectedPhase,
        bookForOthers && normalizedPassengerManifest.length > 0
          ? {
              ...(explicitPickupLocationForOptions ? { pickupLocation: explicitPickupLocationForOptions } : {}),
              passengerManifest: manifestDraft.map(guest => ({
                name: guest.name,
                ...(guest.discountType !== 'none' ? { discountType: guest.discountType } : {}),
              })),
            }
          : selfBookingOptions,
        rideNote.trim() || null
      );

      if (bookForOthers) {
        resetGuestBookingDraft();
      }
      setPassengerCount(1);
      setSelfPassengerDraft([]);
      setRideNote('');

      setPickupIntents((items) => upsertPickupIntent(items, result.request));

      if (result.dispatched && result.assignedShuttle) {
        setDispatchedShuttle(result.assignedShuttle);
        setQueueNotice(null);
        setPreferenceAwareFeedback(
          `Shuttle ${result.assignedShuttle.plateNumber || result.assignedShuttle.label || ''} dispatched to you!`,
          'ride'
        );
      } else if (!result.dispatched && result.queuePosition !== undefined) {
        const reason = (result.queueReason as QueueReason) ?? null;
        setQueueNotice({
          position: typeof result.queuePosition === 'number' ? result.queuePosition : null,
          reason,
          message: queueReasonMessage(reason),
        });

        setDispatchedShuttle(null);
        setPreferenceAwareFeedback(
          queueReasonMessage(reason),
          'service'
        );
      } else {
        setPreferenceAwareFeedback('Pickup request sent. Drivers in your community were notified.', 'ride');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit pickup request.';
      setPreferenceAwareFeedback(message, 'critical');
    } finally {
      setPickupSubmitting(false);
    }
  };


  const handleCancelPickup = async () => {
    const activeIntent = activePassengerPickupIntents[0];
    if (!activeIntent || pickupCancelling) {
      return;
    }

    try {
      setPickupCancelling(true);
      await cancelPickupIntent(activeIntent._id);
      recentPickupCancelEventRef.current = { requestId: activeIntent._id, at: Date.now() };
      setPickupIntents((items) => items.filter((item) => item._id !== activeIntent._id));
      // Clear dispatch state on cancel
      setDispatchedShuttle(null);
      setQueueNotice(null);
      setPreferenceAwareFeedback('Pickup request cancelled.', 'ride');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to cancel pickup request.';
      setPreferenceAwareFeedback(message, 'critical');
    } finally {
      setPickupCancelling(false);
    }
  };


  const onDriverUnboard = async () => {
    if (hapticsEnabled) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    await handleUnboardPassenger();
  };

  const onDriverBoard = async () => {
    if (hapticsEnabled) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    await handleManualBoardPassenger();
  };

  const handleSelectFixedDestinationType = useCallback(() => {
    setSelectedDestinationType('fixed');
  }, []);

  const handleSelectHomeDestinationType = useCallback(() => {
    setSelectedDestinationType('home');
  }, []);

  const handleSelectFixedDestination = useCallback((destinationId: string) => {
    setSelectedFixedDestinationId(destinationId);
  }, []);

  const resetGuestBookingDraft = useCallback(() => {
    setManifestDraft([{ id: 'guest-1', name: '', discountType: 'none' }]);
    setGuestPickupType(null);
    setGuestPickupFixedId('');
    setGuestDropoffType(null);
    setGuestDropoffFixedId('');
  }, []);

  const toggleBookForOthers = useCallback(() => {
    setBookForOthers((current) => {
      const next = !current;
      if (next) {
        // Default guest dropoff to current selected destination type when possible
        const defaultDropoff = selectedDestinationType || (allowedPickupDestinationTypes[0] ?? 'fixed');
        const defaultPickup = defaultDropoff === 'fixed' ? 'home' : 'fixed';
        setGuestDropoffType(defaultDropoff as 'fixed' | 'home');
        setGuestPickupType(defaultPickup as 'fixed' | 'home');
      } else {
        // reset when turning off
        setGuestDropoffType(null);
        setGuestPickupType(null);
        setGuestDropoffFixedId('');
        setGuestPickupFixedId('');
      }
      return next;
    });
  }, []);

  const updateManifestEntry = useCallback((id: string, field: 'name', value: string) => {
    setManifestDraft((current) => current.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry)));
  }, []);

  const addManifestEntry = useCallback(() => {
    setManifestDraft((current) => {
      if (current.length >= 5) return current;
      return [...current, { id: `guest-${Date.now()}-${current.length}`, name: '', discountType: 'none' }];
    });
  }, []);

  const removeManifestEntry = useCallback((id: string) => {
    setManifestDraft((current) => {
      const next = current.filter((entry) => entry.id !== id);
      return next.length > 0 ? next : [{ id: 'guest-1', name: '', discountType: 'none' }];
    });
  }, []);



  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bgColor }]} edges={['top', 'left', 'right']}>
      <View style={[styles.topBar, { borderColor, backgroundColor: surfaceColor }]}>
        <SectionHeader
          title={`Welcome, ${user?.firstName || 'Member'}`}
          subtitle={`${user?.role === 'driver' ? 'Driver Console' : 'Ride Dashboard'} · ${user?.lastName || 'GoShuttle'}`}
          titleColor={textColor}
          subtitleColor={mutedColor}
          rightAction={
            <Pressable
              onPress={loadShuttles}
              style={[styles.avatarBadge, { backgroundColor: tint }]}
              accessibilityRole="button"
              accessibilityLabel="Refresh fleet and map data"
            >
              <Ionicons name="refresh" size={18} color={palette.white} />
            </Pressable>
          }
        />
      </View>

      <View style={[styles.locationPill, { backgroundColor: surfaceColor, borderColor }]}> 
        <Ionicons name="location-outline" size={14} color={tint} />
        <ThemedText style={[styles.locationPillText, { color: textColor }]}>
          {activeCommunityId ? 'Community route active' : 'Locating community route'}
        </ThemedText>
      </View>

      {(user?.warnings ?? []).filter((w) => !dismissedWarningIds.has(w._id)).map((w, i) => (
        <View key={w._id} style={[styles.warningCard, { borderColor: '#fde68a', backgroundColor: '#fefce8' }]}>
          <View style={styles.warningCardHeader}>
            <View style={styles.warningCardLeft}>
              <Ionicons name="warning" size={16} color="#92400e" />
              <Text style={styles.warningCardTitle}>
                Account Warning {(user?.warnings?.findIndex((x) => x._id === w._id) ?? i) + 1}/{user?.warnings?.length}
              </Text>
            </View>
            <Pressable
              onPress={() => void handleDismissWarning(w._id)}
              hitSlop={8}
              accessibilityLabel="Dismiss warning"
            >
              <Ionicons name="close" size={16} color="#92400e" />
            </Pressable>
          </View>
          <Text style={styles.warningCardNote}>{w.note}</Text>
          <Text style={styles.warningCardMeta}>Issued by {w.issuedBy} · {new Date(w.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
        </View>
      ))}

      {user?.role === 'driver' ? (
        <View style={styles.driverLayout}>
          <View style={[styles.mapWrap, styles.driverMapWrap]}>
            {driverRegion ? (
              <MapView
                ref={driverMapRef}
                style={styles.map}
                initialRegion={driverRegion}
                onMapReady={() => setMapReady(true)}
                scrollEnabled={true}
                zoomEnabled={true}
                rotateEnabled={false}
                pitchEnabled={false}
                toolbarEnabled={false}
                onRegionChange={handleDriverMapRegionChange}
              >
                {communityBoundary.length >= 3 ? (
                  <Polygon
                    coordinates={communityBoundary}
                    fillColor={AppPalette.navyOverlaySoft}
                    strokeColor={palette.navy}
                    strokeWidth={2}
                  />
                ) : null}

                {phaseGeofences.map((phase) => {
                  const ring = phase.boundaries?.coordinates?.[0] || [];
                  const coords = ring
                    .map((point) => {
                      const longitude = Number(point?.[0]);
                      const latitude = Number(point?.[1]);
                      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
                      return { latitude, longitude };
                    })
                    .filter((point): point is LatLng => point !== null);

                  if (coords.length < 3) return null;

                  const hexColor = phase.color || '#6366f1';
                  const r = parseInt(hexColor.slice(1, 3), 16);
                  const g = parseInt(hexColor.slice(3, 5), 16);
                  const b = parseInt(hexColor.slice(5, 7), 16);

                  return (
                    <Polygon
                      key={`driver-phase-${phase._id}`}
                      coordinates={coords}
                      fillColor={`rgba(${r}, ${g}, ${b}, 0.15)`}
                      strokeColor={hexColor}
                      strokeWidth={2}
                    />
                  );
                })}

                {/* Fixed Destinations */}
                {fixedDestinations.map((dest) => {
                  if (!dest.location?.coordinates) return null;
                  const [longitude, latitude] = dest.location.coordinates;
                  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
                  
                  const color = dest.color || '#94a3b8';
                  const r = parseInt(color.slice(1, 3), 16);
                  const g = parseInt(color.slice(3, 5), 16);
                  const b = parseInt(color.slice(5, 7), 16);

                  return [
                    <Circle
                      key={`driver-dest-circle-${dest._id}`}
                      center={{ latitude, longitude }}
                      radius={dest.pickupRadiusMeters || 80}
                      fillColor={`rgba(${r}, ${g}, ${b}, 0.15)`}
                      strokeColor={color}
                      strokeWidth={2}
                    />,
                    <Marker
                      key={`driver-dest-pin-${dest._id}`}
                      coordinate={{ latitude, longitude }}
                      title={dest.name}
                      description="Fixed Destination"
                      pinColor={color}
                      anchor={{ x: 0.5, y: 1 }}
                      accessible
                      accessibilityLabel={`Fixed Destination: ${dest.name}`}
                    />
                  ];
                })}

                {assignedShuttle && toShuttleCoordinate(assignedShuttle) ? (
                  <Marker
                    coordinate={toShuttleCoordinate(assignedShuttle)!}
                    title={assignedShuttle.plateNumber}
                    description={`${assignedShuttle.currentCapacity}/${assignedShuttle.maxCapacity} seated`}
                    anchor={{ x: 0.5, y: 0.5 }}
                    accessible
                    accessibilityLabel={`Assigned shuttle ${assignedShuttle.plateNumber}, ${assignedShuttle.currentCapacity} of ${assignedShuttle.maxCapacity} seats occupied`}
                  >
                    <MapIndicator iconName="bus" />
                  </Marker>
                ) : null}

                {activePassengerPickupVisible && activePassengerPickupRequest ? (() => {
                  const item = activePassengerPickupRequest;
                  const coordinate = activePassengerPickupCoordinate;
                  if (!coordinate) return null;

                  const hasManifest = item.passengerManifest && item.passengerManifest.length > 0;

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
                      anchor={{ x: 0.5, y: 0.5 }}
                      accessible
                      accessibilityLabel="Active pickup request marker"
                    >
                      <MapIndicator iconName="person" />
                      <Callout tooltip>
                        <View style={[styles.calloutContainer, { backgroundColor: bgColor, borderColor }]}> 
                          <ThemedText type="defaultSemiBold" style={{ color: textColor, fontSize: 14 }}>
                            Pickup Request
                          </ThemedText>
                          <View style={[styles.calloutSeparator, { backgroundColor: borderColor }]} />
                          <ThemedText type="caption" style={{ color: mutedColor, fontSize: 12, marginBottom: 4 }}>
                            {remainingManualPickupSlots} passenger{remainingManualPickupSlots === 1 ? '' : 's'} remaining to board
                          </ThemedText>
                          {hasManifest ? (
                            item.passengerManifest!.map((guest, idx) => (
                              <View key={`guest-${idx}`} style={{ marginBottom: idx < item.passengerManifest!.length - 1 ? 4 : 0 }}>
                                <ThemedText type="caption" style={{ color: textColor, fontSize: 12, fontWeight: '500' }}>
                                  {guest.name || `Guest ${idx + 1}`}
                                </ThemedText>
                                {guest.phone ? (
                                  <ThemedText type="caption" style={{ color: mutedColor, fontSize: 12 }}>
                                    {guest.phone}
                                  </ThemedText>
                                ) : null}
                              </View>
                            ))
                          ) : (
                            <ThemedText type="caption" style={{ color: mutedColor, fontSize: 12 }}>
                              Passenger waiting
                            </ThemedText>
                          )}
                          {item.note ? (
                            <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: borderColor }}>
                              <ThemedText type="caption" style={{ color: tint, fontSize: 11, fontWeight: '600', marginBottom: 2 }}>
                                Note
                              </ThemedText>
                              <ThemedText type="caption" style={{ color: textColor, fontSize: 12 }}>
                                {item.note}
                              </ThemedText>
                            </View>
                          ) : null}
                        </View>
                      </Callout>
                    </Marker>,
                  ];
                })() : null}
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
                      accessible
                      accessibilityLabel={`Destination marker for ${item.passengerName} to ${item.destinationLabel}`}
                    />
                  );
                })}
              </MapView>
            ) : (
              <MapLoadingPlaceholder
                title="Loading Fleet Map"
                hint="Fetching geofence boundary"
              />
            )}
            {phaseGeofences.length > 0 || fixedDestinations.length > 0 ? (
              <View style={[styles.phaseLegend, { backgroundColor: surfaceColor, borderColor }]}>
                {phaseGeofences.length > 0 && (
                  <>
                    <Text style={[styles.phaseLegendTitle, { color: textColor }]}>Phases</Text>
                    {phaseGeofences.map((phase) => (
                      <View key={`driver-legend-phase-${phase._id}`} style={styles.phaseLegendRow}>
                        <View style={[styles.phaseLegendDot, { backgroundColor: phase.color || '#6366f1' }]} />
                        <Text style={[styles.phaseLegendText, { color: textColor }]}>{formatPhaseLabel(phase.name)}</Text>
                      </View>
                    ))}
                  </>
                )}
                {fixedDestinations.length > 0 && (
                  <>
                    <Text style={[styles.phaseLegendTitle, { color: textColor, marginTop: phaseGeofences.length > 0 ? 4 : 0 }]}>Fixed Locations</Text>
                    {fixedDestinations.map((dest) => (
                      <View key={`driver-legend-dest-${dest._id}`} style={styles.phaseLegendRow}>
                        <View style={[styles.phaseLegendDot, { backgroundColor: dest.color || '#94a3b8' }]} />
                        <Text style={[styles.phaseLegendText, { color: textColor }]}>{dest.name.replace(/_/g, ' ')}</Text>
                      </View>
                    ))}
                  </>
                )}
              </View>
            ) : null}

            <View style={styles.mapLockBadge}>
              <Ionicons name="lock-closed" size={12} color={palette.white} />
              <ThemedText style={styles.mapLockText}>Map Locked to Community</ThemedText>
            </View>
          </View>

          {feedbackBanner}

          <ScrollView
            contentContainerStyle={styles.driverInfoScroll}
            bounces={false}
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
          >
            <View style={[styles.driverInfoCard, { backgroundColor: surfaceColor, borderColor }]}>
              <SectionHeader
                title="Driver Operations"
                subtitle={assignedShuttle ? `Assigned: ${assignedShuttle.plateNumber} · Auto Mode` : 'No assigned shuttle'}
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
                    {activeCommunityPickupIntents.length > 0 && (
                      <>
                        <View style={[styles.pickupSearchBar, { borderColor, backgroundColor: surfaceColor }]}>
                          <Ionicons name="search-outline" size={14} color={mutedColor} style={{ marginRight: 6 }} />
                          <TextInput
                            value={pickupSearchQuery}
                            onChangeText={setPickupSearchQuery}
                            placeholder="Search by name, destination, or note…"
                            placeholderTextColor={mutedColor}
                            style={[styles.pickupSearchInput, { color: textColor }]}
                            clearButtonMode="while-editing"
                            returnKeyType="search"
                            accessibilityLabel="Search pickup requests"
                          />
                          {pickupSearchQuery.length > 0 && (
                            <Pressable onPress={() => setPickupSearchQuery('')} hitSlop={8}>
                              <Ionicons name="close-circle" size={14} color={mutedColor} />
                            </Pressable>
                          )}
                        </View>
                        {filteredPickupIntents.length === 0 ? (
                          <ThemedText style={[styles.metaText, { color: mutedColor, marginTop: 6 }]}>No results for "{pickupSearchQuery}"</ThemedText>
                        ) : (
                          filteredPickupIntents.map((item, idx) => {
                            const guestNames = (item.passengerManifest || [])
                              .map((g) => g.name || 'Guest')
                              .join(', ');
                            const displayName = guestNames || 'Passenger';
                            const isPriority = item.fareType === 'priority';
                            return (
                              <View
                                key={item._id}
                                style={[
                                  styles.pickupQueueCard,
                                  {
                                    borderColor: isPriority ? '#f59e0b' : borderColor,
                                    backgroundColor: isPriority
                                      ? colorScheme === 'dark' ? '#3b2a10' : '#fffbeb'
                                      : colorScheme === 'dark' ? AppPalette.darkOverlaySoft : bgColor,
                                  },
                                  idx > 0 && { marginTop: 8 },
                                ]}
                              >
                                <View style={styles.pickupQueueCardHeader}>
                                  <View style={{ flex: 1 }}>
                                    <ThemedText style={[styles.pickupQueueName, { color: textColor }]} numberOfLines={1}>
                                      {displayName}
                                    </ThemedText>
                                    <View style={styles.pickupQueueDestRow}>
                                      <Ionicons name="location-outline" size={12} color={mutedColor} />
                                      <ThemedText style={[styles.pickupQueueDest, { color: mutedColor }]} numberOfLines={1}>
                                        {item.destinationLabel}
                                      </ThemedText>
                                    </View>
                                  </View>
                                  <View style={[styles.pickupQueueBadge, { backgroundColor: isPriority ? '#f59e0b' : tint }]}>
                                    <Ionicons name={isPriority ? 'flash' : 'car-outline'} size={10} color={palette.white} />
                                    <ThemedText style={styles.pickupQueueBadgeText}>
                                      {isPriority ? 'Priority' : 'Standard'}
                                    </ThemedText>
                                  </View>
                                </View>
                                {item.note ? (
                                  <View style={[styles.pickupQueueNote, { borderColor: tint + '33', backgroundColor: tint + '12' }]}>
                                    <Ionicons name="chatbubble-ellipses-outline" size={11} color={tint} style={{ marginTop: 1, marginRight: 5 }} />
                                    <ThemedText style={[styles.pickupQueueNoteText, { color: textColor }]} numberOfLines={3}>
                                      {item.note}
                                    </ThemedText>
                                  </View>
                                ) : null}
                              </View>
                            );
                          })
                        )}
                      </>
                    )}
                    <View style={styles.rowBetween}>
                      <ThemedText style={[styles.metaText, { color: mutedColor }]}>Shift Status</ThemedText>
                      <ThemedText style={[styles.valueSmallText, { color: isDriverOnShift ? successColor : dangerColor }]}>
                        {isDriverOnShift ? 'On Shift' : 'Off Shift'}
                      </ThemedText>
                    </View>
                    <View style={styles.rowBetween}>
                      <ThemedText style={[styles.metaText, { color: mutedColor }]}>Auto Sync</ThemedText>
                      <ThemedText style={[styles.valueSmallText, { color: textColor }]}>
                        {!isDriverOnShift
                          ? 'Paused (Off Shift)'
                          : autoSyncStatus === 'syncing'
                            ? 'Syncing...'
                            : autoSyncStatus === 'error'
                              ? 'Retrying'
                              : lastAutoSyncAt
                                ? `Last ${lastAutoSyncAt.toLocaleTimeString()}`
                                : 'Waiting'}
                      </ThemedText>
                    </View>
                  </View>

                  <View style={styles.quickActionRow}>
                    <PremiumButton
                      style={styles.quickActionBtn}
                      onPress={handleSyncLocation}
                      variant="secondary"
                      disabled={!isDriverOnShift}>
                      <Ionicons name="locate-outline" size={16} color={tint} />
                      <ThemedText style={[styles.quickActionTxt, { color: tint }]}>Sync Now</ThemedText>
                    </PremiumButton>
                  </View>
                  <View style={styles.statusSection}>
                    {activePassengerPickupVisible && activePassengerPickupRequest ? (
                      <View style={[styles.pickupRequestCard, { borderColor, backgroundColor: surfaceColor }]}>
                        <View style={styles.rowBetween}>
                          <ThemedText style={[styles.metaText, { color: mutedColor }]}>Active Pickup Request</ThemedText>
                          <ThemedText style={[styles.valueSmallText, { color: successColor }]}>Boarding</ThemedText>
                        </View>
                        <ThemedText style={[styles.valueText, { color: textColor }]}>{activePickupDestinationSummary || activePassengerPickupRequest.destinationLabel}</ThemedText>
                        <ThemedText style={[styles.metaText, { color: mutedColor }]}>Remaining passengers: {remainingManualPickupSlots}</ThemedText>
                        {activePickupManifestSummary ? (
                          <ThemedText style={[styles.metaText, { color: mutedColor }]}>Booking for: {activePickupManifestSummary}</ThemedText>
                        ) : null}
                        {activePassengerPickupRequest.note ? (
                          <ThemedText style={[styles.metaText, { color: mutedColor }]}>Note: {activePassengerPickupRequest.note}</ThemedText>
                        ) : null}
                      </View>
                    ) : null}
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

            </View>
          </ScrollView>

          {assignedShuttle && (
            <>
              <View style={styles.driverButtonRow}>
                <Pressable
                  style={[
                    styles.driverActionButton,
                    styles.driverBoardButton,
                    { backgroundColor: tint, borderColor: tint },
                    (boardingSubmitting || assignedShuttle.currentCapacity >= assignedShuttle.maxCapacity || !isDriverOnShift || !activePassengerPickupRequest || !isWithinPickupRadius || !activePassengerPickupFitsCapacity || remainingManualPickupSlots === 0) && styles.driverActionButtonDisabled,
                  ]}
                  onPress={onDriverBoard}
                  disabled={boardingSubmitting || assignedShuttle.currentCapacity >= assignedShuttle.maxCapacity || !isDriverOnShift || !activePassengerPickupRequest || !isWithinPickupRadius || !activePassengerPickupFitsCapacity || remainingManualPickupSlots === 0}
                  accessibilityRole="button"
                  accessibilityLabel="Board one passenger manually"
                >
                  <Ionicons name={boardingSubmitting ? 'time-outline' : 'add-circle-outline'} size={18} color={palette.white} />
                  <ThemedText style={[styles.driverActionButtonText, styles.driverActionButtonTextOnColor]}>
                    {boardingSubmitting ? 'Recording...' : `Board Passenger +1${remainingManualPickupSlots > 1 ? ` (${remainingManualPickupSlots} left)` : ''}`}
                  </ThemedText>
                </Pressable>

                <Pressable
                  style={[
                    styles.driverActionButton,
                    styles.driverUnboardButton,
                    { backgroundColor: surfaceColor, borderColor: dangerColor },
                    (unboardingSubmitting || assignedShuttle.currentCapacity === 0 || !isDriverOnShift || activeDropoffPassengerCount === 0 || !isWithinDropoffRadius) && styles.driverActionButtonDisabled,
                  ]}
                  onPress={onDriverUnboard}
                  disabled={unboardingSubmitting || assignedShuttle.currentCapacity === 0 || !isDriverOnShift || activeDropoffPassengerCount === 0 || !isWithinDropoffRadius}
                  accessibilityRole="button"
                  accessibilityLabel="Unboard one passenger manually"
                >
                  <Ionicons name={unboardingSubmitting ? 'time-outline' : 'remove-circle-outline'} size={18} color={dangerColor} />
                  <ThemedText style={[styles.driverActionButtonText, { color: dangerColor }]}> 
                    {unboardingSubmitting ? 'Recording...' : `Unboard Passenger${activeDropoffPassengerCount > 1 ? ` (${activeDropoffPassengerCount})` : ''}`}
                  </ThemedText>
                </Pressable>
              </View>

              <ThemedText
                style={[
                  styles.manualFallbackHint,
                  {
                    color: isManualAutomationCooldownActive
                      ? tint
                      : manualBoardFallbackEnabled || manualUnboardFallbackEnabled
                        ? successColor
                        : mutedColor,
                  },
                ]}>
                {manualFallbackStatusCopy}
              </ThemedText>
            </>
          )}
        </View>
      ) : (
        <View style={styles.passengerLayout}>
          <View style={[styles.mapWrap, styles.passengerMapWrap]}>
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
                onRegionChange={handlePassengerMapRegionChange}
              >
                {communityBoundary.length >= 3 ? (
                  <Polygon
                    coordinates={communityBoundary}
                    fillColor={AppPalette.navyOverlaySoft}
                    strokeColor={palette.navy}
                    strokeWidth={2}
                  />
                ) : null}

                {/* Phase Geofences - rendered with their configured colors */}
                {phaseGeofences.map((phase) => {
                  const ring = phase.boundaries?.coordinates?.[0] || [];
                  const coords = ring
                    .map((point) => {
                      const longitude = Number(point?.[0]);
                      const latitude = Number(point?.[1]);
                      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
                      return { latitude, longitude };
                    })
                    .filter((point): point is LatLng => point !== null);

                  if (coords.length < 3) return null;

                  // Convert hex color to rgba with low opacity for fill
                  const hexColor = phase.color || '#6366f1';
                  const r = parseInt(hexColor.slice(1, 3), 16);
                  const g = parseInt(hexColor.slice(3, 5), 16);
                  const b = parseInt(hexColor.slice(5, 7), 16);

                  return (
                    <Polygon
                      key={phase._id}
                      coordinates={coords}
                      fillColor={`rgba(${r}, ${g}, ${b}, 0.15)`}
                      strokeColor={hexColor}
                      strokeWidth={2}
                    />
                  );
                })}

                {/* Fixed Destinations */}
                {fixedDestinations.map((dest) => {
                  if (!dest.location?.coordinates) return null;
                  const [longitude, latitude] = dest.location.coordinates;
                  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
                  
                  const color = dest.color || '#94a3b8';
                  const r = parseInt(color.slice(1, 3), 16);
                  const g = parseInt(color.slice(3, 5), 16);
                  const b = parseInt(color.slice(5, 7), 16);

                  return [
                    <Circle
                      key={`passenger-dest-circle-${dest._id}`}
                      center={{ latitude, longitude }}
                      radius={dest.pickupRadiusMeters || 80}
                      fillColor={`rgba(${r}, ${g}, ${b}, 0.15)`}
                      strokeColor={color}
                      strokeWidth={2}
                    />,
                    <Marker
                      key={`passenger-dest-pin-${dest._id}`}
                      coordinate={{ latitude, longitude }}
                      title={dest.name}
                      description="Fixed Destination"
                      pinColor={color}
                      anchor={{ x: 0.5, y: 1 }}
                      accessible
                      accessibilityLabel={`Fixed Destination: ${dest.name}`}
                    />
                  ];
                })}

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
                      accessible
                      accessibilityLabel={`Shuttle ${item.label || item.plateNumber}, ${item.currentCapacity} of ${item.maxCapacity} seats occupied`}
                    >
                      <MapIndicator iconName="bus" />
                      <Callout tooltip>
                        <View style={[styles.calloutContainer, { backgroundColor: bgColor, borderColor }]}>
                          <ThemedText type="defaultSemiBold" style={{ color: textColor, fontSize: 14 }}>
                            {formatShuttleLabel(item.label, item.plateNumber)}
                          </ThemedText>
                          <View style={[styles.calloutSeparator, { backgroundColor: borderColor }]} />
                          <ThemedText type="caption" style={{ color: mutedColor, fontSize: 12 }}>
                            Capacity: {item.currentCapacity}/{item.maxCapacity}
                          </ThemedText>
                          <ThemedText
                            type="caption"
                            style={{
                              color: item.currentCapacity >= item.maxCapacity ? SemanticColors.error : SemanticColors.success,
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
                    const coordinate = getPickupIntentCoordinate(item);
                    if (!coordinate) return null;

                    const hasManifest = item.passengerManifest && item.passengerManifest.length > 0;

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
                        anchor={{ x: 0.5, y: 0.5 }}
                        accessible
                        accessibilityLabel="Your pickup request marker"
                      >
                        <MapIndicator iconName="person" />
                        <Callout tooltip>
                          <View style={[styles.calloutContainer, { backgroundColor: bgColor, borderColor }]}>
                            <ThemedText type="defaultSemiBold" style={{ color: textColor, fontSize: 14 }}>
                              Pickup Request
                            </ThemedText>
                            <View style={[styles.calloutSeparator, { backgroundColor: borderColor }]} />
                            {hasManifest ? (
                              item.passengerManifest!.map((guest, idx) => (
                                <View key={`guest-${idx}`} style={{ marginBottom: idx < item.passengerManifest!.length - 1 ? 4 : 0 }}>
                                  <ThemedText type="caption" style={{ color: textColor, fontSize: 12, fontWeight: '500' }}>
                                    {guest.name || `Guest ${idx + 1}`}
                                  </ThemedText>
                                  {guest.phone ? (
                                    <ThemedText type="caption" style={{ color: mutedColor, fontSize: 12 }}>
                                      {guest.phone}
                                    </ThemedText>
                                  ) : null}
                                </View>
                              ))
                            ) : (
                              <ThemedText type="caption" style={{ color: mutedColor, fontSize: 12 }}>
                                Passenger waiting
                              </ThemedText>
                            )}
                            {item.note ? (
                              <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: borderColor }}>
                                <ThemedText type="caption" style={{ color: tint, fontSize: 11, fontWeight: '600', marginBottom: 2 }}>
                                  Note
                                </ThemedText>
                                <ThemedText type="caption" style={{ color: textColor, fontSize: 12 }}>
                                  {item.note}
                                </ThemedText>
                              </View>
                            ) : null}
                          </View>
                        </Callout>
                      </Marker>,
                    ];
                  })}

              </MapView>
            ) : (
              <MapLoadingPlaceholder
                title="Loading Community Map"
                hint="Fetching geofence boundary"
              />
            )}
            {phaseGeofences.length > 0 || fixedDestinations.length > 0 ? (
              <View style={[styles.phaseLegend, { backgroundColor: surfaceColor, borderColor }]}>
                {phaseGeofences.length > 0 && (
                  <>
                    <Text style={[styles.phaseLegendTitle, { color: textColor }]}>Phases</Text>
                    {phaseGeofences.map((phase) => (
                      <View key={`passenger-legend-phase-${phase._id}`} style={styles.phaseLegendRow}>
                        <View style={[styles.phaseLegendDot, { backgroundColor: phase.color || '#6366f1' }]} />
                        <Text style={[styles.phaseLegendText, { color: textColor }]}>{formatPhaseLabel(phase.name)}</Text>
                      </View>
                    ))}
                  </>
                )}
                {fixedDestinations.length > 0 && (
                  <>
                    <Text style={[styles.phaseLegendTitle, { color: textColor, marginTop: phaseGeofences.length > 0 ? 4 : 0 }]}>Fixed Locations</Text>
                    {fixedDestinations.map((dest) => (
                      <View key={`passenger-legend-dest-${dest._id}`} style={styles.phaseLegendRow}>
                        <View style={[styles.phaseLegendDot, { backgroundColor: dest.color || '#94a3b8' }]} />
                        <Text style={[styles.phaseLegendText, { color: textColor }]}>{dest.name.replace(/_/g, ' ')}</Text>
                      </View>
                    ))}
                  </>
                )}
              </View>
            ) : null}

            <View style={styles.mapLockBadge}>
              <Ionicons name="lock-closed" size={12} color={palette.white} />
              <ThemedText style={styles.mapLockText}>Map Locked to Community</ThemedText>
            </View>
          </View>

          {feedbackBanner}

          <ScrollView
            style={styles.sheetWrap}
            contentContainerStyle={styles.sheet}
            bounces={false}
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
          >
            <View style={[styles.sheetHandle, { backgroundColor: borderColor }]} />
            <View style={[styles.passengerHubCard, { borderColor, backgroundColor: surfaceColor }]}>
              <SectionHeader
                title="Ride Center"
                subtitle="Choose where you want to go, then request the next available shuttle."
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

              {pickupOriginCopy ? (
                <View style={[styles.dispatchHintCard, { borderColor, backgroundColor: bgColor }]}> 
                  <Ionicons name="people-outline" size={14} color={tint} />
                  <ThemedText style={[styles.dispatchHintText, { color: textColor }]}>{pickupOriginCopy}</ThemedText>
                </View>
              ) : null}

              {user?.role === 'passenger' ? (
                <View style={[styles.manifestCard, { borderColor, backgroundColor: bgColor }]}> 
                  <Pressable 
                    style={styles.manifestHeaderRow}
                    onPress={toggleBookForOthers}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: bookForOthers }}
                    accessibilityLabel="Toggle booking for another passenger"
                  >
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <ThemedText style={[styles.manifestTitle, { color: textColor }]}>Book for someone else</ThemedText>
                      <ThemedText style={[styles.manifestCaption, { color: mutedColor }]}>Optional. Add guest names so the driver can match the ride request.</ThemedText>
                    </View>
                    <Switch
                      value={bookForOthers}
                      onValueChange={toggleBookForOthers}
                      trackColor={{ false: borderColor, true: tint }}
                      thumbColor={Platform.OS === 'android' ? (bookForOthers ? palette.white : '#f4f3f4') : undefined}
                    />
                  </Pressable>

                  {bookForOthers ? (
                    <View style={styles.manifestList}>
                      {/* Guest Passenger Details */}
                      <View style={[styles.manifestSection, { borderColor, backgroundColor: surfaceColor }]}>
                        <View style={styles.manifestSectionHeader}>
                          <View style={[styles.manifestIconBadge, { backgroundColor: colorScheme === 'dark' ? AppPalette.darkOverlaySoft : palette.slateBg }]}>
                            <Ionicons name="people" size={16} color={tint} />
                          </View>
                          <View>
                            <ThemedText style={[styles.manifestRowLabel, { color: textColor }]}>Guest Details</ThemedText>
                            <ThemedText style={[styles.manifestCaption, { color: mutedColor }]}>Who are you booking for?</ThemedText>
                          </View>
                        </View>
                        
                        {manifestDraft.map((entry, index) => (
                          <View key={entry.id} style={[styles.manifestInputGroup, { borderColor: colorScheme === 'dark' ? AppPalette.darkOverlaySoft : AppPalette.slateBorder, backgroundColor: bgColor }]}> 
                            <View style={styles.manifestRowHeader}>
                              <ThemedText style={[styles.manifestGuestLabel, { color: tint }]}>Passenger {index + 1}</ThemedText>
                              {manifestDraft.length > 1 ? (
                                <Pressable onPress={() => removeManifestEntry(entry.id)} accessibilityRole="button" accessibilityLabel={`Remove guest ${index + 1}`} style={{ padding: 4 }}>
                                  <Ionicons name="close-circle" size={18} color={dangerColor} />
                                </Pressable>
                              ) : null}
                            </View>
                            <View style={[styles.manifestInputWrapper, { borderColor, backgroundColor: surfaceColor }]}>
                              <Ionicons name="person-outline" size={14} color={mutedColor} style={styles.manifestInputIcon} />
                              <TextInput
                                value={entry.name}
                                onChangeText={(value) => updateManifestEntry(entry.id, 'name', value)}
                                placeholder="Full name"
                                placeholderTextColor={mutedColor}
                                style={[styles.manifestInputBare, { color: textColor }]}
                              />
                            </View>
                          </View>
                        ))}

                        {manifestDraft.length < 5 ? (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Add another guest"
                            onPress={addManifestEntry}
                            style={({ pressed }) => [
                              styles.manifestAddButton,
                              { borderColor: tint, backgroundColor: colorScheme === 'dark' ? AppPalette.darkSkyBg : AppPalette.sky },
                              pressed && { opacity: 0.7 },
                            ]}
                          >
                            <Ionicons name="add-circle" size={16} color={tint} />
                            <ThemedText style={[styles.manifestAddText, { color: tint }]}>Add Another Guest</ThemedText>
                          </Pressable>
                        ) : (
                          <ThemedText style={[styles.manifestCaption, { color: mutedColor, textAlign: 'center', marginTop: 8 }]}>
                            Max 5 passengers (shuttle capacity reached)
                          </ThemedText>
                        )}
                      </View>

                      {/* Guest Pickup */}
                      <View style={[styles.manifestSection, { borderColor, backgroundColor: surfaceColor }]}> 
                        <View style={styles.manifestSectionHeader}>
                          <View style={[styles.manifestIconBadge, { backgroundColor: colorScheme === 'dark' ? AppPalette.darkOverlaySoft : palette.slateBg }]}>
                            <Ionicons name="location" size={16} color={tint} />
                          </View>
                          <View>
                            <ThemedText style={[styles.manifestRowLabel, { color: textColor }]}>Pickup Location</ThemedText>
                            <ThemedText style={[styles.manifestCaption, { color: mutedColor }]}>Where should we pick them up?</ThemedText>
                          </View>
                        </View>
                        
                        <View style={styles.manifestActionRow}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Guest pickup fixed"
                            onPress={() => setGuestPickupType('fixed')}
                            style={({ pressed }) => [
                              styles.manifestActionButton,
                              { 
                                borderColor: guestPickupType === 'fixed' ? tint : borderColor, 
                                backgroundColor: guestPickupType === 'fixed' ? tint : bgColor 
                              },
                              pressed && styles.manifestTogglePressed,
                            ]}
                          >
                            <Ionicons name="flag" size={16} color={guestPickupType === 'fixed' ? palette.white : tint} />
                            <ThemedText style={[styles.manifestActionText, { color: guestPickupType === 'fixed' ? palette.white : tint }]}>Fixed Destination</ThemedText>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Guest pickup home"
                            onPress={() => setGuestPickupType('home')}
                            style={({ pressed }) => [
                              styles.manifestActionButton,
                              { 
                                borderColor: guestPickupType === 'home' ? successColor : borderColor, 
                                backgroundColor: guestPickupType === 'home' ? successColor : bgColor 
                              },
                              pressed && styles.manifestTogglePressed,
                            ]}
                          >
                            <Ionicons name="home" size={16} color={guestPickupType === 'home' ? palette.white : successColor} />
                            <ThemedText style={[styles.manifestActionText, { color: guestPickupType === 'home' ? palette.white : successColor }]}>Home</ThemedText>
                          </Pressable>
                        </View>

                        {guestPickupType === 'fixed' ? (
                          <View style={styles.fixedDestinationList}>
                            {fixedDestinations.length === 0 ? (
                              <ThemedText style={[styles.manifestCaption, { color: dangerColor, marginTop: 8 }]}>No fixed destinations configured by admin.</ThemedText>
                            ) : null}
                            {fixedDestinations.map((d) => (
                              <Pressable
                                key={d._id}
                                onPress={() => setGuestPickupFixedId(d._id)}
                                accessibilityRole="button"
                                style={({ pressed }) => [
                                  styles.manifestFixedOption,
                                  { borderColor: guestPickupFixedId === d._id ? tint : borderColor, backgroundColor: guestPickupFixedId === d._id ? colorScheme === 'dark' ? AppPalette.darkSkyBg : AppPalette.sky : bgColor },
                                  pressed && { opacity: 0.7 },
                                ]}
                              >
                                <Ionicons name={guestPickupFixedId === d._id ? "radio-button-on" : "radio-button-off"} size={16} color={guestPickupFixedId === d._id ? tint : mutedColor} />
                                <ThemedText style={{ color: guestPickupFixedId === d._id ? tint : textColor, fontFamily: guestPickupFixedId === d._id ? OutfitFonts.bold : OutfitFonts.medium }}>{d.name}</ThemedText>
                              </Pressable>
                            ))}
                          </View>
                        ) : (
                          <View style={[styles.manifestHomeNotice, { backgroundColor: colorScheme === 'dark' ? AppPalette.darkMintBg : AppPalette.mint, borderColor: successColor }]}>
                            <Ionicons name="information-circle" size={16} color={successColor} />
                            <ThemedText style={[styles.manifestCaption, { color: successColor, flex: 1 }]}>Uses the passenger's home GPS coordinate.</ThemedText>
                          </View>
                        )}
                      </View>

                      {/* Guest Drop-off */}
                      <View style={[styles.manifestSection, { borderColor, backgroundColor: surfaceColor }]}> 
                        <View style={styles.manifestSectionHeader}>
                          <View style={[styles.manifestIconBadge, { backgroundColor: colorScheme === 'dark' ? AppPalette.darkOverlaySoft : palette.slateBg }]}>
                            <Ionicons name="navigate" size={16} color={tint} />
                          </View>
                          <View>
                            <ThemedText style={[styles.manifestRowLabel, { color: textColor }]}>Drop-off Location</ThemedText>
                            <ThemedText style={[styles.manifestCaption, { color: mutedColor }]}>Where are they going?</ThemedText>
                          </View>
                        </View>
                        
                        <View style={styles.manifestActionRow}>
                          {guestPickupType !== 'fixed' && (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Guest dropoff fixed"
                              onPress={() => setGuestDropoffType('fixed')}
                              style={({ pressed }) => [
                                styles.manifestActionButton,
                                { 
                                  borderColor: guestDropoffType === 'fixed' ? tint : borderColor, 
                                  backgroundColor: guestDropoffType === 'fixed' ? tint : bgColor 
                                },
                                pressed && styles.manifestTogglePressed,
                              ]}
                            >
                              <Ionicons name="flag" size={16} color={guestDropoffType === 'fixed' ? palette.white : tint} />
                              <ThemedText style={[styles.manifestActionText, { color: guestDropoffType === 'fixed' ? palette.white : tint }]}>Fixed Destination</ThemedText>
                            </Pressable>
                          )}
                          {guestPickupType !== 'home' && (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel="Guest dropoff home"
                              onPress={() => setGuestDropoffType('home')}
                              style={({ pressed }) => [
                                styles.manifestActionButton,
                                { 
                                  borderColor: guestDropoffType === 'home' ? successColor : borderColor, 
                                  backgroundColor: guestDropoffType === 'home' ? successColor : bgColor 
                                },
                                pressed && styles.manifestTogglePressed,
                              ]}
                            >
                              <Ionicons name="home" size={16} color={guestDropoffType === 'home' ? palette.white : successColor} />
                              <ThemedText style={[styles.manifestActionText, { color: guestDropoffType === 'home' ? palette.white : successColor }]}>Home</ThemedText>
                            </Pressable>
                          )}
                        </View>

                        {guestDropoffType === 'fixed' ? (
                          <View style={styles.fixedDestinationList}>
                            {fixedDestinations.length === 0 ? (
                              <ThemedText style={[styles.manifestCaption, { color: dangerColor, marginTop: 8 }]}>No fixed destinations configured by admin.</ThemedText>
                            ) : null}
                            {fixedDestinations.map((d) => (
                              <Pressable
                                key={d._id}
                                onPress={() => setGuestDropoffFixedId(d._id)}
                                accessibilityRole="button"
                                style={({ pressed }) => [
                                  styles.manifestFixedOption,
                                  { borderColor: guestDropoffFixedId === d._id ? tint : borderColor, backgroundColor: guestDropoffFixedId === d._id ? colorScheme === 'dark' ? AppPalette.darkSkyBg : AppPalette.sky : bgColor },
                                  pressed && { opacity: 0.7 },
                                ]}
                              >
                                <Ionicons name={guestDropoffFixedId === d._id ? "radio-button-on" : "radio-button-off"} size={16} color={guestDropoffFixedId === d._id ? tint : mutedColor} />
                                <ThemedText style={{ color: guestDropoffFixedId === d._id ? tint : textColor, fontFamily: guestDropoffFixedId === d._id ? OutfitFonts.bold : OutfitFonts.medium }}>{d.name}</ThemedText>
                              </Pressable>
                            ))}
                          </View>
                        ) : (
                          <View style={[styles.manifestHomeNotice, { backgroundColor: colorScheme === 'dark' ? AppPalette.darkMintBg : AppPalette.mint, borderColor: successColor }]}>
                            <Ionicons name="information-circle" size={16} color={successColor} />
                            <ThemedText style={[styles.manifestCaption, { color: successColor, flex: 1 }]}>Uses the passenger's home GPS coordinate.</ThemedText>
                          </View>
                        )}
                      </View>

                      {/* Per-Guest Discounts */}
                      {manifestDraft.map((guest, idx) => (
                        <View key={guest.id} style={[styles.manifestSection, { borderColor, backgroundColor: surfaceColor, marginTop: idx === 0 ? 0 : 8 }]}> 
                          <View style={styles.manifestSectionHeader}>
                            <View style={[styles.manifestIconBadge, { backgroundColor: colorScheme === 'dark' ? AppPalette.darkOverlaySoft : palette.slateBg }]}> 
                              <Ionicons name="pricetag" size={16} color={tint} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <ThemedText style={[styles.manifestRowLabel, { color: textColor }]}>{guest.name || `Guest ${idx + 1}`} - Discount</ThemedText>
                              <ThemedText style={[styles.manifestCaption, { color: mutedColor }]}>Select if this guest qualifies for a discount.</ThemedText>
                            </View>
                          </View>

                          <View style={styles.manifestActionRow}>
                            {([
                              { key: 'none', label: 'None' },
                              { key: 'student', label: 'Student' },
                              { key: 'pwd', label: 'PWD' },
                              { key: 'senior', label: 'Senior' },
                            ] as const).map(({ key, label }) => (
                              <Pressable
                                key={`${guest.id}-${key}`}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: guest.discountType === key }}
                                onPress={() => {
                                  setManifestDraft((draft) =>
                                    draft.map((entry) =>
                                      entry.id === guest.id ? { ...entry, discountType: key } : entry
                                    )
                                  );
                                }}
                                style={({ pressed }) => [
                                  styles.manifestActionButton,
                                  {
                                    borderColor: guest.discountType === key ? tint : borderColor,
                                    backgroundColor: guest.discountType === key ? tint : bgColor,
                                  },
                                  pressed && styles.manifestTogglePressed,
                                ]}
                              >
                                <ThemedText style={[styles.manifestActionText, { color: guest.discountType === key ? palette.white : tint }]}>{label}</ThemedText>
                              </Pressable>
                            ))}
                          </View>
                        </View>
                      ))}

                      {guestBookingFareBreakdown ? (
                        <View style={[styles.manifestSection, { borderColor, backgroundColor: bgColor }]}> 
                          <View style={styles.manifestSectionHeader}>
                            <View style={[styles.manifestIconBadge, { backgroundColor: colorScheme === 'dark' ? AppPalette.darkOverlaySoft : palette.slateBg }]}> 
                              <Ionicons name="receipt-outline" size={16} color={tint} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <ThemedText style={[styles.manifestRowLabel, { color: textColor }]}>Estimated Fare Breakdown</ThemedText>
                              <ThemedText style={[styles.manifestCaption, { color: mutedColor }]}>Per guest estimate before driver boarding confirmation.</ThemedText>
                            </View>
                          </View>

                          {guestBookingFareBreakdown.rows.map((row) => (
                            <View key={row.id} style={styles.rowBetween}>
                              <ThemedText style={[styles.manifestCaption, { color: textColor }]}>
                                {row.label}{row.discountType !== 'none' ? ` · ${row.discountType.toUpperCase()} ${row.discountPct}%` : ''}
                              </ThemedText>
                              <ThemedText style={[styles.manifestCaption, { color: row.discountType !== 'none' ? tint : textColor, fontFamily: OutfitFonts.bold }]}>
                                ₱{row.finalFare.toFixed(2)}
                              </ThemedText>
                            </View>
                          ))}

                          <View style={[styles.rowBetween, { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: borderColor }]}> 
                            <ThemedText style={[styles.manifestRowLabel, { color: textColor }]}>Estimated Total</ThemedText>
                            <ThemedText style={[styles.manifestRowLabel, { color: tint }]}>₱{guestBookingFareBreakdown.total.toFixed(2)}</ThemedText>
                          </View>
                        </View>
                      ) : null}
                    </View>
                  ) : (
                    <ThemedText style={[styles.manifestCaption, { color: mutedColor }]}>Keep this off to book only for yourself.</ThemedText>
                  )}
                </View>
              ) : null}

              {!bookForOthers ? (
                allowedPickupDestinationTypes.length > 0 ? (
                  <View style={styles.destinationTypeRow}>
                  {canUsePickupDestinationType('fixed') ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Choose fixed destination"
                      accessibilityHint="Use a community destination configured by your admin"
                      accessibilityState={{ selected: selectedDestinationType === 'fixed' }}
                      style={({ pressed }) => [
                        styles.destinationTypeCard,
                        selectedDestinationType === 'fixed'
                          ? [styles.destinationTypeCardActive, { borderColor: tint, backgroundColor: tint }]
                          : [
                              styles.destinationTypeCardInactive,
                              {
                                borderColor: tint,
                                backgroundColor: colorScheme === 'dark' ? AppPalette.darkSkyBg : AppPalette.sky,
                              },
                            ],
                        pressed && styles.destinationTypeCardPressed,
                      ]}
                      onPress={handleSelectFixedDestinationType}
                    >
                      <View style={styles.destinationTypeCardLead}>
                        <View
                          style={[
                            styles.destinationTypeIconBubble,
                            {
                              backgroundColor:
                                selectedDestinationType === 'fixed'
                                  ? 'rgba(255,255,255,0.22)'
                                  : colorScheme === 'dark'
                                    ? AppPalette.darkOverlaySoft
                                    : palette.white,
                            },
                          ]}>
                          <Ionicons
                            name="flag-outline"
                            size={16}
                            color={selectedDestinationType === 'fixed' ? palette.white : tint}
                          />
                        </View>
                        <View style={styles.destinationTypeLabelWrap}>
                          <ThemedText
                            numberOfLines={1}
                            style={[
                              styles.destinationTypeLabel,
                              { color: selectedDestinationType === 'fixed' ? palette.white : tint },
                            ]}>
                            Fixed destination
                          </ThemedText>
                          <ThemedText
                            numberOfLines={1}
                            style={[
                              styles.destinationTypeCaption,
                              { color: selectedDestinationType === 'fixed' ? 'rgba(255,255,255,0.82)' : mutedColor },
                            ]}>
                            Community destination
                          </ThemedText>
                        </View>
                      </View>
                      <Ionicons
                        name={selectedDestinationType === 'fixed' ? 'checkmark-circle' : 'chevron-forward'}
                        size={16}
                        color={selectedDestinationType === 'fixed' ? palette.white : tint}
                      />
                    </Pressable>
                  ) : null}

                  {canUsePickupDestinationType('home') ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Choose home destination"
                      accessibilityHint="Request pickup to your saved home destination"
                      accessibilityState={{ selected: selectedDestinationType === 'home' }}
                      style={({ pressed }) => [
                        styles.destinationTypeCard,
                        selectedDestinationType === 'home'
                          ? [styles.destinationTypeCardActive, { borderColor: successColor, backgroundColor: successColor }]
                          : [
                              styles.destinationTypeCardInactive,
                              {
                                borderColor: successColor,
                                backgroundColor: colorScheme === 'dark' ? AppPalette.darkMintBg : AppPalette.mint,
                              },
                            ],
                        pressed && styles.destinationTypeCardPressed,
                      ]}
                      onPress={handleSelectHomeDestinationType}
                    >
                      <View style={styles.destinationTypeCardLead}>
                        <View
                          style={[
                            styles.destinationTypeIconBubble,
                            {
                              backgroundColor:
                                selectedDestinationType === 'home'
                                  ? 'rgba(255,255,255,0.22)'
                                  : colorScheme === 'dark'
                                    ? AppPalette.darkOverlaySoft
                                    : palette.white,
                            },
                          ]}>
                          <Ionicons
                            name="home-outline"
                            size={16}
                            color={selectedDestinationType === 'home' ? palette.white : successColor}
                          />
                        </View>
                        <View style={styles.destinationTypeLabelWrap}>
                          <ThemedText
                            numberOfLines={1}
                            style={[
                              styles.destinationTypeLabel,
                              { color: selectedDestinationType === 'home' ? palette.white : successColor },
                            ]}>
                            Home destination
                          </ThemedText>
                          <ThemedText
                            numberOfLines={1}
                            style={[
                              styles.destinationTypeCaption,
                              { color: selectedDestinationType === 'home' ? 'rgba(255,255,255,0.82)' : mutedColor },
                            ]}>
                            Saved GPS destination
                          </ThemedText>
                        </View>
                      </View>
                      <Ionicons
                        name={selectedDestinationType === 'home' ? 'checkmark-circle' : 'chevron-forward'}
                        size={16}
                        color={selectedDestinationType === 'home' ? palette.white : successColor}
                      />
                    </Pressable>
                  ) : null}
                  </View>
                ) : (
                  <View style={[styles.destinationPromptCard, { borderColor, backgroundColor: colorScheme === 'dark' ? AppPalette.darkSkyBg : AppPalette.sky }]}> 
                    <Ionicons name="location-outline" size={14} color={tint} />
                    <ThemedText style={[styles.destinationPromptText, { color: textColor }]}>Save your home address or configure fixed destinations to enable pickup requests.</ThemedText>
                  </View>
                )
              ) : null}

              {!bookForOthers && (
                selectedDestinationType === 'fixed' ? (
                  <View style={styles.statusSection}>
                    <ThemedText style={[styles.metaText, { color: mutedColor }]}>Select destination</ThemedText>
                    {fixedDestinations.length === 0 ? (
                      <ThemedText style={[styles.metaText, { color: dangerColor }]}>No fixed destinations configured by admin yet.</ThemedText>
                    ) : null}
                    {fixedDestinations.map((item) => (
                      <FixedDestinationChip
                        key={item._id}
                        item={item}
                        selected={selectedFixedDestinationId === item._id}
                        borderColor={borderColor}
                        bgColor={bgColor}
                        textColor={textColor}
                        tint={tint}
                        onSelect={handleSelectFixedDestination}
                      />
                    ))}
                  </View>
                ) : selectedDestinationType === 'home' ? (
                  <ThemedText style={[styles.metaText, { color: mutedColor }]}>Home destination uses your GPS location.</ThemedText>
                ) : (
                  <View
                    style={[
                      styles.destinationPromptCard,
                      {
                        borderColor,
                        backgroundColor: colorScheme === 'dark' ? AppPalette.darkSkyBg : AppPalette.sky,
                      },
                    ]}
                  >
                    <Ionicons name="arrow-up-circle-outline" size={14} color={tint} />
                    <ThemedText style={[styles.destinationPromptText, { color: textColor }]}>Pick Fixed or Home above to unlock pickup requests.</ThemedText>
                  </View>
                )
              )}

              {!bookForOthers ? (
                <View
                  style={[
                    styles.destinationIndicatorCard,
                    {
                      borderColor: selectedDestinationAccentColor,
                      backgroundColor: selectedDestinationCardBackground,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.destinationIndicatorIconBadge,
                      {
                        borderColor: selectedDestinationAccentColor,
                        backgroundColor: colorScheme === 'dark' ? AppPalette.darkOverlaySoft : palette.white,
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
                      size={13}
                      color={selectedDestinationAccentColor}
                    />
                  </View>
                  <View style={styles.destinationIndicatorCopy}>
                    <View style={styles.destinationIndicatorHeaderRow}>
                      <ThemedText style={[styles.destinationIndicatorLabel, { color: selectedDestinationAccentColor }]}>Selected Destination</ThemedText>
                      <View
                        style={[
                          styles.destinationIndicatorTypePill,
                          {
                            backgroundColor: colorScheme === 'dark' ? AppPalette.darkOverlaySoft : palette.white,
                          },
                        ]}
                      >
                        <ThemedText style={[styles.destinationIndicatorTypeText, { color: selectedDestinationAccentColor }]}> 
                          {selectedDestinationType === 'home'
                            ? 'HOME'
                            : selectedDestinationType === 'fixed'
                              ? 'FIXED'
                              : 'NONE'}
                        </ThemedText>
                      </View>
                    </View>
                    <ThemedText numberOfLines={2} style={[styles.destinationIndicatorValue, { color: textColor }]}>{selectedDestinationSummary}</ThemedText>
                  </View>
                </View>
              ) : null}

              {/* ── Passenger Count Stepper ─────────────────────────────────── */}
              {!bookForOthers && activePassengerPickupIntents.length === 0 && (
                <>
                  <View style={[
                    styles.passengerCountCard,
                    { borderColor, backgroundColor: bgColor },
                  ]}>
                    <View style={styles.passengerCountLeft}>
                      <Ionicons name="people-outline" size={18} color={tint} />
                      <View style={{ flex: 1 }}>
                        <ThemedText style={[styles.manifestRowLabel, { color: textColor }]}>
                          Number of Passengers
                        </ThemedText>
                        <ThemedText style={[styles.manifestCaption, { color: mutedColor }]}>
                          {passengerCount === 1 ? 'Just me' : `${passengerCount} seats will be reserved`}
                        </ThemedText>
                      </View>
                    </View>
                    <View style={styles.passengerCountStepper}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Decrease passenger count"
                        disabled={passengerCount <= 1}
                        onPress={() => setPassengerCount((c) => Math.max(1, c - 1))}
                        style={({ pressed }) => [
                          styles.passengerCountBtn,
                          { borderColor: passengerCount <= 1 ? borderColor : tint, backgroundColor: bgColor },
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <Ionicons name="remove" size={16} color={passengerCount <= 1 ? mutedColor : tint} />
                      </Pressable>
                      <ThemedText style={[styles.passengerCountValue, { color: textColor }]}>
                        {passengerCount}
                      </ThemedText>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Increase passenger count"
                        disabled={passengerCount >= 5}
                        onPress={() => setPassengerCount((c) => Math.min(5, c + 1))}
                        style={({ pressed }) => [
                          styles.passengerCountBtn,
                          { borderColor: passengerCount >= 5 ? borderColor : tint, backgroundColor: bgColor },
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <Ionicons name="add" size={16} color={passengerCount >= 5 ? mutedColor : tint} />
                      </Pressable>
                    </View>
                  </View>
                  {passengerCount >= 5 && (
                    <ThemedText style={[styles.manifestCaption, { color: mutedColor, textAlign: 'center', marginTop: 6 }]}>
                      Max 5 passengers (shuttle capacity reached)
                    </ThemedText>
                  )}

                  <View style={[styles.manifestSection, { borderColor, backgroundColor: surfaceColor, marginTop: 10 }]}> 
                    <View style={styles.manifestSectionHeader}>
                      <View style={[styles.manifestIconBadge, { backgroundColor: colorScheme === 'dark' ? AppPalette.darkOverlaySoft : palette.slateBg }]}> 
                        <Ionicons name="pricetag" size={16} color={tint} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <ThemedText style={[styles.manifestRowLabel, { color: textColor }]}>Passenger Discounts</ThemedText>
                        <ThemedText style={[styles.manifestCaption, { color: mutedColor }]}>Set discount per passenger. Your account discount is validated automatically.</ThemedText>
                      </View>
                    </View>

                    {selfPassengerDraft.map((entry, idx) => (
                      <View
                        key={entry.id}
                        style={{
                          marginTop: idx === 0 ? 8 : 10,
                          paddingTop: idx === 0 ? 0 : 10,
                          borderTopWidth: idx === 0 ? 0 : 1,
                          borderTopColor: borderColor,
                        }}
                      >
                        <ThemedText style={[styles.manifestCaption, { color: textColor, marginBottom: 6 }]}> 
                          {entry.isOwner ? `${entry.name} (You)` : entry.name}
                        </ThemedText>

                        <View style={styles.manifestActionRow}>
                          {([
                            { key: 'none', label: 'None' },
                            { key: 'student', label: 'Student' },
                            { key: 'pwd', label: 'PWD' },
                            { key: 'senior', label: 'Senior' },
                          ] as const).map(({ key, label }) => (
                            <Pressable
                              key={`${entry.id}-${key}`}
                              accessibilityRole="radio"
                              accessibilityState={{ checked: entry.discountType === key }}
                              disabled={entry.isOwner}
                              onPress={() => {
                                setSelfPassengerDraft((draft) =>
                                  draft.map((p) =>
                                    p.id === entry.id ? { ...p, discountType: key } : p
                                  )
                                );
                              }}
                              style={({ pressed }) => [
                                styles.manifestActionButton,
                                {
                                  borderColor: entry.discountType === key ? tint : borderColor,
                                  backgroundColor: entry.discountType === key ? tint : bgColor,
                                  opacity: entry.isOwner ? 0.65 : 1,
                                },
                                pressed && !entry.isOwner && styles.manifestTogglePressed,
                              ]}
                            >
                              <ThemedText style={[styles.manifestActionText, { color: entry.discountType === key ? palette.white : tint }]}>{label}</ThemedText>
                            </Pressable>
                          ))}
                        </View>

                        {entry.isOwner ? (
                          <ThemedText style={[styles.manifestCaption, { color: mutedColor, marginTop: 6 }]}> 
                            Owner discount depends on your account verification status.
                          </ThemedText>
                        ) : null}
                      </View>
                    ))}
                  </View>
                </>
              )}

              {/* ── Fare Type Selector ─────────────────────────────────────── */}
              {activePassengerPickupIntents.length === 0 && (
                <View style={styles.fareTypeRow}>

                  {/* Standard pill */}
                  <Pressable
                    style={[
                      styles.fareTypePill,
                      !fareType || fareType !== 'standard' && {
                        borderColor: colorScheme === 'dark' ? borderColor : AppPalette.slateBorder,
                        backgroundColor: colorScheme === 'dark' ? AppPalette.darkSkyBg : AppPalette.slateBg,
                      },
                      fareType === 'standard' && styles.fareTypePillActive,
                      fareType === 'standard' && {
                        borderColor: tint,
                        backgroundColor: colorScheme === 'dark' ? AppPalette.darkSkyBg : AppPalette.sky,
                      },
                    ]}
                    onPress={() => setFareType('standard')}
                    accessibilityRole="button"
                    accessibilityLabel="Select standard fare"
                  >
                    {/* Icon + label row */}
                    <View style={styles.fareTypePillLabelRow}>
                      <Ionicons
                        name="car-outline"
                        size={15}
                        color={fareType === 'standard' ? tint : mutedColor}
                      />
                      <ThemedText
                        style={[
                          styles.fareTypePillLabel,
                          { color: fareType === 'standard' ? tint : mutedColor },
                        ]}
                      >
                        Standard
                      </ThemedText>
                    </View>
                    {/* Fare amount */}
                    <ThemedText
                      style={[
                        styles.fareTypePillAmount,
                        { color: fareType === 'standard' ? tint : textColor },
                      ]}
                    >
                      {communityFares
                        ? farePassengerCount > 1
                          ? `₱${(communityFares.base * farePassengerCount).toFixed(2)}`
                          : `₱${communityFares.base.toFixed(2)}`
                        : '—'}
                    </ThemedText>
                    {farePassengerCount > 1 && communityFares ? (
                      <ThemedText style={[styles.fareTypeSkipText, { color: mutedColor }]}>
                        ₱{communityFares.base.toFixed(2)} × {farePassengerCount}
                      </ThemedText>
                    ) : null}
                  </Pressable>

                  {/* Priority pill */}
                  <Pressable
                    style={[
                      styles.fareTypePill,
                      !fareType || fareType !== 'priority' && {
                        borderColor: colorScheme === 'dark' ? borderColor : AppPalette.slateBorder,
                        backgroundColor: colorScheme === 'dark' ? AppPalette.darkMintBg : AppPalette.slateBg,
                      },
                      fareType === 'priority' && styles.fareTypePillActive,
                      fareType === 'priority' && {
                        borderColor: '#f59e0b',
                        backgroundColor: colorScheme === 'dark' ? '#5C3d1f' : '#fffbeb',
                      },
                    ]}
                    onPress={() => setFareType('priority')}
                    accessibilityRole="button"
                    accessibilityLabel="Select priority fare"
                  >
                    {/* Icon + label row */}
                    <View style={styles.fareTypePillLabelRow}>
                      <Ionicons
                        name="flash"
                        size={15}
                        color={fareType === 'priority' ? '#f59e0b' : mutedColor}
                      />
                      <ThemedText
                        style={[
                          styles.fareTypePillLabel,
                          { color: fareType === 'priority' ? '#f59e0b' : mutedColor },
                        ]}
                      >
                        Priority
                      </ThemedText>
                    </View>
                    {/* Fare amount */}
                    <ThemedText
                      style={[
                        styles.fareTypePillAmount,
                        { color: fareType === 'priority' ? '#f59e0b' : textColor },
                      ]}
                    >
                      {communityFares
                        ? farePassengerCount > 1
                          ? `₱${(communityFares.base * communityFares.priorityMultiplier * farePassengerCount).toFixed(2)}`
                          : `₱${(communityFares.base * communityFares.priorityMultiplier).toFixed(2)}`
                        : '—'}
                    </ThemedText>
                    {farePassengerCount > 1 && communityFares ? (
                      <ThemedText style={[styles.fareTypeSkipText, { color: '#d97706' }]}>
                        ₱{(communityFares.base * communityFares.priorityMultiplier).toFixed(2)} × {farePassengerCount}
                      </ThemedText>
                    ) : null}
                    {/* Skip queue badge */}
                    <View
                      style={[
                        styles.fareTypeSkipBadge,
                        {
                          backgroundColor: fareType === 'priority'
                            ? colorScheme === 'dark' ? '#6B4423' : '#fef3c7'
                            : colorScheme === 'dark' ? AppPalette.darkOverlaySoft : AppPalette.slateBg,
                          borderColor: fareType === 'priority' ? '#f59e0b' : AppPalette.slateBorder,
                        },
                      ]}
                    >
                      <ThemedText
                        style={[
                          styles.fareTypeSkipText,
                          { color: fareType === 'priority' ? '#fbbf24' : mutedColor },
                        ]}
                      >
                        ⚡ Skip queue
                      </ThemedText>
                    </View>
                  </Pressable>

                </View>
              )}

              {!bookForOthers && activePassengerPickupIntents.length === 0 && regularBookingFareBreakdown ? (
                <View style={[styles.manifestSection, { borderColor, backgroundColor: bgColor, marginTop: 10 }]}> 
                  <View style={styles.manifestSectionHeader}>
                    <View style={[styles.manifestIconBadge, { backgroundColor: colorScheme === 'dark' ? AppPalette.darkOverlaySoft : palette.slateBg }]}> 
                      <Ionicons name="receipt-outline" size={16} color={tint} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={[styles.manifestRowLabel, { color: textColor }]}>Estimated Fare Breakdown</ThemedText>
                      <ThemedText style={[styles.manifestCaption, { color: mutedColor }]}>Per passenger estimate before driver boarding confirmation.</ThemedText>
                    </View>
                  </View>

                  {regularBookingFareBreakdown.rows.map((row) => (
                    <View key={row.id} style={styles.rowBetween}>
                      <ThemedText style={[styles.manifestCaption, { color: textColor }]}>
                        {row.label}{row.discountType !== 'none' ? ` · ${row.discountType.toUpperCase()} ${row.discountPct}%` : ''}
                      </ThemedText>
                      <ThemedText style={[styles.manifestCaption, { color: row.discountType !== 'none' ? tint : textColor, fontFamily: OutfitFonts.bold }]}>
                        ₱{row.finalFare.toFixed(2)}
                      </ThemedText>
                    </View>
                  ))}

                  <View style={[styles.rowBetween, { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: borderColor }]}> 
                    <ThemedText style={[styles.manifestRowLabel, { color: textColor }]}>Estimated Total</ThemedText>
                    <ThemedText style={[styles.manifestRowLabel, { color: tint }]}>₱{regularBookingFareBreakdown.total.toFixed(2)}</ThemedText>
                  </View>

                  <ThemedText style={[styles.manifestCaption, { color: mutedColor, marginTop: 6 }]}> 
                    Your account discount is auto-validated. If not approved, your fare is charged at regular price.
                  </ThemedText>
                </View>
              ) : null}



              {activePassengerPickupIntents.length === 0 && (
                <View
                  style={[
                    styles.noteInputCard,
                    {
                      borderColor: rideNote.length > 0 ? tint : borderColor,
                      backgroundColor: bgColor,
                    },
                  ]}
                >
                  <View style={styles.noteInputHeader}>
                    <Ionicons
                      name="chatbubble-ellipses-outline"
                      size={13}
                      color={rideNote.length > 0 ? tint : mutedColor}
                    />
                    <ThemedText style={[styles.noteInputLabel, { color: rideNote.length > 0 ? tint : mutedColor }]}>
                      Note to driver
                    </ThemedText>
                    <ThemedText style={[styles.noteInputOptional, { color: mutedColor }]}>optional</ThemedText>
                  </View>
                  <TextInput
                    value={rideNote}
                    onChangeText={(v) => setRideNote(v.slice(0, 300))}
                    placeholder="e.g. I'll be waiting at the gate"
                    placeholderTextColor={mutedColor}
                    multiline
                    numberOfLines={2}
                    style={[styles.noteInputBare, { color: textColor }]}
                    accessibilityLabel="Note to driver"
                    textAlignVertical="top"
                  />
                  {rideNote.length > 0 && (
                    <View style={styles.noteCharCountRow}>
                      <ThemedText
                        style={[
                          styles.noteCharCount,
                          { color: rideNote.length > 270 ? dangerColor : mutedColor },
                        ]}
                      >
                        {rideNote.length}/300
                      </ThemedText>
                    </View>
                  )}
                </View>
              )}

              <Pressable
                style={[
                  styles.passengerPrimaryButton,
                  (pickupDisabled || !isDestinationReady) && styles.passengerPrimaryButtonDisabled,
                  { backgroundColor: pickupCtaBg },
                ]}
                onPress={handleRequestPickup}
                disabled={
                  pickupDisabled ||
                  !isDestinationReady ||
                  (!bookForOthers && selectedDestinationType === 'fixed' && fixedDestinations.length === 0)
                }
                accessibilityRole="button"
                accessibilityLabel="Request shuttle"
              >
                <Ionicons
                  name={pickupSubmitting ? 'time-outline' : 'navigate'}
                  size={18}
                  color={palette.white}
                />
                <ThemedText style={styles.passengerPrimaryText}>
                  {bookForOthers
                    ? pickupSubmitting
                      ? 'Sending Request...'
                      : activePassengerPickupIntents.length > 0
                        ? 'Pickup Active'
                        : noDriversOnDuty
                          ? 'No Driver On Duty'
                          : 'Request Shuttle'
                    : !selectedDestinationType
                      ? 'Select Destination'
                      : pickupSubmitting
                        ? 'Sending Request...'
                        : activePassengerPickupIntents.length > 0
                          ? 'Pickup Active'
                          : noDriversOnDuty
                            ? 'No Driver On Duty'
                            : 'Request Shuttle'}
                </ThemedText>
              </Pressable>

              {activePassengerPickupIntents.length > 0 ? (
                <View
                  style={[
                    styles.pickupActiveCard,
                    {
                      borderColor: colorScheme === 'dark' ? dangerColor : AppPalette.dangerMutedBorder,
                      backgroundColor: colorScheme === 'dark' ? 'rgba(239,68,68,0.08)' : '#FFF5F5',
                    },
                  ]}
                >
                  {/* ── Header row ── */}
                  <View style={styles.pickupActiveHeader}>
                    <View style={styles.pickupActiveHeaderLeft}>
                      <View
                        style={[
                          styles.pickupActiveIconBadge,
                          {
                            backgroundColor: colorScheme === 'dark' ? 'rgba(239,68,68,0.18)' : '#FEE2E2',
                          },
                        ]}
                      >
                        <Ionicons name="radio-outline" size={16} color={dangerColor} />
                      </View>
                      <View>
                        <ThemedText
                          style={[
                            styles.pickupActiveTitle,
                            { color: colorScheme === 'dark' ? dangerColor : AppPalette.dangerStrongText },
                          ]}
                        >
                          Pickup Active
                        </ThemedText>
                        <ThemedText
                          style={[
                            styles.pickupActiveSubtitle,
                            { color: colorScheme === 'dark' ? 'rgba(255,106,118,0.7)' : '#9B1C1C' },
                          ]}
                        >
                          Visible to drivers nearby
                        </ThemedText>
                      </View>
                    </View>
                    <View
                      style={[
                        styles.pickupActiveLivePill,
                        {
                          backgroundColor: colorScheme === 'dark' ? 'rgba(239,68,68,0.18)' : '#FEE2E2',
                          borderColor: colorScheme === 'dark' ? 'rgba(255,106,118,0.3)' : '#FECACA',
                        },
                      ]}
                    >
                      <View style={[styles.pickupActiveLiveDot, { backgroundColor: dangerColor }]} />
                      <ThemedText
                        style={[
                          styles.pickupActiveLiveText,
                          { color: colorScheme === 'dark' ? dangerColor : AppPalette.dangerStrongText },
                        ]}
                      >
                        LIVE
                      </ThemedText>
                    </View>
                  </View>

                  {/* ── Info chips row ── */}
                  <View style={styles.pickupActiveChipsRow}>
                    {/* Destination chip */}
                    <View
                      style={[
                        styles.pickupActiveChip,
                        {
                          borderColor: activePickupDestinationAccent,
                          backgroundColor: colorScheme === 'dark' ? 'rgba(0,0,0,0.25)' : AppPalette.white,
                        },
                      ]}
                    >
                      <Ionicons
                        name={activePickupDestinationType === 'home' ? 'home-outline' : 'flag-outline'}
                        size={12}
                        color={activePickupDestinationAccent}
                      />
                      <ThemedText
                        style={[styles.pickupActiveChipText, { color: activePickupDestinationAccent }]}
                        numberOfLines={1}
                      >
                        {activePickupDestinationSummary || selectedDestinationSummary}
                      </ThemedText>
                    </View>
                    {/* Fare type chip */}
                    <View
                      style={[
                        styles.pickupActiveChip,
                        {
                          borderColor: fareType === 'priority'
                            ? (colorScheme === 'dark' ? '#fbbf24' : '#f59e0b')
                            : (colorScheme === 'dark' ? tint : tint),
                          backgroundColor: colorScheme === 'dark' ? '#22283C' : AppPalette.white,
                        },
                      ]}
                    >
                      <Ionicons
                        name={fareType === 'priority' ? 'flash' : 'car-outline'}
                        size={11}
                        color={fareType === 'priority' ? '#fbbf24' : tint}
                      />
                      <ThemedText
                        style={[
                          styles.pickupActiveChipText,
                          { color: fareType === 'priority' ? '#fbbf24' : tint },
                        ]}
                      >
                        {fareType === 'priority' ? 'Priority' : 'Standard'}
                      </ThemedText>
                    </View>
                  </View>

                  {/* ── Status message ── */}
                  <ThemedText
                    style={[
                      styles.pickupActiveMessage,
                      { color: colorScheme === 'dark' ? 'rgba(255,106,118,0.8)' : '#991B1B' },
                    ]}
                  >
                    {dispatchedShuttle
                      ? 'A shuttle has been assigned — stay near your pickup location.'
                      : queueNotice
                        ? 'You are in the waiting queue. We will dispatch you automatically.'
                        : 'Waiting for a shuttle to be assigned to you...'}
                  </ThemedText>

                  {activePickupManifestSummary ? (
                    <ThemedText style={[styles.pickupActiveMessage, { color: mutedColor }]}>
                      Booking for: {activePickupManifestSummary}
                    </ThemedText>
                  ) : null}

                  {/* ── Share Tracking Link ── */}
                  {activePassengerPickupIntents[0]?.trackingToken ? (
                    <Pressable
                      style={[
                        styles.shareTrackingBtn,
                        {
                          backgroundColor: colorScheme === 'dark' ? '#1d4ed8' : '#2563eb',
                        },
                      ]}
                      onPress={async () => {
                        const intent = activePassengerPickupIntents[0];
                        if (!intent?.trackingToken) return;
                        const trackingUrl = intent.trackingUrl;
                        const isBookForOthers = Array.isArray(intent.passengerManifest) && intent.passengerManifest.length > 0;
                        const message = isBookForOthers
                          ? `Track the shuttle on its way to pick up ${activePickupManifestSummary || 'your passengers'}`
                          : 'Track my shuttle pickup location';
                        try {
                          if (trackingUrl) {
                            await Share.share({ message: `${message}: ${trackingUrl}`, url: trackingUrl });
                          } else {
                            await Share.share({ message: `${message} — Tracking ID: ${intent.trackingToken}` });
                          }
                        } catch {}
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Share tracking link"
                    >
                      <View style={styles.shareTrackingIconWrap}>
                        <Ionicons name="share-social-outline" size={20} color="#ffffff" />
                      </View>
                      <View style={styles.shareTrackingContent}>
                        <ThemedText style={styles.shareTrackingTitle}>Share Tracking Link</ThemedText>
                        <ThemedText style={styles.shareTrackingSubtitle}>Let others follow your ride live</ThemedText>
                      </View>
                      <Ionicons name="chevron-forward-outline" size={16} color="rgba(255,255,255,0.65)" />
                    </Pressable>
                  ) : null}

                  {/* ── Cancel button ── */}
                  <Pressable
                    style={[
                      styles.pickupActiveCancelBtn,
                      {
                        borderColor: colorScheme === 'dark' ? 'rgba(255,106,118,0.3)' : AppPalette.dangerMutedBorder,
                        backgroundColor: colorScheme === 'dark' ? 'rgba(239,68,68,0.1)' : AppPalette.white,
                      },
                      pickupCancelling && { opacity: 0.6 },
                    ]}
                    onPress={handleCancelPickup}
                    disabled={pickupCancelling}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel active pickup request"
                  >
                    <Ionicons
                      name={pickupCancelling ? 'hourglass-outline' : 'close-circle-outline'}
                      size={14}
                      color={dangerColor}
                    />
                    <ThemedText style={[styles.pickupActiveCancelText, { color: dangerColor }]}>
                      {pickupCancelling ? 'Cancelling...' : 'Cancel Pickup'}
                    </ThemedText>
                  </Pressable>
                </View>
              ) : null}

              {/* ── Dispatched Shuttle Card ───────────────────────────────── */}
              {dispatchedShuttle && activePassengerPickupIntents.length > 0 && (
                <View
                  style={[
                    styles.dispatchAssignedCard,
                    {
                      borderColor: colorScheme === 'dark' ? '#34d399' : '#A7F3D0',
                      backgroundColor: colorScheme === 'dark' ? 'rgba(16,185,129,0.08)' : '#ECFDF5',
                    },
                  ]}
                >
                  {/* Header */}
                  <View style={styles.dispatchAssignedHeader}>
                    <View
                      style={[
                        styles.dispatchAssignedIconBadge,
                        { backgroundColor: colorScheme === 'dark' ? 'rgba(16,185,129,0.18)' : '#D1FAE5' },
                      ]}
                    >
                      <Ionicons name="bus" size={16} color={successColor} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <ThemedText
                        style={[
                          styles.dispatchAssignedTitle,
                          { color: colorScheme === 'dark' ? '#34d399' : '#065f46' },
                        ]}
                      >
                        Shuttle Assigned
                      </ThemedText>
                    </View>
                    <View
                      style={[
                        styles.dispatchAssignedBadge,
                        {
                          backgroundColor: colorScheme === 'dark' ? 'rgba(52,211,153,0.18)' : '#D1FAE5',
                          borderColor: colorScheme === 'dark' ? 'rgba(52,211,153,0.3)' : '#A7F3D0',
                        },
                      ]}
                    >
                      <Ionicons name="checkmark-circle" size={11} color={successColor} />
                      <ThemedText
                        style={[styles.dispatchAssignedBadgeText, { color: successColor }]}
                      >
                        EN ROUTE
                      </ThemedText>
                    </View>
                  </View>

                  {/* Shuttle details */}
                  <View
                    style={[
                      styles.dispatchAssignedDetails,
                      {
                        backgroundColor: colorScheme === 'dark' ? 'rgba(0,0,0,0.2)' : 'rgba(16,185,129,0.06)',
                        borderColor: colorScheme === 'dark' ? 'rgba(52,211,153,0.15)' : '#D1FAE5',
                      },
                    ]}
                  >
                    <View style={styles.dispatchAssignedDetailRow}>
                      <Ionicons name="car-sport-outline" size={13} color={colorScheme === 'dark' ? '#6ee7b7' : '#059669'} />
                      <ThemedText
                        style={[styles.dispatchAssignedDetailText, { color: colorScheme === 'dark' ? '#6ee7b7' : '#047857' }]}
                      >
                        {dispatchedShuttle.plateNumber
                          ? `${dispatchedShuttle.plateNumber}${dispatchedShuttle.label ? ` · Electric ${dispatchedShuttle.label}` : ''}`
                          : formatShuttleLabel(dispatchedShuttle.label, undefined)}
                      </ThemedText>
                    </View>
                    <View style={styles.dispatchAssignedDetailRow}>
                      <Ionicons name="people-outline" size={13} color={colorScheme === 'dark' ? '#6ee7b7' : '#059669'} />
                      <ThemedText
                        style={[styles.dispatchAssignedDetailText, { color: colorScheme === 'dark' ? '#6ee7b7' : '#047857' }]}
                      >
                        {dispatchedShuttle.currentCapacity}/{dispatchedShuttle.maxCapacity} passengers
                        {typeof dispatchedShuttle.pendingPickupCount === 'number' && dispatchedShuttle.pendingPickupCount > 0
                          ? ` · ${dispatchedShuttle.pendingPickupCount} pickups ahead`
                          : ''}
                      </ThemedText>
                    </View>
                    {dispatchedShuttleEtaMinutes !== null && (
                      <View style={styles.dispatchAssignedDetailRow}>
                        <Ionicons name="time-outline" size={13} color={colorScheme === 'dark' ? '#6ee7b7' : '#059669'} />
                        <ThemedText
                          style={[styles.dispatchAssignedDetailText, { color: colorScheme === 'dark' ? '#6ee7b7' : '#047857', fontWeight: '700' }]}
                        >
                          ETA: ~{dispatchedShuttleEtaMinutes} min to pickup
                        </ThemedText>
                      </View>
                    )}
                  </View>

                  {/* Step progress */}
                  <View style={styles.dispatchStepRow}>
                    <View style={[styles.dispatchStepDot, { backgroundColor: successColor }]} />
                    <View style={[styles.dispatchStepLine, { backgroundColor: successColor }]} />
                    <View style={[styles.dispatchStepDot, { backgroundColor: successColor, opacity: 0.4 }]} />
                    <View style={[styles.dispatchStepLine, { backgroundColor: colorScheme === 'dark' ? '#303951' : '#D1D5DB' }]} />
                    <View style={[styles.dispatchStepDot, { backgroundColor: colorScheme === 'dark' ? '#303951' : '#D1D5DB' }]} />
                  </View>
                  <View style={styles.dispatchStepLabels}>
                    <ThemedText style={[styles.dispatchStepLabel, { color: successColor }]}>Requested</ThemedText>
                    <ThemedText style={[styles.dispatchStepLabel, { color: colorScheme === 'dark' ? '#34d399' : '#059669' }]}>Assigned</ThemedText>
                    <ThemedText style={[styles.dispatchStepLabel, { color: mutedColor }]}>Pickup</ThemedText>
                  </View>
                </View>
              )}

              {/* ── Queue Notice ─────────────────────────────────────────── */}
              {queueNotice && activePassengerPickupIntents.length > 0 && !dispatchedShuttle && (
                <View
                  style={[
                    styles.queueNoticeCard,
                    {
                      borderColor: colorScheme === 'dark' ? '#fbbf24' : '#FDE68A',
                      backgroundColor: colorScheme === 'dark' ? 'rgba(245,158,11,0.08)' : '#FFFBEB',
                    },
                  ]}
                >
                  {/* Header */}
                  <View style={styles.queueNoticeHeader}>
                    <View
                      style={[
                        styles.queueNoticeIconBadge,
                        { backgroundColor: colorScheme === 'dark' ? 'rgba(251,191,36,0.18)' : '#FEF3C7' },
                      ]}
                    >
                      <Ionicons
                        name={
                          queueNotice.reason === 'no_shuttles_on_duty'
                            ? 'moon-outline'
                            : queueNotice.reason === 'dispatch_race'
                              ? 'refresh-outline'
                              : 'hourglass-outline'
                        }
                        size={16}
                        color="#f59e0b"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <ThemedText
                        style={[
                          styles.queueNoticeTitle,
                          { color: colorScheme === 'dark' ? '#fbbf24' : '#92400e' },
                        ]}
                      >
                        {queueNotice.reason === 'no_shuttles_on_duty'
                          ? 'No Shuttles On Duty'
                          : queueNotice.reason === 'dispatch_race'
                            ? 'Seat Taken — Retrying'
                            : 'Waiting in Queue'}
                      </ThemedText>
                    </View>
                    {queueNotice.position !== null && (
                      <View
                        style={[
                          styles.queuePositionBadge,
                          {
                            backgroundColor: colorScheme === 'dark' ? 'rgba(251,191,36,0.18)' : '#FEF3C7',
                            borderColor: colorScheme === 'dark' ? 'rgba(251,191,36,0.3)' : '#FDE68A',
                          },
                        ]}
                      >
                        <ThemedText
                          style={[styles.queuePositionNumber, { color: '#f59e0b' }]}
                        >
                          #{(queueNotice.position ?? 0) + 1}
                        </ThemedText>
                        <ThemedText
                          style={[styles.queuePositionLabel, { color: colorScheme === 'dark' ? '#fcd34d' : '#b45309' }]}
                        >
                          in line
                        </ThemedText>
                      </View>
                    )}
                  </View>

                  {/* Message */}
                  <ThemedText
                    style={[
                      styles.queueNoticeMessage,
                      { color: colorScheme === 'dark' ? '#fcd34d' : '#92400e' },
                    ]}
                  >
                    {queueNotice.message}
                  </ThemedText>

                  {/* Reassurance footer */}
                  <View
                    style={[
                      styles.queueNoticeFooter,
                      {
                        borderTopColor: colorScheme === 'dark' ? 'rgba(251,191,36,0.15)' : '#FDE68A',
                      },
                    ]}
                  >
                    <Ionicons name="notifications-outline" size={12} color={colorScheme === 'dark' ? '#fbbf24' : '#d97706'} />
                    <ThemedText
                      style={[styles.queueNoticeFooterText, { color: colorScheme === 'dark' ? 'rgba(252,211,77,0.7)' : '#b45309' }]}
                    >
                      You'll receive a notification when dispatched
                    </ThemedText>
                  </View>
                </View>
              )}


            </View>
          </ScrollView>
        </View>
      )}
      <HowToBookModal visible={showHowToBookModal} onClose={() => setShowHowToBookModal(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.slateBg,
  },
  topBar: {
    width: '92%',
    alignSelf: 'center',
    marginTop: DesignTokens.spacing.sm,
    marginBottom: DesignTokens.spacing.sm,
    borderRadius: DesignTokens.radius.md,
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: DesignTokens.spacing.md,
    paddingVertical: DesignTokens.spacing.sm,
  },
  avatarBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationPill: {
    width: '92%',
    alignSelf: 'center',
    marginBottom: DesignTokens.spacing.sm,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    minHeight: 44,
    paddingHorizontal: DesignTokens.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.sm,
  },
  locationPillText: {
    fontFamily: OutfitFonts.semiBold,
    fontSize: DesignTokens.typography.body.fontSize,
  },
  topTitle: {
    color: palette.white,
    fontSize: 22,
    fontFamily: OutfitFonts.extraBold,
  },
  topSubtitle: {
    color: palette.slateBorder,
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
    paddingHorizontal: DesignTokens.spacing.md,
    paddingVertical: DesignTokens.spacing.sm,
    gap: DesignTokens.spacing.sm,
    flexGrow: 1,
  },
  driverInfoCard: {
    gap: DesignTokens.spacing.sm,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.lg,
    padding: DesignTokens.spacing.md,
  },
  statusSection: {
    gap: DesignTokens.spacing.xs,
  },
  pickupRequestCard: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    padding: DesignTokens.spacing.sm,
    gap: DesignTokens.spacing.xxs,
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
  manualFallbackHint: {
    marginHorizontal: DesignTokens.spacing.sm,
    marginTop: -DesignTokens.spacing.xxs,
    marginBottom: DesignTokens.spacing.sm,
    textAlign: 'center',
    fontSize: 11,
    fontFamily: OutfitFonts.semiBold,
    lineHeight: 16,
  },
  driverActionButton: {
    flex: 1,
    minHeight: 58,
    borderRadius: DesignTokens.radius.md,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: DesignTokens.spacing.xs,
  },
  driverBoardButton: {
    borderWidth: 2,
  },
  driverUnboardButton: {
    borderWidth: 1.5,
  },
  driverActionButtonDisabled: {
    opacity: 0.5,
  },
  driverActionButtonText: {
    fontSize: 13,
    fontFamily: OutfitFonts.extraBold,
    letterSpacing: 0.2,
  },
  driverActionButtonTextOnColor: {
    color: palette.white,
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
    backgroundColor: palette.navy,
    overflow: 'hidden',
  },
  driverMapWrap: {
    height: '56%',
    marginHorizontal: DesignTokens.spacing.sm,
    borderRadius: DesignTokens.radius.xl,
  },
  passengerMapWrap: {
    height: '56%',
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
  mapSkeletonWrap: {
    width: '100%',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
    paddingHorizontal: DesignTokens.spacing.lg,
  },
  mapPlaceholderText: {
    color: palette.white,
    fontSize: 20,
    fontFamily: OutfitFonts.extraBold,
  },
  mapPlaceholderHint: {
    color: palette.slateBorder,
    fontSize: 13,
  },
  mapLockBadge: {
    position: 'absolute',
    top: DesignTokens.spacing.sm,
    left: DesignTokens.spacing.sm,
    backgroundColor: AppPalette.darkOverlayStrong,
    borderRadius: DesignTokens.radius.md,
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
    paddingHorizontal: 0,
    paddingTop: DesignTokens.spacing.sm,
    paddingBottom: DesignTokens.spacing.sm,
    gap: DesignTokens.spacing.xs,
  },
  sheetWrap: {
    flex: 1,
    marginTop: DesignTokens.spacing.sm,
    marginHorizontal: DesignTokens.spacing.md,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: DesignTokens.radius.pill,
    marginBottom: DesignTokens.spacing.xs,
  },
  passengerHubCard: {
    gap: DesignTokens.spacing.xs,
    borderWidth: 1,
    padding: DesignTokens.spacing.md,
    borderRadius: DesignTokens.radius.lg,
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
  pickupSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: DesignTokens.radius.sm,
    paddingHorizontal: DesignTokens.spacing.xs,
    paddingVertical: 6,
    marginTop: 8,
  },
  pickupSearchInput: {
    flex: 1,
    fontFamily: OutfitFonts.regular,
    fontSize: 13,
    paddingVertical: 0,
  },
  pickupQueueCard: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
    marginTop: 6,
  },
  pickupQueueCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
  },
  pickupQueueName: {
    fontFamily: OutfitFonts.semiBold,
    fontSize: 13,
  },
  pickupQueueDestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 2,
  },
  pickupQueueDest: {
    fontFamily: OutfitFonts.regular,
    fontSize: 12,
    flex: 1,
  },
  pickupQueueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 99,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  pickupQueueBadgeText: {
    fontFamily: OutfitFonts.semiBold,
    fontSize: 10,
    color: '#fff',
  },
  pickupQueueNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  pickupQueueNoteText: {
    fontFamily: OutfitFonts.regular,
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },
  shareTrackingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: DesignTokens.radius.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 12,
  },
  shareTrackingIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareTrackingContent: {
    flex: 1,
  },
  shareTrackingTitle: {
    fontFamily: OutfitFonts.semiBold,
    fontSize: 14,
    color: '#ffffff',
  },
  shareTrackingSubtitle: {
    fontFamily: OutfitFonts.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 1,
  },
  shareTrackingText: {
    fontFamily: OutfitFonts.semiBold,
    fontSize: 13,
  },
  noteInputCard: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingTop: 10,
    paddingBottom: 8,
    marginTop: DesignTokens.spacing.xs,
  },
  noteInputHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 6,
  },
  noteInputLabel: {
    fontFamily: OutfitFonts.semiBold,
    fontSize: 12,
    flex: 1,
  },
  noteInputOptional: {
    fontFamily: OutfitFonts.regular,
    fontSize: 11,
    fontStyle: 'italic',
  },
  noteInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  noteInputBare: {
    flex: 1,
    fontFamily: OutfitFonts.regular,
    fontSize: 14,
    minHeight: 48,
    textAlignVertical: 'top',
    lineHeight: 20,
  },
  noteCharCountRow: {
    alignItems: 'flex-end',
    marginTop: 4,
  },
  noteCharCount: {
    fontFamily: OutfitFonts.regular,
    fontSize: 11,
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
  destinationTypeRow: {
    flexDirection: 'row',
    gap: DesignTokens.spacing.xs,
  },
  destinationTypeCard: {
    flex: 1,
    minHeight: 52,
    borderWidth: 1.5,
    borderRadius: DesignTokens.radius.md,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  destinationTypeCardActive: {
    borderWidth: 2,
  },
  destinationTypeCardInactive: {
    borderWidth: 1.5,
  },
  destinationTypeCardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.985 }],
  },
  destinationTypeCardLead: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
  },
  destinationTypeLabelWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  destinationTypeIconBubble: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destinationTypeLabel: {
    fontFamily: OutfitFonts.bold,
    fontSize: 13,
    flexShrink: 1,
  },
  destinationTypeCaption: {
    fontFamily: OutfitFonts.semiBold,
    fontSize: 11,
    lineHeight: 14,
    flexShrink: 1,
  },
  destinationPromptCard: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    minHeight: 40,
    paddingHorizontal: DesignTokens.spacing.xs,
    paddingVertical: DesignTokens.spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
  },
  destinationPromptText: {
    flex: 1,
    fontSize: 12,
    fontFamily: OutfitFonts.semiBold,
    lineHeight: 16,
  },
  manifestCard: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    padding: DesignTokens.spacing.sm,
    gap: DesignTokens.spacing.sm,
    marginTop: DesignTokens.spacing.sm,
  },
  manifestHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: DesignTokens.spacing.sm,
  },
  manifestTitle: {
    fontFamily: OutfitFonts.bold,
    fontSize: 14,
    lineHeight: 18,
  },
  manifestCaption: {
    fontFamily: OutfitFonts.medium,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  manifestToggle: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.pill,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
  },
  manifestTogglePressed: {
    opacity: 0.84,
  },
  manifestToggleText: {
    fontFamily: OutfitFonts.bold,
    fontSize: 12,
  },
  manifestList: {
    gap: DesignTokens.spacing.xs,
  },
  manifestSection: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    padding: DesignTokens.spacing.sm,
    gap: DesignTokens.spacing.sm,
    marginTop: DesignTokens.spacing.xs,
  },
  manifestSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.sm,
    marginBottom: DesignTokens.spacing.xs,
  },
  manifestIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manifestInputGroup: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    padding: DesignTokens.spacing.sm,
  },
  manifestGuestLabel: {
    fontFamily: OutfitFonts.bold,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  manifestInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: DesignTokens.radius.sm,
    paddingHorizontal: DesignTokens.spacing.sm,
    minHeight: 44,
  },
  manifestInputIcon: {
    marginRight: DesignTokens.spacing.xs,
  },
  manifestInputBare: {
    flex: 1,
    fontFamily: OutfitFonts.medium,
    fontSize: 14,
    paddingVertical: DesignTokens.spacing.xs,
  },
  fixedDestinationList: {
    marginTop: DesignTokens.spacing.xs,
    gap: 6,
  },
  manifestFixedOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.sm,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.sm,
  },
  manifestHomeNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.sm,
    marginTop: DesignTokens.spacing.xs,
  },
  manifestRow: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    padding: DesignTokens.spacing.sm,
    gap: DesignTokens.spacing.xs,
  },
  manifestRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  manifestRowLabel: {
    fontFamily: OutfitFonts.bold,
    fontSize: 13,
  },
  manifestActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: DesignTokens.spacing.xs,
    marginTop: DesignTokens.spacing.xs,
  },
  manifestActionButton: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.pill,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
  },
  manifestActionText: {
    fontFamily: OutfitFonts.bold,
    fontSize: 12,
  },
  manifestInput: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
    fontSize: 14,
    fontFamily: OutfitFonts.medium,
    minHeight: 42,
  },
  manifestAddButton: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: DesignTokens.spacing.xs,
    minHeight: 44,
  },
  manifestAddText: {
    fontFamily: OutfitFonts.bold,
    fontSize: 13,
  },
  manifestSummary: {
    fontFamily: OutfitFonts.medium,
    fontSize: 11,
    lineHeight: 15,
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
    backgroundColor: palette.slateBg,
  },
  passengerStatText: {
    color: palette.navy,
    fontFamily: OutfitFonts.bold,
    fontSize: 12,
  },
  dispatchHintCard: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.xs,
  },
  dispatchHintText: {
    flex: 1,
    fontFamily: OutfitFonts.semiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  destinationIndicatorCard: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingVertical: DesignTokens.spacing.xs,
    paddingHorizontal: DesignTokens.spacing.xs,
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: DesignTokens.spacing.xs,
  },
  destinationIndicatorIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  destinationIndicatorCopy: {
    flex: 1,
    gap: DesignTokens.spacing.xxs,
  },
  destinationIndicatorHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: DesignTokens.spacing.xs,
  },
  destinationIndicatorLabel: {
    fontSize: 10,
    fontFamily: OutfitFonts.extraBold,
    letterSpacing: 0.35,
    textTransform: 'uppercase',
  },
  destinationIndicatorTypePill: {
    borderRadius: DesignTokens.radius.pill,
    paddingHorizontal: DesignTokens.spacing.xs,
    paddingVertical: 2,
  },
  destinationIndicatorTypeText: {
    fontSize: 10,
    fontFamily: OutfitFonts.bold,
    letterSpacing: 0.25,
  },
  destinationIndicatorValue: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: OutfitFonts.semiBold,
  },
  // ── Active Pickup Card ──────────────────────────────────────────────────────
  pickupActiveCard: {
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    padding: DesignTokens.spacing.sm,
    gap: DesignTokens.spacing.sm,
  },
  pickupActiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickupActiveHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.sm,
    flex: 1,
  },
  pickupActiveIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickupActiveTitle: {
    fontFamily: OutfitFonts.bold,
    fontSize: 14,
    lineHeight: 18,
  },
  pickupActiveSubtitle: {
    fontFamily: OutfitFonts.medium,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
  },
  pickupActiveLivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: DesignTokens.radius.pill,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: 3,
    gap: 5,
    borderWidth: 1,
  },
  pickupActiveLiveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  pickupActiveLiveText: {
    fontFamily: OutfitFonts.extraBold,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  pickupActiveChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: DesignTokens.spacing.xs,
  },
  pickupActiveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: DesignTokens.radius.pill,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: 4,
    gap: 4,
    maxWidth: '65%',
  },
  pickupActiveChipText: {
    fontFamily: OutfitFonts.semiBold,
    fontSize: 11,
    flexShrink: 1,
  },
  pickupActiveMessage: {
    fontFamily: OutfitFonts.medium,
    fontSize: 12,
    lineHeight: 17,
  },
  pickupActiveCancelBtn: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    minHeight: 38,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  pickupActiveCancelText: {
    fontFamily: OutfitFonts.bold,
    fontSize: 12,
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
    borderColor: AppPalette.switchTrackOff,
    backgroundColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Passenger count stepper ────────────────────────────────────────────────
  passengerCountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingHorizontal: DesignTokens.spacing.md,
    paddingVertical: DesignTokens.spacing.sm,
    gap: DesignTokens.spacing.sm,
  },
  passengerCountLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.sm,
  },
  passengerCountStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.sm,
  },
  passengerCountBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passengerCountValue: {
    fontFamily: OutfitFonts.bold,
    fontSize: 18,
    minWidth: 24,
    textAlign: 'center',
  },

  // ── Fare type selector ─────────────────────────────────────────────────────
  fareTypeRow: {
    flexDirection: 'row',
    gap: DesignTokens.spacing.xs,
    marginBottom: DesignTokens.spacing.sm,
  },
  fareTypePill: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: DesignTokens.spacing.sm,
    paddingHorizontal: DesignTokens.spacing.sm,
    borderRadius: DesignTokens.radius.md,
    borderWidth: 1.5,
    borderColor: AppPalette.slateBorder,
    backgroundColor: AppPalette.slateBg,
    minHeight: 80,
  },
  fareTypePillActive: {
    borderWidth: 2,
  },
  // icon + text on same row, centered
  fareTypePillLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  fareTypePillLabel: {
    fontFamily: OutfitFonts.semiBold,
    fontSize: 13,
  },
  // large fare number
  fareTypePillAmount: {
    fontFamily: OutfitFonts.extraBold,
    fontSize: 17,
  },
  // "⚡ Skip queue" chip on priority pill
  fareTypeSkipBadge: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 1,
  },
  fareTypeSkipText: {
    fontFamily: OutfitFonts.semiBold,
    fontSize: 10,
  },

  // ── Dispatched Shuttle Card (assigned) ─────────────────────────────────────
  dispatchAssignedCard: {
    borderRadius: DesignTokens.radius.md,
    borderWidth: 1,
    padding: DesignTokens.spacing.sm,
    marginTop: DesignTokens.spacing.sm,
    gap: DesignTokens.spacing.sm,
  },
  dispatchAssignedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.sm,
  },
  dispatchAssignedIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  dispatchAssignedTitle: {
    fontFamily: OutfitFonts.bold,
    fontSize: 14,
  },
  dispatchAssignedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: DesignTokens.radius.pill,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
  },
  dispatchAssignedBadgeText: {
    fontFamily: OutfitFonts.extraBold,
    fontSize: 9,
    letterSpacing: 0.5,
  },
  dispatchAssignedDetails: {
    borderRadius: DesignTokens.radius.sm,
    borderWidth: 1,
    padding: DesignTokens.spacing.sm,
    gap: 6,
  },
  dispatchAssignedDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dispatchAssignedDetailText: {
    fontFamily: OutfitFonts.semiBold,
    fontSize: 12,
    flex: 1,
  },
  dispatchStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: DesignTokens.spacing.md,
  },
  dispatchStepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dispatchStepLine: {
    flex: 1,
    height: 2,
    borderRadius: 1,
  },
  dispatchStepLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  dispatchStepLabel: {
    fontFamily: OutfitFonts.semiBold,
    fontSize: 10,
    textAlign: 'center',
  },

  // ── Queue Notice Card ──────────────────────────────────────────────────────
  queueNoticeCard: {
    borderRadius: DesignTokens.radius.md,
    borderWidth: 1,
    padding: DesignTokens.spacing.sm,
    marginTop: DesignTokens.spacing.sm,
    gap: DesignTokens.spacing.sm,
  },
  queueNoticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DesignTokens.spacing.sm,
  },
  queueNoticeIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  queueNoticeTitle: {
    fontFamily: OutfitFonts.bold,
    fontSize: 14,
  },
  queuePositionBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: DesignTokens.radius.sm,
    borderWidth: 1,
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: 4,
    minWidth: 48,
  },
  queuePositionNumber: {
    fontFamily: OutfitFonts.extraBold,
    fontSize: 16,
    lineHeight: 20,
  },
  queuePositionLabel: {
    fontFamily: OutfitFonts.semiBold,
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  queueNoticeMessage: {
    fontFamily: OutfitFonts.medium,
    fontSize: 12,
    lineHeight: 17,
  },
  queueNoticeFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: 1,
    paddingTop: DesignTokens.spacing.sm,
  },
  queueNoticeFooterText: {
    fontFamily: OutfitFonts.medium,
    fontSize: 11,
    flex: 1,
  },
  phaseLegend: {
    position: 'absolute',
    top: DesignTokens.spacing.sm,
    right: DesignTokens.spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: DesignTokens.radius.md,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.18)',
    paddingHorizontal: DesignTokens.spacing.sm,
    paddingVertical: DesignTokens.spacing.xs,
    gap: 4,
    maxWidth: 180,
  },
  phaseLegendTitle: {
    color: '#111827',
    fontFamily: OutfitFonts.bold,
    fontSize: 11,
  },
  phaseLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  phaseLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  phaseLegendText: {
    color: '#111827',
    fontFamily: OutfitFonts.semiBold,
    fontSize: 10,
    textTransform: 'capitalize',
    flexShrink: 1,
  },
  warningCard: {
    width: '92%',
    alignSelf: 'center',
    marginBottom: DesignTokens.spacing.xs,
    borderWidth: 1,
    borderRadius: DesignTokens.radius.md,
    paddingHorizontal: DesignTokens.spacing.md,
    paddingVertical: DesignTokens.spacing.sm,
    gap: 4,
  },
  warningCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  warningCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  warningCardTitle: {
    fontFamily: OutfitFonts.bold,
    fontSize: 13,
    color: '#92400e',
  },
  warningCardNote: {
    fontFamily: OutfitFonts.regular,
    fontSize: 13,
    color: '#78350f',
    lineHeight: 18,
    marginTop: 2,
  },
  warningCardMeta: {
    fontFamily: OutfitFonts.regular,
    fontSize: 11,
    color: '#a16207',
    marginTop: 2,
  },
});
