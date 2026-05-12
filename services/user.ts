import { api } from '@/services/api';
import type { User } from '@/store/auth';

export type DiscountType = 'student' | 'pwd' | 'senior';

export type DiscountVerification = {
  status: 'none' | 'pending' | 'approved' | 'rejected';
  discountType?: DiscountType | null;
  idImageUrl?: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
};

export const getMyDiscountVerification = async (): Promise<DiscountVerification> => {
  const response = await api.get('/me/discount-verification');
  const dv = response.data?.discountVerification;
  if (!dv) return { status: 'none' };
  return {
    status: (dv.status as DiscountVerification['status']) ?? 'none',
    discountType: (dv.type ?? dv.discountType ?? null) as DiscountType | null,
    idImageUrl: dv.idImageUrl ?? null,
    submittedAt: dv.submittedAt ?? null,
    reviewedAt: dv.reviewedAt ?? null,
    rejectionReason: dv.rejectionReason ?? null,
  };
};

export const submitDiscountVerification = async (
  discountType: DiscountType,
  imageUri: string
): Promise<DiscountVerification> => {
  const formData = new FormData();
  formData.append('discountType', discountType);
  const fileName = imageUri.split('/').pop() || 'id.jpg';
  const fileType = fileName.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formData.append('idPhoto', { uri: imageUri, name: fileName, type: fileType } as any);
  const response = await api.post('/me/discount-verification', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  const dv = response.data?.discountVerification;
  if (!dv) return { status: 'none' };
  return {
    status: (dv.status as DiscountVerification['status']) ?? 'pending',
    discountType: (dv.type ?? dv.discountType ?? null) as DiscountType | null,
    idImageUrl: dv.idImageUrl ?? null,
    submittedAt: dv.submittedAt ?? null,
    reviewedAt: dv.reviewedAt ?? null,
    rejectionReason: dv.rejectionReason ?? null,
  };
};

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
