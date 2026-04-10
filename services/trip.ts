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
  status: 'pending' | 'claimed' | 'expired';
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

export const boardPassenger = async (shuttleId: string, boardedCount = 1) => {
  const response = await api.post('/trips/passenger-board', {
    shuttleId,
    boardedCount,
  });

  return {
    trip: response.data?.trip,
    shuttle: response.data?.shuttle,
  };
};

export const endShift = async (shuttleId: string) => {
  const response = await api.post('/trips/shift-end', { shuttleId });
  return response.data?.summary as ShiftSummary;
};

export const startShift = async () => {
  const response = await api.patch('/users/me', { status: 'driving' });
  return response.data?.user;
};

export const stopShift = async () => {
  const response = await api.patch('/users/me', { status: 'offline' });
  return response.data?.user;
};

type PickupDestinationInput =
  | { type: 'fixed'; fixedDestinationId: string }
  | { type: 'home'; latitude: number; longitude: number; label?: string };

export const createPickupIntent = async (
  latitude: number,
  longitude: number,
  destination: PickupDestinationInput
) => {
  const response = await api.post('/trips/pickup-intent', {
    latitude,
    longitude,
    destination,
  });

  return response.data?.request as PickupIntent;
};

export const listPickupIntents = async () => {
  const response = await api.get('/trips/pickup-intents');
  return (response.data?.requests || []) as PickupIntent[];
};

export const listPassengerRecentRides = async () => {
  const response = await api.get('/trips/passenger-recent-rides');
  return (response.data?.rides || []) as PassengerRecentRide[];
};

export const unboardPassenger = async (shuttleId: string, unboardCount = 1) => {
  const response = await api.post('/trips/passenger-unboard', {
    shuttleId,
    unboardCount,
  });

  return {
    trip: response.data?.trip,
    shuttle: response.data?.shuttle,
  };
};

export const getCurrentPassengers = async (tripId: string) => {
  const response = await api.get(`/trips/${tripId}/current-passengers`);
  return (response.data?.passengers || []);
};

export const listOnboardDestinations = async (shuttleId: string) => {
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
  remittanceStatus: 'not_submitted' | 'pending' | 'verified' | 'flagged';
  remittanceActualAmount: number | null;
  remittanceVariance: number | null;
  remittanceSubmittedAt: string | null;
};

export const listDriverCompletedTrips = async () => {
  const response = await api.get('/trips/driver-completed-trips');
  return (response.data?.trips || []) as DriverCompletedTrip[];
};

export const submitRemittance = async (tripId: string, actualAmount: number, driverNote?: string) => {
  const response = await api.post(`/trips/${tripId}/remittance`, {
    actualAmount,
    driverNote: driverNote || '',
  });
  return response.data?.remittance;
};

