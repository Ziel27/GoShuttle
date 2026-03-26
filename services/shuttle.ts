import { api } from '@/services/api';
import type { GeoPoint } from '@/services/map-types';

export type Shuttle = {
  _id: string;
  communityId: string;
  driverId: string | null;
  plateNumber: string;
  label: string;
  maxCapacity: number;
  currentCapacity: number;
  status: 'idle' | 'en_route' | 'out_of_bounds' | 'maintenance';
  location: GeoPoint;
  capacityStatus?: 'available' | 'filling' | 'full';
  updatedAt?: string;
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
  return response.data?.shuttle as Shuttle;
};

export const updateShuttleCapacity = async (shuttleId: string, delta: number) => {
  const response = await api.patch(`/shuttles/${shuttleId}/capacity`, { delta });
  return response.data?.shuttle as Shuttle;
};
