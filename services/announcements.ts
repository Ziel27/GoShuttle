import { api } from '@/services/api';

export type AnnouncementLevel = 'info' | 'warning' | 'critical';

export type Announcement = {
  _id: string;
  title: string;
  body: string;
  level: AnnouncementLevel;
  createdAt: string;
  updatedAt: string;
  createdBy?: {
    firstName?: string;
    lastName?: string;
    email?: string;
  };
};

export const listAnnouncements = async (params?: {
  limit?: number;
  before?: string;
}): Promise<Announcement[]> => {
  const response = await api.get('/announcements', { params });
  return (response.data?.announcements || []) as Announcement[];
};

