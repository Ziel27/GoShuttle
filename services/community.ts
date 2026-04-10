import { api } from './api';

export interface CommunityBoundaries {
  type: 'Polygon';
  coordinates: [number, number][][];
}

export interface Community {
  _id: string;
  name: string;
  boundaries?: CommunityBoundaries;
  fixedDestinations?: {
    _id: string;
    name: string;
    location: {
      type: 'Point';
      coordinates: [number, number];
    };
    order?: number;
    isActive?: boolean;
  }[];
}

export const getCommunityById = async (communityId: string): Promise<Community | null> => {
  if (!communityId) return null;
  const { data } = await api.get<{ community: Community }>(`/communities/${communityId}`);
  return data?.community ?? null;
};
