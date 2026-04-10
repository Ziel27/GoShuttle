import axios from 'axios';

const rawApiBaseUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
const API_BASE_URL = rawApiBaseUrl || 'http://192.168.100.224:5000/api';

if (!rawApiBaseUrl) {
  console.warn(
    '[api] EXPO_PUBLIC_API_URL is missing. Falling back to http://192.168.100.224:5000/api for development.'
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
    const message =
      error?.response?.data?.error ||
      error?.response?.data?.message ||
      error?.message ||
      'Request failed';

    return Promise.reject(new Error(message));
  }
);
