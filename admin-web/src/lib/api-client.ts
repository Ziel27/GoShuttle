import axios from 'axios';

import { API_BASE_URL } from '@/lib/config';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  withCredentials: true, // Enable sending cookies with requests
});

export const setApiAuthToken = (token: string | null) => {
  // For backward compatibility - tokens can still be used as Bearer tokens if needed
  // But HttpOnly cookies will be automatically sent by the browser
  if (token) {
    apiClient.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete apiClient.defaults.headers.common.Authorization;
  }
};

apiClient.interceptors.response.use(
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
