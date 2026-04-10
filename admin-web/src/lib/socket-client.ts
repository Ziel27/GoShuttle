import { io, Socket } from 'socket.io-client';

import { SOCKET_BASE_URL } from '@/lib/config';

let socket: Socket | null = null;

export const connectAdminSocket = (token: string | null, communityId?: string) => {
  const authPayload = token ? { token } : {};

  if (!socket) {
    socket = io(SOCKET_BASE_URL, {
      transports: ['polling', 'websocket'],
      upgrade: true,
      timeout: 10000,
      reconnection: true,
      reconnectionAttempts: 10,
      withCredentials: true,
      auth: authPayload,
    });
  } else {
    socket.auth = authPayload;
    if (!socket.connected) {
      socket.connect();
    }
  }

  if (communityId) {
    socket.emit('join-community', { communityId });
  }

  return socket;
};

export const disconnectAdminSocket = () => {
  if (!socket) return;
  socket.disconnect();
  socket = null;
};
