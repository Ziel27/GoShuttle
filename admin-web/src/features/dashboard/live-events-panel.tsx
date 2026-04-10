import { FiActivity, FiWifi, FiWifiOff } from 'react-icons/fi';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { LiveEvent } from '@/types/domain';

type EventWithDate = LiveEvent & { dateLabel: string };

export const LiveEventsPanel = ({
  events,
  connected,
}: {
  events: EventWithDate[];
  connected: boolean;
}) => {
  return (
    <Card className="h-full border-slate-200 bg-white shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base font-semibold">Live Activity</CardTitle>
        <Badge variant={connected ? 'secondary' : 'outline'}>
          {connected ? <FiWifi className="h-3 w-3" /> : <FiWifiOff className="h-3 w-3" />}
          {connected ? 'Connected' : 'Disconnected'}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {events.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300/80 p-4 text-sm text-muted-foreground">
            Waiting for shuttle and trip events.
          </div>
        ) : (
          <ul className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
            {events.slice(0, 10).map((event) => (
              <li key={event.id} className="rounded-lg border border-slate-200 p-3">
                <p className="flex items-start gap-2 text-sm">
                  <FiActivity className="mt-0.5 h-4 w-4 text-emerald-600" />
                  <span>{event.label}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{event.dateLabel}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
};
