import axios from 'axios';

const rawApiBaseUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

const API_BASE_URL = rawApiBaseUrl || (() => {
  throw new Error(
    '[api] EXPO_PUBLIC_API_URL is required. Set it in your environment, Expo config, or EAS profile so the app can reach the public API.'
  );
})();

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
    const status = error?.response?.status;
    const message =
      data.error ||
      data.message ||
      error?.message ||
      'Request failed';

    // Automatically log out if the token is invalid/expired
    if (status === 401) {
      // Use dynamic import or require to avoid circular dependencies
      const authStore = require('@/store/auth').useAuthStore;
      authStore.getState().logout();
    }

    const enhancedError = new Error(message);
    (enhancedError as any).responseData = data;
    (enhancedError as any).status = status;
    return Promise.reject(enhancedError);
  }
);
