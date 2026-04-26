// STUB — push notifications infrastructure. Wire up when backend supports /users/me/push-token

import Constants from 'expo-constants';

type NotificationsModule = typeof import('expo-notifications');

const getExecutionEnvironment = (): string | undefined => {
  const maybeConstants = Constants as { executionEnvironment?: string };
  return maybeConstants.executionEnvironment;
};

const isExpoGo = (): boolean => {
  const environment = getExecutionEnvironment();
  return environment === 'storeClient' || Constants.appOwnership === 'expo';
};

const isUnsupportedExpoGoPushRuntime = (): boolean => {
  return isExpoGo();
};

export const isPushNotificationsAvailableInRuntime = (): boolean => {
  return !isUnsupportedExpoGoPushRuntime();
};

const loadNotificationsModule = async (): Promise<NotificationsModule | null> => {
  if (!isPushNotificationsAvailableInRuntime()) {
    return null;
  }

  try {
    return await import('expo-notifications');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('expo go')) {
      return null;
    }
    throw error;
  }
};

/**
 * Requests notification permissions and returns an Expo push token when granted.
 * @throws {Error} When notification permissions or token retrieval fails.
 */
export const registerForPushNotifications = async (): Promise<string | null> => {
  const Notifications = await loadNotificationsModule();
  if (!Notifications) {
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  try {
    const token = await Notifications.getExpoPushTokenAsync();
    return token.data;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('expo go')) {
      return null;
    }
    throw error;
  }
};

/**
 * Placeholder token persistence until backend token endpoint is implemented.
 * @throws {Error} When future token persistence API request fails.
 */
export const savePushToken = async (_token: string): Promise<void> => {
  // TODO: POST to /users/me/push-token — deferred until backend endpoint is implemented.
};
