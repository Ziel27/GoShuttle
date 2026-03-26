import { io, Socket } from 'socket.io-client';

const SOCKET_URL =
  process.env.EXPO_PUBLIC_SOCKET_URL || process.env.EXPO_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:5000';

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
