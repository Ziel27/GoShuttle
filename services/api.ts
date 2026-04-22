import axios from 'axios';

const rawApiBaseUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
if (!rawApiBaseUrl && process.env.NODE_ENV === 'production') {
  throw new Error(
    '[api] EXPO_PUBLIC_API_URL must be set in production. Add it to your .env file or EAS environment variables.'
  );
}

const API_BASE_URL = rawApiBaseUrl || 'http://192.168.100.226:5000/api';

if (!rawApiBaseUrl) {
  console.warn(
    '[api] EXPO_PUBLIC_API_URL is missing. Falling back to http://192.168.100.226:5000/api for development.'
  );
}

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

export const setAuthToken = (token: string | null) => {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
};

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const data = error?.response?.data || {};
    const message =
      data.error ||
      data.message ||
      error?.message ||
      'Request failed';

    const enhancedError = new Error(message);
    (enhancedError as any).responseData = data;
    (enhancedError as any).status = error?.response?.status;
    return Promise.reject(enhancedError);
  }
);
