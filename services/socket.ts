import { io, Socket } from 'socket.io-client';

const rawSocketUrl = process.env.EXPO_PUBLIC_SOCKET_URL?.trim();
const rawApiBaseUrl = process.env.EXPO_PUBLIC_API_URL?.trim();

if (!rawSocketUrl && !rawApiBaseUrl && process.env.NODE_ENV === 'production') {
  throw new Error(
    '[socket] EXPO_PUBLIC_SOCKET_URL or EXPO_PUBLIC_API_URL must be set in production. Add one to your .env file or EAS environment variables.'
  );
}

const SOCKET_URL = (() => {
  if (rawSocketUrl) {
    return rawSocketUrl;
  }

  if (rawApiBaseUrl) {
    return rawApiBaseUrl.replace(/\/api\/?$/, '');
  }

  const fallbackSocketUrl = 'http://192.168.100.224:5000';
  console.warn(
    '[socket] EXPO_PUBLIC_SOCKET_URL and EXPO_PUBLIC_API_URL are missing. Falling back to http://192.168.100.224:5000 for development.'
  );
  return fallbackSocketUrl;
})();

let socket: Socket | null = null;
let activeCommunityId: string | null = null;

export const connectCommunitySocket = (communityId: string, token?: string | null) => {
  const currentAuthToken =
    socket && typeof socket.auth !== 'function'
      ? (socket.auth as Record<string, unknown>)?.token
      : undefined;

  if (communityId) {
    activeCommunityId = communityId;
  }

  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ['websocket'],
      auth: token ? { token } : undefined,
    });

    socket.on('connect', () => {
      if (activeCommunityId) {
        socket?.emit('join-community', { communityId: activeCommunityId });
      }
    });
  } else if (token && currentAuthToken !== token) {
    socket.auth = { token };
    if (socket.connected) {
      socket.disconnect();
    }
    socket.connect();
  }

  if (activeCommunityId) {
    socket.emit('join-community', { communityId: activeCommunityId });
  }

  return socket;
};

export const getSocket = () => socket;

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
    activeCommunityId = null;
  }
};
