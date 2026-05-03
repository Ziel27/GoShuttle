import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { api, setAuthToken } from '@/services/api';

type User = {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: 'admin' | 'driver' | 'passenger';
  communityId: string;
  status?: 'active' | 'offline' | 'driving';
  homePhase?: string | null;
  homeDestination?: {
    label: string;
    location: {
      type: 'Point';
      coordinates: [number, number];
    };
    updatedAt?: string | null;
  };
};

type RegisterPayload = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  communityId?: string;
  phone?: string;
};

type AuthState = {
  token: string | null;
  user: User | null;
  hydrated: boolean;
  hasSeenWelcome: boolean;
  loading: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  markWelcomeSeen: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  updateUserField: <K extends keyof User>(field: K, value: User[K]) => void;
};

const TOKEN_KEY = 'goshuttle_token';
const USER_KEY = 'goshuttle_user';
const WELCOME_SEEN_KEY = 'goshuttle_welcome_seen';

const saveSession = async (token: string, user: User) => {
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, token),
    SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)),
  ]);
};

const clearSession = async () => {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
  ]);
};

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  hydrated: false,
  hasSeenWelcome: false,
  loading: false,
  error: null,

  hydrate: async () => {
    try {
      const [token, userJson, welcomeSeen] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(USER_KEY),
        SecureStore.getItemAsync(WELCOME_SEEN_KEY),
      ]);

      if (token && userJson) {
        const user = JSON.parse(userJson) as User;
        setAuthToken(token);
        set({ token, user, hydrated: true, hasSeenWelcome: welcomeSeen === 'true' });
      } else {
        setAuthToken(null);
        set({ token: null, user: null, hydrated: true, hasSeenWelcome: welcomeSeen === 'true' });
      }
    } catch {
      setAuthToken(null);
      set({ token: null, user: null, hydrated: true, hasSeenWelcome: false });
    }
  },

  markWelcomeSeen: async () => {
    await SecureStore.setItemAsync(WELCOME_SEEN_KEY, 'true');
    set({ hasSeenWelcome: true });
  },

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const response = await api.post('/auth/login', { email, password });
      const token = response.data?.token as string;
      const user = response.data?.user as User;

      if (!token || !user) {
        throw new Error('Invalid login response from server.');
      }

      await saveSession(token, user);
      setAuthToken(token);
      set({ token, user, loading: false, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed.';
      set({ loading: false, error: message });
      throw error;
    }
  },

  register: async (payload) => {
    set({ loading: true, error: null });
    try {
      const response = await api.post('/auth/register', payload);
      const token = response.data?.token as string;
      const user = response.data?.user as User;

      if (!token || !user) {
        throw new Error('Invalid registration response from server.');
      }

      await saveSession(token, user);
      setAuthToken(token);
      set({ token, user, loading: false, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed.';
      set({ loading: false, error: message });
      throw error;
    }
  },

  logout: async () => {
    await clearSession();
    await SecureStore.setItemAsync(WELCOME_SEEN_KEY, 'true');
    setAuthToken(null);
    set({ token: null, user: null, hasSeenWelcome: true, error: null });
  },

  clearError: () => {
    set({ error: null });
  },

  updateUserField: (field, value) => {
    set((state) => {
      const nextUser = state.user ? { ...state.user, [field]: value } : null;
      if (nextUser) {
        void SecureStore.setItemAsync(USER_KEY, JSON.stringify(nextUser));
      }

      return {
        user: nextUser,
      };
    });
  },
}));

export const selectHomeDestination = (state: AuthState) => state.user?.homeDestination ?? null;

export type { AuthState, RegisterPayload, User };

