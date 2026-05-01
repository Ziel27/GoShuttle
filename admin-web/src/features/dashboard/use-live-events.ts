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

const formatPickupIntentEvent = (payload: {
  passengerId?: string;
  passengerManifest?: Array<{ name?: string | null; phone?: string | null }>;
  destinationType?: string;
  destinationLabel?: string;
  fareType?: string;
}) => {
  const guestCount = payload.passengerManifest?.length || 0;
  const label = `Pickup request${guestCount > 0 ? ` with ${guestCount} guest${guestCount > 1 ? 's' : ''}` : ''}`;
  const details: string[] = [];

  if (payload.destinationType || payload.destinationLabel) {
    details.push(`${payload.destinationType || 'destination'} · ${payload.destinationLabel || 'Unknown'}`);
  }

  if (payload.fareType) {
    details.push(`Fare: ${payload.fareType}`);
  }

  if (guestCount > 0) {
    for (const guest of payload.passengerManifest || []) {
      const chunks = [guest.name || 'Guest'];
      if (guest.phone) chunks.push(guest.phone);
      details.push(chunks.join(' · '));
    }
  }

  return { label, details };
};

export const useLiveEvents = (communityId: string) => {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!communityId) {
      return;
    }

    const socket = connectAdminSocket(communityId);

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

    const onPickupIntent = (payload: {
      passengerId?: string;
      passengerManifest?: Array<{ name?: string | null; phone?: string | null }>;
      destinationType?: string;
      destinationLabel?: string;
      fareType?: string;
    }) => {
      const formatted = formatPickupIntentEvent(payload);
      append({
        id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        label: formatted.label,
        details: formatted.details,
        createdAt: Date.now(),
      });
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
    socket.on('trip:pickup-intent', onPickupIntent);
    socket.on('shuttle:capacity-updated', onCapacityUpdated);
    socket.on('shuttle:location-updated', onLocationUpdated);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('trip:passenger-boarded', onPassengerBoarded);
      socket.off('trip:passenger-unboarded', onPassengerUnboarded);
      socket.off('trip:pickup-intent', onPickupIntent);
      socket.off('shuttle:capacity-updated', onCapacityUpdated);
      socket.off('shuttle:location-updated', onLocationUpdated);
      disconnectAdminSocket();
      setConnected(false);
    };
  }, [communityId]);

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
