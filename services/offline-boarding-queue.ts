import AsyncStorage from '@react-native-async-storage/async-storage';

type OfflineBoardingItem = {
  id: string;
  shuttleId: string;
  boardedCount: number;
  createdAt: string;
};

const KEY = 'goshuttle_offline_boardings';
// LEGACY MIGRATION REMOVED — safe after confirming all users are on GoShuttle v1+

const readQueue = async (): Promise<OfflineBoardingItem[]> => {
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

/**
 * Adds one boarding action to the offline queue for later sync.
 * @throws {Error} When local persistence fails.
 */
export const addOfflineBoarding = async (shuttleId: string, boardedCount: number): Promise<OfflineBoardingItem> => {
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

/**
 * Returns all queued offline boarding actions.
 * @throws {Error} When local persistence fails.
 */
export const getOfflineBoardings = async (): Promise<OfflineBoardingItem[]> => {
  return readQueue();
};

/**
 * Replaces queued offline boarding actions with a provided list.
 * @throws {Error} When local persistence fails.
 */
export const setOfflineBoardings = async (items: OfflineBoardingItem[]): Promise<void> => {
  await writeQueue(items);
};

/**
 * Replays queued offline boardings through a sync callback and retains failures.
 * @throws {Error} When local persistence fails.
 */
export const syncOfflineBoardings = async (
  syncFn: (shuttleId: string, boardedCount: number) => Promise<void>
): Promise<{ synced: number; failed: number }> => {
  const queue = await readQueue();
  if (queue.length === 0) {
    return { synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;
  const remaining: OfflineBoardingItem[] = [];

  for (const item of queue) {
    try {
      await syncFn(item.shuttleId, item.boardedCount);
      synced += 1;
    } catch {
      failed += 1;
      remaining.push(item);
    }
  }

  await writeQueue(remaining);
  return { synced, failed };
};

export type { OfflineBoardingItem };
