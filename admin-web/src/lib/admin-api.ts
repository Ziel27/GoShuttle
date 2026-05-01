import { apiClient } from '@/lib/api-client';
import type {
    AnalyticsResponse,
    Announcement,
    AnnouncementLevel,
    Community,
    DriverAnalyticsResponse,
    DriverPerformanceResponse,
    Remittance,
    RemittanceSummaryResponse,
    Shuttle,
    User,
} from '@/types/domain';


export const fetchAnalytics = async (params?: {
  startDate?: string;
  endDate?: string;
  communityId?: string;
}): Promise<AnalyticsResponse> => {
  const response = await apiClient.get('/trips/analytics', { params });
  return response.data;
};

export const fetchUsers = async (params?: {
  role?: 'admin' | 'driver' | 'passenger';
  active?: boolean;
  communityId?: string;
}): Promise<User[]> => {
  const response = await apiClient.get('/users', {
    params: {
      role: params?.role,
      active: params?.active,
      communityId: params?.communityId,
    },
  });

  return (response.data?.users || []) as User[];
};

export const patchUserStatus = async (
  userId: string,
  payload: { isActive?: boolean; status?: 'active' | 'offline' | 'driving' }
): Promise<User> => {
  const response = await apiClient.patch(`/users/${userId}`, payload);
  return response.data?.user as User;
};

export const fetchShuttles = async (params?: { active?: boolean; communityId?: string }): Promise<Shuttle[]> => {
  const response = await apiClient.get('/shuttles', {
    params: {
      active: params?.active,
      communityId: params?.communityId,
    },
  });

  return (response.data?.shuttles || []) as Shuttle[];
};

export const assignShuttleDriver = async (
  shuttleId: string,
  driverId: string | null,
  assignedPhase?: string | null
): Promise<Shuttle> => {
  const response = await apiClient.patch(`/shuttles/${shuttleId}/assign-driver`, {
    driverId,
    ...(assignedPhase !== undefined ? { assignedPhase } : {}),
  });
  return response.data?.shuttle as Shuttle;
};

export const createShuttle = async (payload: {
  plateNumber: string;
  maxCapacity: number;
  label?: string;
  assignedPhase?: string | null;
}): Promise<Shuttle> => {
  const response = await apiClient.post('/shuttles', payload);
  return response.data?.shuttle as Shuttle;
};

export const fetchCommunities = async (): Promise<Community[]> => {
  const response = await apiClient.get('/communities');
  return (response.data?.communities || []) as Community[];
};

export const fetchCommunityById = async (communityId: string): Promise<Community> => {
  const response = await apiClient.get(`/communities/${communityId}`);
  return response.data?.community as Community;
};

export const createCommunity = async (payload: {
  name: string;
  baseFare: number;
  boundaries: { type: 'Polygon'; coordinates: number[][][] };
  branding?: { primaryColor?: string; logoUrl?: string };
}): Promise<Community> => {
  const response = await apiClient.post('/communities', payload);
  return response.data?.community as Community;
};

export const updateCommunity = async (
  communityId: string,
  payload: {
    name?: string;
    baseFare?: number;
    priorityFareMultiplier?: number;
    boundaries?: { type: 'Polygon'; coordinates: number[][][] };
    branding?: { primaryColor?: string; logoUrl?: string };
    isActive?: boolean;
    opsBypassMode?: boolean;
  }
): Promise<Community> => {
  const response = await apiClient.put(`/communities/${communityId}`, payload);
  return response.data?.community as Community;
};


export const fetchFixedDestinations = async (communityId: string) => {
  const response = await apiClient.get(`/communities/${communityId}/fixed-destinations`);
  return (response.data?.destinations || []) as NonNullable<Community['fixedDestinations']>;
};

export const createFixedDestination = async (
  communityId: string,
  payload: { name: string; latitude: number; longitude: number; pickupRadiusMeters?: number; color?: string; order?: number }
) => {
  const response = await apiClient.post(`/communities/${communityId}/fixed-destinations`, payload);
  return response.data?.destination as NonNullable<Community['fixedDestinations']>[number];
};

export const updateFixedDestination = async (
  communityId: string,
  destinationId: string,
  payload: {
    name?: string;
    latitude?: number;
    longitude?: number;
    pickupRadiusMeters?: number;
    color?: string;
    order?: number;
    isActive?: boolean;
  }
) => {
  const response = await apiClient.patch(`/communities/${communityId}/fixed-destinations/${destinationId}`, payload);
  return response.data?.destination as NonNullable<Community['fixedDestinations']>[number];
};

export const archiveFixedDestination = async (communityId: string, destinationId: string) => {
  await apiClient.delete(`/communities/${communityId}/fixed-destinations/${destinationId}`);
};

// Phase Geofence API functions

export interface PhaseGeofence {
  _id: string;
  name: string;
  boundaries: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  color: string;
  isActive: boolean;
  order: number;
}

export const fetchPhaseGeofences = async (communityId: string): Promise<PhaseGeofence[]> => {
  const response = await apiClient.get(`/communities/${communityId}/phase-geofences`);
  return (response.data?.phaseGeofences || []) as PhaseGeofence[];
};

export const createPhaseGeofence = async (
  communityId: string,
  payload: {
    name: string;
    boundaries: { type: 'Polygon'; coordinates: number[][][] };
    color?: string;
    order?: number;
  }
): Promise<PhaseGeofence> => {
  const response = await apiClient.post(`/communities/${communityId}/phase-geofences`, payload);
  return response.data?.phaseGeofence as PhaseGeofence;
};

export const updatePhaseGeofence = async (
  communityId: string,
  phaseId: string,
  payload: {
    name?: string;
    boundaries?: { type: 'Polygon'; coordinates: number[][][] };
    color?: string;
    order?: number;
    isActive?: boolean;
  }
): Promise<PhaseGeofence> => {
  const response = await apiClient.patch(`/communities/${communityId}/phase-geofences/${phaseId}`, payload);
  return response.data?.phaseGeofence as PhaseGeofence;
};

export const archivePhaseGeofence = async (communityId: string, phaseId: string) => {
  await apiClient.delete(`/communities/${communityId}/phase-geofences/${phaseId}`);
};

export const createManagedUser = async (payload: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role: 'admin' | 'driver';
  phone?: string;
  communityId?: string;
}): Promise<User> => {
  const response = await apiClient.post('/users', payload);
  return response.data?.user as User;
};

export const fetchDriverAnalytics = async (params?: {
  startDate?: string;
  endDate?: string;
  driverId?: string;
  communityId?: string;
}): Promise<DriverAnalyticsResponse> => {
  const response = await apiClient.get('/trips/driver-analytics', { params });
  return response.data as DriverAnalyticsResponse;
};

export const fetchDriverPerformance = async (params?: {
  startDate?: string;
  endDate?: string;
  driverId?: string;
  communityId?: string;
}): Promise<DriverPerformanceResponse> => {
  const response = await apiClient.get('/trips/driver-performance', { params });
  return response.data as DriverPerformanceResponse;
};

export const fetchRemittanceSummary = async (params?: {
  startDate?: string;
  endDate?: string;
  communityId?: string;
  driverId?: string;
  groupBy?: 'day' | 'week' | 'month';
}): Promise<RemittanceSummaryResponse> => {
  const response = await apiClient.get('/trips/remittance-summary', { params });
  return response.data as RemittanceSummaryResponse;
};

export const fetchRemittances = async (params?: {
  startDate?: string;
  endDate?: string;
  status?: 'not_submitted' | 'pending' | 'verified' | 'flagged' | 'overdue' | 'escalated';
  driverId?: string;
  limit?: number;
}): Promise<Remittance[]> => {
  const response = await apiClient.get('/trips/remittances', { params });
  return (response.data?.remittances || []) as Remittance[];
};

export const verifyRemittance = async (
  remittanceId: string,
  payload: { status: 'verified' | 'flagged' | 'pending' | 'overdue' | 'escalated'; adminNote?: string }
): Promise<Remittance> => {
  const response = await apiClient.patch(`/trips/remittances/${remittanceId}/verify`, payload);
  return response.data?.remittance as Remittance;
};

export const fetchAnnouncements = async (params?: {
  limit?: number;
  before?: string;
}): Promise<Announcement[]> => {
  const response = await apiClient.get('/announcements', { params });
  return (response.data?.announcements || []) as Announcement[];
};

export const createAnnouncement = async (payload: {
  title: string;
  body: string;
  level?: AnnouncementLevel;
}): Promise<Announcement> => {
  const response = await apiClient.post('/announcements', payload);
  return response.data?.announcement as Announcement;
};

export const adminBypassPickupIntent = async (payload: {
  latitude: number;
  longitude: number;
  fareType?: 'standard' | 'priority';
}) => {
  const response = await apiClient.post('/trips/pickup-intent', {
    ...payload,
    _adminBypassOnDutyCheck: true,
  });
  return response.data;
};

