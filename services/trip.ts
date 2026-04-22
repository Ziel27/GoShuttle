import { api } from '@/services/api';

export type ShiftSummary = {
  tripId: string;
  shiftStart: string;
  shiftEnd: string;
  passengersBoarded: number;
  fareAtTime: number;
  revenueCollected: number;
};

export type PickupIntent = {
  _id: string;
  communityId: string;
  passengerId: string;
  location: {
    type: 'Point';
    coordinates: [number, number];
  };
  destinationType: 'fixed' | 'home';
  destinationLabel: string;
  destinationLocation: {
    type: 'Point';
    coordinates: [number, number];
  };
  status: 'pending' | 'claimed' | 'expired' | 'cancelled';
  expiresAt: string;
};

export type PassengerRecentRide = {
  rideId: string;
  status: 'boarded' | 'unboarded';
  requestedAt: string;
  boardedAt: string;
  fareAtBoarding: number;
  pickupLocation: {
    type: 'Point';
    coordinates: [number, number];
  };
  destinationType: 'fixed' | 'home';
  destinationLabel: string;
  destinationLocation: {
    type: 'Point';
    coordinates: [number, number];
  };
  shuttle: {
    plateNumber: string;
    label: string;
  };
};

export type OnboardDestinationPassenger = {
  rideId: string;
  passengerId: string | null;
  passengerName: string;
  boardedAt: string;
  destinationType: 'fixed' | 'home';
  destinationLabel: string;
  destinationLocation: {
    type: 'Point';
    coordinates: [number, number];
  };
};

export type CurrentPassenger = {
  passengerId: string | null;
  passengerName: string;
  boardedAt: string;
  boardLocation: {
    type: 'Point';
    coordinates: [number, number];
  };
};

export type TripMutationResponse = {
  trip: Record<string, unknown> | null;
  shuttle: Record<string, unknown> | null;
};

export type ShiftStatusUser = Record<string, unknown>;

export type ShiftRemittance = {
  _id: string;
  expectedAmount: number;
  actualAmount: number;
  varianceAmount: number;
  status: 'not_submitted' | 'pending' | 'verified' | 'flagged' | 'overdue' | 'escalated';
  submittedAt: string;
  receiptUrl?: string;
  [key: string]: unknown;
};

/**
 * Records passenger boarding against a shuttle and active trip.
 * @throws {Error} When the API request fails.
 */
export const boardPassenger = async (shuttleId: string, boardedCount = 1): Promise<TripMutationResponse> => {
  const response = await api.post('/trips/passenger-board', {
    shuttleId,
    boardedCount,
  });

  return {
    trip: (response.data?.trip as Record<string, unknown>) || null,
    shuttle: (response.data?.shuttle as Record<string, unknown>) || null,
  };
};

/**
 * Ends a driver shift and returns computed summary details.
 * @throws {Error} When the API request fails.
 */
export const endShift = async (shuttleId: string): Promise<ShiftSummary> => {
  const response = await api.post('/trips/shift-end', { shuttleId });
  return response.data?.summary as ShiftSummary;
};

/**
 * Updates the current user status to driving.
 * @throws {Error} When the API request fails.
 */
export const startShift = async (): Promise<ShiftStatusUser | null> => {
  const response = await api.patch('/users/me', { status: 'driving' });
  return (response.data?.user as ShiftStatusUser) || null;
};

/**
 * Updates the current user status to offline.
 * @throws {Error} When the API request fails.
 */
export const stopShift = async (): Promise<ShiftStatusUser | null> => {
  const response = await api.patch('/users/me', { status: 'offline' });
  return (response.data?.user as ShiftStatusUser) || null;
};

type PickupDestinationInput =
  | { type: 'fixed'; fixedDestinationId: string }
  | { type: 'home'; latitude: number; longitude: number; label?: string };

/**
 * Creates a pickup intent for the current passenger.
 * @throws {Error} When the API request fails.
 */
export const createPickupIntent = async (
  latitude: number,
  longitude: number,
  destination: PickupDestinationInput
): Promise<PickupIntent> => {
  const response = await api.post('/trips/pickup-intent', {
    latitude,
    longitude,
    destination,
  });

  return response.data?.request as PickupIntent;
};

/**
 * Cancels a pending pickup intent.
 * @throws {Error} When the API request fails.
 */
export const cancelPickupIntent = async (intentId: string): Promise<PickupIntent> => {
  const response = await api.delete(`/trips/pickup-intent/${intentId}`);
  return response.data?.request as PickupIntent;
};

/**
 * Lists active pickup intents for driver and admin use.
 * @throws {Error} When the API request fails.
 */
export const listPickupIntents = async (): Promise<PickupIntent[]> => {
  const response = await api.get('/trips/pickup-intents');
  return (response.data?.requests || []) as PickupIntent[];
};

/**
 * Lists a passenger's recent rides.
 * @throws {Error} When the API request fails.
 */
export const listPassengerRecentRides = async (): Promise<PassengerRecentRide[]> => {
  const response = await api.get('/trips/passenger-recent-rides');
  return (response.data?.rides || []) as PassengerRecentRide[];
};

/**
 * Records passenger unboarding against a shuttle and active trip.
 * @throws {Error} When the API request fails.
 */
export const unboardPassenger = async (shuttleId: string, unboardCount = 1): Promise<TripMutationResponse> => {
  const response = await api.post('/trips/passenger-unboard', {
    shuttleId,
    unboardCount,
  });

  return {
    trip: (response.data?.trip as Record<string, unknown>) || null,
    shuttle: (response.data?.shuttle as Record<string, unknown>) || null,
  };
};

/**
 * Returns passengers currently boarded on a trip.
 * @throws {Error} When the API request fails.
 */
export const getCurrentPassengers = async (tripId: string): Promise<CurrentPassenger[]> => {
  const response = await api.get(`/trips/${tripId}/current-passengers`);
  return (response.data?.passengers || []) as CurrentPassenger[];
};

/**
 * Lists onboard passengers and destination details for a shuttle.
 * @throws {Error} When the API request fails.
 */
export const listOnboardDestinations = async (shuttleId: string): Promise<OnboardDestinationPassenger[]> => {
  const response = await api.get(`/trips/${shuttleId}/onboard-destinations`);
  return (response.data?.passengers || []) as OnboardDestinationPassenger[];
};

export type DriverCompletedTrip = {
  tripId: string;
  shuttlePlate: string;
  shuttleLabel: string;
  shiftStart: string;
  shiftEnd: string;
  passengersBoarded: number;
  fareAtTime: number;
  revenueCollected: number;
  expectedRemittance: number;
  remittanceStatus: 'not_submitted' | 'pending' | 'verified' | 'flagged' | 'overdue' | 'escalated';
  remittanceActualAmount: number | null;
  remittanceVariance: number | null;
  remittanceSubmittedAt: string | null;
  remittanceDeadlineAt: string | null;
};

/**
 * Lists completed trips for the current driver.
 * @throws {Error} When the API request fails.
 */
export const listDriverCompletedTrips = async (): Promise<DriverCompletedTrip[]> => {
  const response = await api.get('/trips/driver-completed-trips');
  return (response.data?.trips || []) as DriverCompletedTrip[];
};

/**
 * Submits remittance details for a completed trip.
 * @throws {Error} When the API request fails.
 */
export const submitRemittance = async (
  tripId: string,
  actualAmount: number,
  driverNote?: string,
  receiptUri?: string
): Promise<ShiftRemittance | null> => {
  const formData = new FormData();
  formData.append('actualAmount', String(actualAmount));
  formData.append('driverNote', driverNote || '');

  if (receiptUri) {
    const filename = `receipt_${tripId}_${Date.now()}.jpg`;
    formData.append('receipt', {
      uri: receiptUri,
      name: filename,
      type: 'image/jpeg',
    } as any);
  }

  const response = await api.post(`/trips/${tripId}/remittance`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return (response.data?.remittance as ShiftRemittance) || null;
};

/**
 * Resolves a pending ride request.
 * @throws {Error} When the API request fails.
 */
export const resolveRideRequest = async (
  requestId: string,
  resolution: 'no_show' | 'late_manual'
): Promise<void> => {
  await api.post(`/trips/ride-requests/${requestId}/resolve`, { resolution });
};

