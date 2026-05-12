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
  bookingOwner?: string | null;
  location: {
    type: 'Point';
    coordinates: [number, number];
  };
  pickupLocation?: {
    type: 'Point';
    coordinates: [number, number];
  } | null;
  destinationType: 'fixed' | 'home';
  destinationLabel: string;
  destinationLocation: {
    type: 'Point';
    coordinates: [number, number];
  };
  passengerHomePhase: string | null;
  fareType: 'standard' | 'priority';
  status: 'pending' | 'claimed' | 'dispatched' | 'queued' | 'bumped' | 'expired' | 'cancelled';
  expiresAt: string;
  passengerManifest?: Array<{
    passengerId?: string | null;
    name?: string | null;
    phone?: string | null;
  }>;
  note?: string | null;
  trackingToken?: string | null;
  trackingUrl?: string | null;
};

export type AssignedShuttle = {
  shuttleId: string;
  plateNumber: string;
  label: string;
  assignedPhase?: string | null;
  location: { type: 'Point'; coordinates: [number, number] };
  currentCapacity: number;
  maxCapacity: number;
  pendingPickupCount: number;
  status: string;
};

export type DispatchStatus = {
  requestId: string;
  fareType: 'standard' | 'priority';
  status: 'dispatched' | 'queued';
  passengerHomePhase?: string | null;
  queuePosition: number | null;
  dispatchedAt: string | null;
  expiresAt: string;
  trackingToken?: string | null;
  trackingUrl?: string | null;
  assignedShuttle: AssignedShuttle | null;
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
  discountType: 'student' | 'pwd' | 'senior' | 'none';
  fareAtBoarding: number;
  originalFare: number | null;
  discountRevoked: boolean;
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

export type PassengerManifestEntry = {
  passengerId?: string;
  name?: string;
  phone?: string;
};

export type PickupLocationInput = {
  latitude: number;
  longitude: number;
};

export type QueueReason = 'no_shuttles_on_duty' | 'all_shuttles_full' | 'no_shuttle_for_phase' | 'dispatch_race' | null;

/**
 * Creates a pickup intent for the current passenger.
 * @throws {Error} When the API request fails.
 */
export const createPickupIntent = async (
  latitude: number,
  longitude: number,
  destination: PickupDestinationInput,
  fareType: 'standard' | 'priority' = 'standard',
  detectedPhase?: string | null,
  booking?: {
    pickupLocation?: PickupLocationInput;
    passengerManifest?: PassengerManifestEntry[];
    discountType?: 'student' | 'pwd' | 'senior' | null;
    discountCount?: number;
  },
  note?: string | null
): Promise<{
  request: PickupIntent;
  rideRequestId: string;
  fareType: 'standard' | 'priority';
  fareExpected: number;
  dispatched: boolean;
  assignedShuttle: AssignedShuttle | null;
  queuePosition: number | null;
  queueReason: QueueReason;
}> => {
  const response = await api.post('/trips/pickup-intent', {
    latitude,
    longitude,
    destination,
    fareType,
    detectedPhase,
    ...(booking?.pickupLocation ? { pickupLocation: booking.pickupLocation } : {}),
    ...(booking?.passengerManifest?.length ? { passengerManifest: booking.passengerManifest } : {}),
    ...(booking?.discountType ? { discountType: booking.discountType } : {}),
    ...(booking?.discountCount && booking.discountCount > 0 ? { discountCount: booking.discountCount } : {}),
    ...(note ? { note } : {}),
  });

  return {
    request: response.data?.request as PickupIntent,
    rideRequestId: response.data?.rideRequestId as string,
    fareType: (response.data?.fareType as 'standard' | 'priority') ?? fareType,
    fareExpected: (response.data?.fareExpected as number) ?? 0,
    dispatched: Boolean(response.data?.dispatched),
    assignedShuttle: (response.data?.assignedShuttle as AssignedShuttle) ?? null,
    queuePosition: (response.data?.queuePosition as number | null) ?? null,
    queueReason: (response.data?.queueReason as QueueReason) ?? null,
  };
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
 * Cancels ALL active pickup intents for the current passenger.
 * Should be called before logout to release reserved shuttle slots.
 * Errors are intentionally swallowed — logout must proceed regardless.
 */
export const cancelMyPickupIntents = async (): Promise<{ cancelled: number }> => {
  try {
    const response = await api.delete('/trips/my-pickup-intents');
    return { cancelled: response.data?.cancelled ?? 0 };
  } catch {
    return { cancelled: 0 };
  }
};

/**
 * Returns the passenger's current dispatched or queued pickup request.
 * @throws {Error} When the API request fails.
 */
export const getMyDispatch = async (): Promise<DispatchStatus | null> => {
  const response = await api.get('/trips/my-dispatch');
  return (response.data?.dispatch as DispatchStatus) ?? null;
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
 * Driver manually claims a pending or queued pickup request for their shuttle.
 * @throws {Error} When the API request fails.
 */
export const claimPickupIntent = async (requestId: string): Promise<{ message: string; shuttle: AssignedShuttle }> => {
  const response = await api.post(`/trips/pickup-intent/${requestId}/claim`);
  return response.data as { message: string; shuttle: AssignedShuttle };
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

/**
 * Driver revokes a boarded passenger's discount, resetting fare to full amount.
 * @throws {Error} When the API request fails.
 */
export const revokePassengerDiscount = async (rideId: string): Promise<{
  message: string;
  fareDifference: number;
  newFare: number;
}> => {
  const response = await api.patch(`/trips/rides/${rideId}/revoke-discount`);
  return {
    message: response.data?.message as string,
    fareDifference: (response.data?.fareDifference as number) ?? 0,
    newFare: (response.data?.ride?.fareAtBoarding as number) ?? 0,
  };
};

