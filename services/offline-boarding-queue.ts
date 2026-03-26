import AsyncStorage from '@react-native-async-storage/async-storage';

type OfflineBoardingItem = {
  id: string;
  shuttleId: string;
  boardedCount: number;
  createdAt: string;
};

const KEY = 'goshuttle_offline_boardings';
const LEGACY_KEY = 'transitlink_offline_boardings';

const migrateLegacyQueue = async () => {
  const current = await AsyncStorage.getItem(KEY);
  if (current) return;

  const legacy = await AsyncStorage.getItem(LEGACY_KEY);
  if (!legacy) return;

  await AsyncStorage.setItem(KEY, legacy);
  await AsyncStorage.removeItem(LEGACY_KEY);
};

const readQueue = async (): Promise<OfflineBoardingItem[]> => {
  await migrateLegacyQueue();
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as OfflineBoardingItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
};

const writeQueue = async (items: OfflineBoardingItem[]) => {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
};

export const addOfflineBoarding = async (shuttleId: string, boardedCount: number) => {
  const queue = await readQueue();
  const item: OfflineBoardingItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    shuttleId,
    boardedCount,
    createdAt: new Date().toISOString(),
  };

  queue.push(item);
  await writeQueue(queue);
  return item;
};

export const getOfflineBoardings = async () => {
  return readQueue();
};

export const setOfflineBoardings = async (items: OfflineBoardingItem[]) => {
  await writeQueue(items);
};

export type { OfflineBoardingItem };
