import { toLatLngPoint } from '@/services/map-types';
import type { AutomationDiagnostics, Shuttle } from '@/services/shuttle';
import type { PickupIntent } from '@/services/trip';
import type { LatLng, Region } from 'react-native-maps';

export type PickupIntentEventPayload = {
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

export const toShuttleCoordinate = (shuttle: Shuttle): LatLng | null => {
  return toLatLngPoint(shuttle.location?.coordinates || []);
};

export const toRegionFromBoundary = (coordinates: LatLng[]): Region | null => {
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

export const toMaxZoomOutRegionFromBoundary = (coordinates: LatLng[]): Region | null => {
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

export const describeBoardingReason = (
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

export const describeUnboardingReason = (
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

export const toPickupIntent = (payload: PickupIntentEventPayload): PickupIntent | null => {
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

export const isExpiredIntent = (intent: PickupIntent) =>
  new Date(intent.expiresAt).getTime() <= Date.now();

export const upsertPickupIntent = (items: PickupIntent[], nextItem: PickupIntent) => {
  const withoutExisting = items.filter((item) => item._id !== nextItem._id && !isExpiredIntent(item));
  return [nextItem, ...withoutExisting];
};

const toRadians = (value: number) => (value * Math.PI) / 180;

export const getDistanceMeters = (from: LatLng, to: LatLng) => {
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

export const toCommunityIdString = (communityId: unknown): string | null => {
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
