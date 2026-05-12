import { useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/context/auth-context';
import {
  assignShuttleDriver,
  createShuttle,
  fetchCommunityById,
  fetchPhaseGeofences,
  fetchShuttles,
  fetchUsers,
  updateCommunity,
  type PhaseGeofence,
} from '@/lib/admin-api';
import { communityIdFromUnknown, toShortDate } from '@/lib/format';
import { connectAdminSocket, disconnectAdminSocket } from '@/lib/socket-client';
import type { Shuttle, User } from '@/types/domain';

/** Returns the effective shuttle status, clamping to idle when the driver is off-shift. */
const effectiveShuttleStatus = (shuttle: Shuttle): Shuttle['status'] => {
  const driverStatus =
    typeof shuttle.driverId === 'object' && shuttle.driverId
      ? shuttle.driverId.status
      : undefined;
  // If the driver is not actively on shift, treat the shuttle as idle
  // (mirrors the mobile getDisplayedShuttleStatus() logic in explore.tsx)
  if (driverStatus !== 'driving' && shuttle.status !== 'maintenance') {
    return 'idle';
  }
  return shuttle.status;
};

const SHUTTLE_STATUS_LABEL: Record<Shuttle['status'], string> = {
  idle: 'Idle',
  en_route: 'In Route',
  out_of_bounds: 'Out of Bounds',
  maintenance: 'Maintenance',
};

const shuttleVariant = (status: Shuttle['status']) => {
  if (status === 'en_route') return 'secondary';
  if (status === 'out_of_bounds') return 'destructive';
  if (status === 'maintenance') return 'outline';
  return 'ghost';
};

const driverStatusDot = (status?: string) => {
  if (status === 'driving') return '🟢';
  if (status === 'active') return '🟡';
  return '⚫';
};

export const ShuttlesPage = () => {
  const { user } = useAuth();
  const communityId = communityIdFromUnknown(user?.communityId);

  const [shuttles, setShuttles] = useState<Shuttle[]>([]);
  const [drivers, setDrivers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [assigningId, setAssigningId] = useState('');
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, string>>({});
  const [phaseAssignmentDrafts, setPhaseAssignmentDrafts] = useState<Record<string, string>>({});
  const [phaseGeofences, setPhaseGeofences] = useState<PhaseGeofence[]>([]);
  const [opsBypassMode, setOpsBypassMode] = useState(false);
  const [savingOpsBypass, setSavingOpsBypass] = useState(false);

  // Add shuttle form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newPlateNumber, setNewPlateNumber] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newMaxCapacity, setNewMaxCapacity] = useState('12');
  const [newAssignedPhase, setNewAssignedPhase] = useState('');
  const [creating, setCreating] = useState(false);

  const shuttlesRef = useRef(shuttles);
  useEffect(() => {
    shuttlesRef.current = shuttles;
  }, [shuttles]);

  const loadShuttles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchShuttles({ active: true });
      setShuttles(result);
      setAssignmentDrafts(
        result.reduce<Record<string, string>>((acc, shuttle) => {
          const driverValue =
            typeof shuttle.driverId === 'object' && shuttle.driverId?._id
              ? shuttle.driverId._id
              : typeof shuttle.driverId === 'string'
                ? shuttle.driverId
                : '';
          acc[shuttle._id] = driverValue;
          return acc;
        }, {})
      );

      const [driverRows, phaseRows] = await Promise.all([
        fetchUsers({ role: 'driver', active: true }),
        communityId ? fetchPhaseGeofences(communityId) : Promise.resolve([]),
      ]);
      setDrivers(driverRows);
      const activePhases = phaseRows.filter((item) => item.isActive !== false);
      setPhaseGeofences(activePhases);

      // Initialize phase drafts AFTER phases are loaded so we can match the
      // normalized stored value (e.g. "phase_3b") back to the original geofence
      // name (e.g. "Phase 3b") that the <select> options use as their value.
      const normalizeForMatch = (v: string) =>
        v.trim().toLowerCase().replace(/\s+/g, '_');

      setPhaseAssignmentDrafts(
        result.reduce<Record<string, string>>((acc, shuttle) => {
          const storedNormalized = shuttle.assignedPhase
            ? normalizeForMatch(shuttle.assignedPhase)
            : '';
          const match = activePhases.find(
            (p) => normalizeForMatch(p.name) === storedNormalized
          );
          acc[shuttle._id] = match ? match.name : '';
          return acc;
        }, {})
      );

      if (communityId) {
        const community = await fetchCommunityById(communityId);
        setOpsBypassMode(Boolean(community?.opsBypassMode));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load shuttles');
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  const toggleOpsBypassMode = async () => {
    if (!communityId) return;
    setSavingOpsBypass(true);
    setError('');
    setNotice('');
    try {
      const next = !opsBypassMode;
      await updateCommunity(communityId, { opsBypassMode: next });
      setOpsBypassMode(next);
      setNotice(next
        ? 'Bypass Mode enabled: pickup allowed without on-duty shuttles; drivers can logout without ending shift.'
        : 'Bypass Mode disabled: normal restrictions restored.'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update bypass mode.');
    } finally {
      setSavingOpsBypass(false);
    }
  };

  useEffect(() => {
    void loadShuttles();
  }, [loadShuttles]);

  // Real-time sync via socket
  useEffect(() => {
    if (!communityId) return;

    const socket = connectAdminSocket(communityId);

    const onLocationUpdated = (payload: {
      shuttleId?: string;
      status?: Shuttle['status'];
      currentCapacity?: number;
      maxCapacity?: number;
    }) => {
      if (!payload.shuttleId) return;
      setShuttles((prev) =>
        prev.map((item) =>
          item._id === payload.shuttleId
            ? {
              ...item,
              ...(payload.status ? { status: payload.status } : {}),
              ...(payload.currentCapacity !== undefined ? { currentCapacity: payload.currentCapacity } : {}),
              ...(payload.maxCapacity !== undefined ? { maxCapacity: payload.maxCapacity } : {}),
              updatedAt: new Date().toISOString(),
            }
            : item
        )
      );
    };

    const onCapacityUpdated = (payload: {
      shuttleId?: string;
      currentCapacity?: number;
      maxCapacity?: number;
      capacityStatus?: string;
    }) => {
      if (!payload.shuttleId) return;
      setShuttles((prev) =>
        prev.map((item) =>
          item._id === payload.shuttleId
            ? {
              ...item,
              ...(payload.currentCapacity !== undefined ? { currentCapacity: payload.currentCapacity } : {}),
              ...(payload.maxCapacity !== undefined ? { maxCapacity: payload.maxCapacity } : {}),
              updatedAt: new Date().toISOString(),
            }
            : item
        )
      );
    };

    socket.on('shuttle:location-updated', onLocationUpdated);
    socket.on('shuttle:capacity-updated', onCapacityUpdated);

    return () => {
      socket.off('shuttle:location-updated', onLocationUpdated);
      socket.off('shuttle:capacity-updated', onCapacityUpdated);
      disconnectAdminSocket();
    };
  }, [communityId]);

  const onAssignDriver = async (shuttleId: string) => {
    setAssigningId(shuttleId);
    setError('');
    setNotice('');

    try {
      const draftDriverId = assignmentDrafts[shuttleId] || '';
      const draftPhase = phaseAssignmentDrafts[shuttleId] || '';
      const updated = await assignShuttleDriver(shuttleId, draftDriverId || null, draftPhase || null);
      setShuttles((prev) => prev.map((row) => (row._id === updated._id ? updated : row)));
      setAssignmentDrafts((prev) => ({ ...prev, [shuttleId]: draftDriverId }));
      setPhaseAssignmentDrafts((prev) => ({ ...prev, [shuttleId]: draftPhase }));
      setNotice('Shuttle assignment updated successfully.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to assign driver');
    } finally {
      setAssigningId('');
    }
  };

  const handleCreateShuttle = async () => {
    const plate = newPlateNumber.trim().toUpperCase();
    const capacity = Number(newMaxCapacity);

    if (!plate) {
      setError('Plate number is required.');
      return;
    }

    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 5) {
      setError('Max capacity must be an integer between 1 and 5.');
      return;
    }

    setCreating(true);
    setError('');
    setNotice('');

    try {
      const created = await createShuttle({
        plateNumber: plate,
        maxCapacity: capacity,
        label: newLabel.trim() || undefined,
        assignedPhase: newAssignedPhase || undefined,
      });

      setShuttles((prev) => [created, ...prev]);
      setNewPlateNumber('');
      setNewLabel('');
      setNewMaxCapacity('12');
      setNewAssignedPhase('');
      setShowAddForm(false);
      setNotice(`Shuttle "${created.label || created.plateNumber}" created.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create shuttle');
    } finally {
      setCreating(false);
    }
  };

  const getAssignedDriverId = (shuttle: Shuttle) => {
    if (typeof shuttle.driverId === 'object' && shuttle.driverId?._id) return shuttle.driverId._id;
    if (typeof shuttle.driverId === 'string') return shuttle.driverId;
    return '';
  };

  const getAssignedDriverName = (shuttle: Shuttle) => {
    if (typeof shuttle.driverId === 'object' && shuttle.driverId) {
      const name = `${shuttle.driverId.firstName || ''} ${shuttle.driverId.lastName || ''}`.trim();
      const status = shuttle.driverId.status || 'offline';
      return name ? `${driverStatusDot(status)} ${name}` : 'Unassigned';
    }
    return 'Unassigned';
  };
  const getAssignedPhase = (shuttle: Shuttle) => shuttle.assignedPhase || '';
  const formatPhaseLabel = (phase?: string | null) => {
    if (!phase) return 'All phases';
    const cleaned = phase.replace(/_/g, ' ').trim();
    const lower = cleaned.toLowerCase();
    if (lower.startsWith('phase ')) {
      return 'Phase ' + cleaned.slice(6);
    }
    return 'Phase ' + cleaned;
  };

  const statusTotals = {
    idle: shuttles.filter((item) => effectiveShuttleStatus(item) === 'idle').length,
    enRoute: shuttles.filter((item) => effectiveShuttleStatus(item) === 'en_route').length,
    outOfBounds: shuttles.filter((item) => effectiveShuttleStatus(item) === 'out_of_bounds').length,
    maintenance: shuttles.filter((item) => effectiveShuttleStatus(item) === 'maintenance').length,
    assigned: shuttles.filter((item) => getAssignedDriverId(item)).length,
  };

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="text-slate-900">Shuttle Management</CardTitle>
          <p className="text-sm text-muted-foreground">
            Create shuttles, assign drivers, and monitor fleet status in real time.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <Button
            size="sm"
            variant={showAddForm ? 'default' : 'outline'}
            onClick={() => {
              setShowAddForm((prev) => !prev);
              setError('');
            }}
          >
            {showAddForm ? 'Cancel' : '+ Add Shuttle'}
          </Button>
          <Button
            size="sm"
            variant={opsBypassMode ? 'default' : 'secondary'}
            onClick={() => void toggleOpsBypassMode()}
            disabled={savingOpsBypass}
          >
            {savingOpsBypass
              ? 'Saving...'
              : opsBypassMode
                ? 'Bypass Mode: ON'
                : 'Bypass Mode: OFF'}
          </Button>
          <Button className="shrink-0" variant="outline" size="sm" onClick={() => void loadShuttles()} disabled={loading}>
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}

        {/* Add shuttle form */}
        {showAddForm ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
            <p className="text-sm font-medium text-slate-900">New Shuttle</p>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <Label htmlFor="plateNumber" className="text-xs text-slate-600">Plate Number *</Label>
                <Input
                  id="plateNumber"
                  value={newPlateNumber}
                  onChange={(e) => setNewPlateNumber(e.target.value)}
                  placeholder="e.g. ABC 1234"
                  className="mt-1 h-8 uppercase"
                  maxLength={15}
                />
              </div>
              <div>
                <Label htmlFor="shuttleLabel" className="text-xs text-slate-600">Electric No.</Label>
                <Input
                  id="shuttleLabel"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. 23"
                  className="mt-1 h-8"
                />
              </div>
              <div>
                <Label htmlFor="maxCapacity" className="text-xs text-slate-600">Max Capacity *</Label>
                <Input
                  id="maxCapacity"
                  type="number"
                  min="1"
                  max="5"
                  value={newMaxCapacity}
                  onChange={(e) => setNewMaxCapacity(e.target.value)}
                  className="mt-1 h-8"
                />
              </div>
              <div>
                <Label htmlFor="assignedPhase" className="text-xs text-slate-600">Phase No.</Label>
                <select
                  id="assignedPhase"
                  className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
                  value={newAssignedPhase}
                  onChange={(e) => setNewAssignedPhase(e.target.value)}
                >
                  <option value="">All phases</option>
                  {phaseGeofences.map((phase) => (
                    <option key={phase._id} value={phase.name}>
                      {formatPhaseLabel(phase.name)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => void handleCreateShuttle()} disabled={creating}>
                {creating ? 'Creating...' : 'Create Shuttle'}
              </Button>
            </div>
          </div>
        ) : null}

        {/* Status summary */}
        <div className="sticky top-0 z-10 -mx-1 rounded-lg bg-white/95 px-1 py-1 backdrop-blur-sm">
          <div className="grid gap-2 sm:grid-cols-5">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              Assigned: {statusTotals.assigned}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              Idle: {statusTotals.idle}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              En Route: {statusTotals.enRoute}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              Out of Bounds: {statusTotals.outOfBounds}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              Maintenance: {statusTotals.maintenance}
            </div>
          </div>
        </div>

        {/* Shuttle table */}
        <div className="max-h-[460px] overflow-auto rounded-lg border border-slate-200">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-white">
            <TableRow>
              <TableHead>Electric No.</TableHead>
              <TableHead>Current Driver</TableHead>
              <TableHead>Assign Driver</TableHead>
              <TableHead>Phase No.</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Phase No.</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Capacity</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
            </TableHeader>
            <TableBody>
            {shuttles.map((shuttle) => (
              <TableRow key={shuttle._id}>
                <TableCell>
                  <div className="space-y-0.5">
                    <p className="font-medium text-slate-900">
                      {shuttle.label ? `Electric ${shuttle.label}` : 'Unlabeled Shuttle'}
                    </p>
                    <p className="font-mono text-xs text-slate-500">{shuttle.plateNumber}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm">{getAssignedDriverName(shuttle)}</span>
                </TableCell>
                <TableCell>
                  <select
                    disabled={assigningId === shuttle._id}
                    className="h-8 w-full min-w-44 rounded-lg border border-input bg-background px-2 text-sm"
                    value={assignmentDrafts[shuttle._id] ?? getAssignedDriverId(shuttle)}
                    onChange={(event) => {
                      const value = event.target.value;
                      setAssignmentDrafts((prev) => ({ ...prev, [shuttle._id]: value }));
                    }}
                  >
                    <option value="">Unassigned</option>
                    {drivers.map((driver) => (
                      <option key={driver._id} value={driver._id}>
                        {driverStatusDot(driver.status)} {driver.firstName} {driver.lastName}
                        {driver.status === 'driving' ? ' (on shift)' : ''}
                      </option>
                    ))}
                  </select>
                </TableCell>
                <TableCell>
                  <select
                    disabled={assigningId === shuttle._id}
                    className="h-8 w-full min-w-36 rounded-lg border border-input bg-background px-2 text-sm"
                    value={phaseAssignmentDrafts[shuttle._id] ?? getAssignedPhase(shuttle)}
                    onChange={(event) => {
                      const value = event.target.value;
                      setPhaseAssignmentDrafts((prev) => ({ ...prev, [shuttle._id]: value }));
                    }}
                  >
                    <option value="">All phases</option>
                    {phaseGeofences.map((phase) => (
                      <option key={phase._id} value={phase.name}>
                        {formatPhaseLabel(phase.name)}
                      </option>
                    ))}
                  </select>
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      assigningId === shuttle._id ||
                      (
                        (assignmentDrafts[shuttle._id] ?? getAssignedDriverId(shuttle)) === getAssignedDriverId(shuttle) &&
                        (phaseAssignmentDrafts[shuttle._id] ?? getAssignedPhase(shuttle)) === getAssignedPhase(shuttle)
                      )
                    }
                    onClick={() => void onAssignDriver(shuttle._id)}
                  >
                    {assigningId === shuttle._id ? 'Assigning...' : 'Apply'}
                  </Button>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{formatPhaseLabel(shuttle.assignedPhase)}</Badge>
                </TableCell>
                <TableCell>
                  {(() => {
                    const display = effectiveShuttleStatus(shuttle);
                    return (
                      <Badge variant={shuttleVariant(display)}>
                        {SHUTTLE_STATUS_LABEL[display] ?? display}
                      </Badge>
                    );
                  })()}
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <p className="text-xs text-slate-700">
                      {shuttle.currentCapacity}/{shuttle.maxCapacity}
                    </p>
                    <div className="h-1.5 rounded bg-slate-200">
                      <div
                        className="h-1.5 rounded transition-all duration-500"
                        style={{
                          width: `${Math.min(100, Math.round((shuttle.currentCapacity / Math.max(1, shuttle.maxCapacity)) * 100))}%`,
                          backgroundColor:
                            shuttle.currentCapacity >= shuttle.maxCapacity
                              ? '#ef4444'
                              : shuttle.currentCapacity / Math.max(1, shuttle.maxCapacity) >= 0.7
                                ? '#f59e0b'
                                : '#10b981',
                        }}
                      />
                    </div>
                  </div>
                </TableCell>
                <TableCell>{shuttle.updatedAt ? toShortDate(shuttle.updatedAt) : '-'}</TableCell>
              </TableRow>
            ))}
            {!loading && shuttles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  No shuttles found. Add one above.
                </TableCell>
              </TableRow>
            ) : null}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
