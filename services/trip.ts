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
  status: 'pending' | 'claimed' | 'expired';
  expiresAt: string;
};

export type PassengerRecentRide = {
  rideId: string;
  status: 'completed';
  requestedAt: string;
  boardedAt: string;
  fareAtBoarding: number;
  pickupLocation: {
    type: 'Point';
    coordinates: [number, number];
  };
  shuttle: {
    plateNumber: string;
    label: string;
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

export const createPickupIntent = async (latitude: number, longitude: number) => {
  const response = await api.post('/trips/pickup-intent', {
    latitude,
    longitude,
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
