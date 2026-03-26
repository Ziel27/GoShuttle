import { api } from '@/services/api';
import type { GeoPolygon } from '@/services/map-types';

export type Community = {
  _id: string;
  name: string;
  boundaries: GeoPolygon;
  baseFare: number;
  branding?: {
    primaryColor?: string;
    logoUrl?: string;
  };
};

export const getCommunityById = async (communityId: string) => {
  const response = await api.get(`/communities/${communityId}`);
  return response.data?.community as Community;
};
