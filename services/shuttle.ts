import { api } from '@/services/api';
import type { GeoPoint } from '@/services/map-types';

export type Driver = {
  _id: string;
  firstName: string;
  lastName: string;
  status?: 'active' | 'offline' | 'driving';
};

export type Shuttle = {
  _id: string;
  communityId: string;
  driverId: string | Driver | null;
  plateNumber: string;
  label: string;
  maxCapacity: number;
  currentCapacity: number;
  status: 'idle' | 'en_route' | 'out_of_bounds' | 'maintenance';
  location: GeoPoint;
  capacityStatus?: 'available' | 'filling' | 'full';
  updatedAt?: string;
};

export type AutomationDiagnosticState = 'ready' | 'waiting' | 'blocked' | 'executed';

export type AutomationDiagnosticReasonCode =
  | 'not_driver'
  | 'driver_off_shift'
  | 'location_unavailable'
  | 'shuttle_full'
  | 'auto_boarded'
  | 'nearby_pickups_pending'
  | 'no_nearby_pickups'
  | 'auto_unboarded'
  | 'no_active_trip'
  | 'no_onboard_passengers'
  | 'arrivals_pending_retry'
  | 'no_arrived_destinations';

export type AutomationDiagnostic = {
  state: AutomationDiagnosticState;
  reasonCode: AutomationDiagnosticReasonCode;
  matchedCount: number;
  candidateCount: number;
};

export type AutomationDiagnostics = {
  autoBoarding: AutomationDiagnostic;
  autoUnboarding: AutomationDiagnostic;
};

export type ShuttleLocationSyncResponse = {
  shuttle: Shuttle;
  autoBoardedCount: number;
  autoUnboardedCount: number;
  manualAutomationCooldownSeconds: number;
  automationDiagnostics?: AutomationDiagnostics;
};

export const listShuttles = async () => {
  const response = await api.get('/shuttles');
  return (response.data?.shuttles || []) as Shuttle[];
};

export const updateShuttleLocation = async (
  shuttleId: string,
  latitude: number,
  longitude: number
) => {
  const response = await api.put(`/shuttles/${shuttleId}/location`, {
    latitude,
    longitude,
  });
  return {
    shuttle: response.data?.shuttle as Shuttle,
    autoBoardedCount: Number(response.data?.autoBoardedCount || 0),
    autoUnboardedCount: Number(response.data?.autoUnboardedCount || 0),
    manualAutomationCooldownSeconds: Number(response.data?.manualAutomationCooldownSeconds || 0),
    automationDiagnostics: response.data?.automationDiagnostics as AutomationDiagnostics | undefined,
  } as ShuttleLocationSyncResponse;
};

export const updateShuttleCapacity = async (shuttleId: string, delta: number) => {
  const response = await api.patch(`/shuttles/${shuttleId}/capacity`, { delta });
  return response.data?.shuttle as Shuttle;
};
