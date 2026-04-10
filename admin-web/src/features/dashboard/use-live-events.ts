import { useEffect, useMemo, useState } from 'react';

import { toShortDate } from '@/lib/format';
import { connectAdminSocket, disconnectAdminSocket } from '@/lib/socket-client';
import type { LiveEvent } from '@/types/domain';

const MAX_EVENTS = 40;

const makeEvent = (label: string): LiveEvent => ({
  id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
  label,
  createdAt: Date.now(),
});

export const useLiveEvents = (token: string | null, communityId: string) => {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!communityId) {
      return;
    }

    const socket = connectAdminSocket(token, communityId);

    const append = (event: LiveEvent) => {
      setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
    };

    const onConnect = () => {
      setConnected(true);
      append(makeEvent('Realtime connected'));
    };

    const onDisconnect = () => {
      setConnected(false);
      append(makeEvent('Realtime disconnected'));
    };

    const onConnectError = (error: Error) => {
      append(makeEvent(`Socket error: ${error.message}`));
    };

    const onPassengerBoarded = (payload: {
      boardedCount?: number;
      shuttleId?: string;
      passengersBoarded?: number;
    }) => {
      append(
        makeEvent(
          `Boarding +${payload.boardedCount || 0} on shuttle ${payload.shuttleId || '-'} (${payload.passengersBoarded || 0} total)`
        )
      );
    };

    const onCapacityUpdated = (payload: {
      shuttleId?: string;
      currentCapacity?: number;
      maxCapacity?: number;
    }) => {
      append(
        makeEvent(
          `Capacity update ${payload.shuttleId || '-'}: ${payload.currentCapacity || 0}/${payload.maxCapacity || 0}`
        )
      );
    };

    const onLocationUpdated = (payload: { shuttleId?: string; status?: string }) => {
      append(makeEvent(`Location update ${payload.shuttleId || '-'} (${payload.status || 'unknown'})`));
    };

    const onPassengerUnboarded = (payload: {
      unboardCount?: number;
      shuttleId?: string;
      currentCapacity?: number;
      maxCapacity?: number;
      timestamp?: string;
    }) => {
      append(
        makeEvent(
          `Unboarding -${payload.unboardCount || 0} on shuttle ${payload.shuttleId || '-'} (${payload.currentCapacity || 0}/${payload.maxCapacity || 0})`
        )
      );
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('trip:passenger-boarded', onPassengerBoarded);
    socket.on('trip:passenger-unboarded', onPassengerUnboarded);
    socket.on('shuttle:capacity-updated', onCapacityUpdated);
    socket.on('shuttle:location-updated', onLocationUpdated);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('trip:passenger-boarded', onPassengerBoarded);
      socket.off('trip:passenger-unboarded', onPassengerUnboarded);
      socket.off('shuttle:capacity-updated', onCapacityUpdated);
      socket.off('shuttle:location-updated', onLocationUpdated);
      disconnectAdminSocket();
      setConnected(false);
    };
  }, [token, communityId]);

  const formatted = useMemo(
    () =>
      events.map((item) => ({
        ...item,
        dateLabel: toShortDate(item.createdAt),
      })),
    [events]
  );

  return {
    events: formatted,
    connected,
  };
};
