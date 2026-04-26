import { api } from '@/services/api';
import type { User } from '@/store/auth';

export const setHomeDestinationFromGps = async (
  latitude: number,
  longitude: number,
  label = 'Home'
) => {
  const response = await api.patch('/users/me/home-destination', {
    latitude,
    longitude,
    label,
  });

  return response.data?.user as User;
};

export const updateHomePhase = async (homePhase: string | null) => {
  const response = await api.patch('/users/me/home-phase', {
    homePhase,
  });

  return response.data?.user as User;
};
