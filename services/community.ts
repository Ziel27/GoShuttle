import { api } from './api';

export interface CommunityBoundaries {
  type: 'Polygon';
  coordinates: [number, number][][];
}

export interface Community {
  _id: string;
  name: string;
  opsBypassMode?: boolean;
  baseFare?: number;
  priorityFareMultiplier?: number;
  boundaries?: CommunityBoundaries;
  fixedDestinations?: {
    _id: string;
    name: string;
    location: {
      type: 'Point';
      coordinates: [number, number];
    };
    pickupRadiusMeters?: number;
    color?: string;
    order?: number;
    isActive?: boolean;
  }[];
}

export interface PublicCommunity {
  _id: string;
  name: string;
}

export const listCommunities = async (): Promise<PublicCommunity[]> => {
  const { data } = await api.get<{ communities: PublicCommunity[] }>('/communities');
  return data?.communities ?? [];
};

export interface PhaseGeofence {
  _id: string;
  name: string;
  boundaries: CommunityBoundaries;
  color: string;
  isActive: boolean;
  order: number;
}

export const getCommunityById = async (communityId: string): Promise<Community | null> => {
  if (!communityId) return null;
  const { data } = await api.get<{ community: Community }>(`/communities/${communityId}`);
  return data?.community ?? null;
};

export const getPhaseGeofences = async (communityId: string): Promise<PhaseGeofence[]> => {
  if (!communityId) return [];
  const { data } = await api.get<{ phaseGeofences: PhaseGeofence[] }>(`/communities/${communityId}/phase-geofences`);
  return data?.phaseGeofences ?? [];
};
