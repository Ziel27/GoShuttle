import { io, Socket } from 'socket.io-client';

const SOCKET_URL = (() => {
  const explicitSocketUrl = process.env.EXPO_PUBLIC_SOCKET_URL?.trim();
  if (explicitSocketUrl) {
    return explicitSocketUrl;
  }

  const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (apiBaseUrl) {
    return apiBaseUrl.replace(/\/api\/?$/, '');
  }

  const fallbackSocketUrl = 'http://192.168.100.224:5000';
  console.warn(
    '[socket] EXPO_PUBLIC_SOCKET_URL and EXPO_PUBLIC_API_URL are missing. Falling back to http://192.168.100.224:5000 for development.'
  );
  return fallbackSocketUrl;
})();

let socket: Socket | null = null;

export const connectCommunitySocket = (communityId: string, token?: string | null) => {
  const currentAuthToken =
    socket && typeof socket.auth !== 'function'
      ? (socket.auth as Record<string, unknown>)?.token
      : undefined;

  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ['websocket'],
      auth: token ? { token } : undefined,
    });
  } else if (token && currentAuthToken !== token) {
    socket.auth = { token };
    if (socket.connected) {
      socket.disconnect();
    }
    socket.connect();
  }

  if (communityId) {
    socket.emit('join-community', { communityId });
  }

  return socket;
};

export const getSocket = () => socket;

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
