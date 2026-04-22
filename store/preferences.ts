import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

type ThemeMode = 'system' | 'light' | 'dark';

type PreferencesState = {
  hydrated: boolean;
  themeMode: ThemeMode;
  pushAlerts: boolean;
  serviceUpdates: boolean;
  quietMode: boolean;
  showEta: boolean;
  hapticsEnabled: boolean;
  // TODO: Remove compactMapPins and precisePickup from preferences store - deferred because active screens still consume these flags.
  compactMapPins: boolean;
  precisePickup: boolean;
  hydrate: () => Promise<void>;
  setThemeMode: (value: ThemeMode) => Promise<void>;
  setPushAlerts: (value: boolean) => Promise<void>;
  setServiceUpdates: (value: boolean) => Promise<void>;
  setQuietMode: (value: boolean) => Promise<void>;
  setShowEta: (value: boolean) => Promise<void>;
  setHapticsEnabled: (value: boolean) => Promise<void>;
  setCompactMapPins: (value: boolean) => Promise<void>;
  setPrecisePickup: (value: boolean) => Promise<void>;
};

type PreferencesPayload = Omit<
  PreferencesState,
  | 'hydrated'
  | 'hydrate'
  | 'setThemeMode'
  | 'setPushAlerts'
  | 'setServiceUpdates'
  | 'setQuietMode'
  | 'setShowEta'
  | 'setHapticsEnabled'
  | 'setCompactMapPins'
  | 'setPrecisePickup'
>;

const PREFERENCES_KEY = 'goshuttle_preferences';

const defaults: PreferencesPayload = {
  themeMode: 'system',
  pushAlerts: true,
  serviceUpdates: true,
  quietMode: false,
  showEta: true,
  hapticsEnabled: true,
  compactMapPins: false,
  precisePickup: true,
};

const save = async (next: PreferencesPayload) => {
  await AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
};

const updateAndSave = async (
  set: (partial: Partial<PreferencesState>) => void,
  patch: Partial<PreferencesPayload>,
  current: () => PreferencesState
) => {
  const merged = {
    themeMode: current().themeMode,
    pushAlerts: current().pushAlerts,
    serviceUpdates: current().serviceUpdates,
    quietMode: current().quietMode,
    showEta: current().showEta,
    hapticsEnabled: current().hapticsEnabled,
    compactMapPins: current().compactMapPins,
    precisePickup: current().precisePickup,
    ...patch,
  } as PreferencesPayload;

  set(merged);
  await save(merged);
};

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  hydrated: false,
  ...defaults,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(PREFERENCES_KEY);
      if (!raw) {
        set({ hydrated: true });
        return;
      }

      const parsed = JSON.parse(raw) as Partial<PreferencesPayload>;
      set({
        themeMode: parsed.themeMode ?? defaults.themeMode,
        pushAlerts: parsed.pushAlerts ?? defaults.pushAlerts,
        serviceUpdates: parsed.serviceUpdates ?? defaults.serviceUpdates,
        quietMode: parsed.quietMode ?? defaults.quietMode,
        showEta: parsed.showEta ?? defaults.showEta,
        hapticsEnabled: parsed.hapticsEnabled ?? defaults.hapticsEnabled,
        compactMapPins: parsed.compactMapPins ?? defaults.compactMapPins,
        precisePickup: parsed.precisePickup ?? defaults.precisePickup,
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },

  setThemeMode: async (value) => updateAndSave(set, { themeMode: value }, get),
  setPushAlerts: async (value) => updateAndSave(set, { pushAlerts: value }, get),
  setServiceUpdates: async (value) => updateAndSave(set, { serviceUpdates: value }, get),
  setQuietMode: async (value) => updateAndSave(set, { quietMode: value }, get),
  setShowEta: async (value) => updateAndSave(set, { showEta: value }, get),
  setHapticsEnabled: async (value) => updateAndSave(set, { hapticsEnabled: value }, get),
  setCompactMapPins: async (value) => updateAndSave(set, { compactMapPins: value }, get),
  setPrecisePickup: async (value) => updateAndSave(set, { precisePickup: value }, get),
}));

export type { ThemeMode };
