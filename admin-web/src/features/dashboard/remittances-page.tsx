import { useCallback, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { fetchRemittances, verifyRemittance } from '@/lib/admin-api';
import { currency } from '@/lib/format';
import type { Remittance } from '@/types/domain';

type StatusFilter = 'all' | 'pending' | 'verified' | 'flagged';

const toInputDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-PH', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

const getDriverName = (driverId: Remittance['driverId']) => {
  if (typeof driverId === 'object' && driverId !== null) {
    return `${driverId.firstName || ''} ${driverId.lastName || ''}`.trim() || 'Unknown';
  }
  return 'Unknown';
};

const getDriverEmail = (driverId: Remittance['driverId']) => {
  if (typeof driverId === 'object' && driverId !== null) {
    return driverId.email || '';
  }
  return '';
};

const getShuttleLabel = (shuttleId: Remittance['shuttleId']) => {
  if (typeof shuttleId === 'object' && shuttleId !== null) {
    const parts = [shuttleId.plateNumber, shuttleId.label].filter(Boolean);
    return parts.join(' - ') || '—';
  }
  return '—';
};

const getShiftTime = (tripId: Remittance['tripId']) => {
  if (typeof tripId === 'object' && tripId !== null) {
    const start = tripId.shiftStart ? formatDate(tripId.shiftStart) : '';
    const end = tripId.shiftEnd ? formatDate(tripId.shiftEnd) : '';
    if (start && end) return `${start} → ${end}`;
    if (start) return start;
    return '—';
  }
  return '—';
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  verified: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  flagged: 'bg-rose-50 text-rose-800 border-rose-200',
};

export const RemittancesPage = () => {
  const [remittances, setRemittances] = useState<Remittance[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [startDate, setStartDate] = useState(toInputDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
  const [endDate, setEndDate] = useState(toInputDate(new Date()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});
  const [lastLoaded, setLastLoaded] = useState('');

  const loadIdRef = useRef(0);

  const loadData = useCallback(async () => {
    const id = ++loadIdRef.current;
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string | number> = {
        startDate: `${startDate}T00:00:00`,
        endDate: `${endDate}T23:59:59`,
        limit: 100,
      };
      if (statusFilter !== 'all') {
        params.status = statusFilter;
      }

      const data = await fetchRemittances(params as never);
      if (id !== loadIdRef.current) return;

      setRemittances(data);
      setLastLoaded(`${statusFilter === 'all' ? 'All' : statusFilter} · ${startDate} → ${endDate}`);
    } catch (e) {
      if (id !== loadIdRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load remittances.');
    } finally {
      if (id === loadIdRef.current) setLoading(false);
    }
  }, [startDate, endDate, statusFilter]);

  const handleVerify = async (remittance: Remittance, newStatus: 'verified' | 'flagged') => {
    setActionLoading(remittance._id);
    try {
      const updated = await verifyRemittance(remittance._id, {
        status: newStatus,
        adminNote: adminNotes[remittance._id] || '',
      });
      setRemittances((prev) =>
        prev.map((r) => (r._id === updated._id ? updated : r))
      );
      setAdminNotes((prev) => {
        const next = { ...prev };
        delete next[remittance._id];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setActionLoading(null);
    }
  };

  const summary = useMemo(() => {
    const pending = remittances.filter((r) => r.status === 'pending').length;
    const verified = remittances.filter((r) => r.status === 'verified').length;
    const flagged = remittances.filter((r) => r.status === 'flagged').length;
    const totalExpected = remittances.reduce((s, r) => s + r.expectedAmount, 0);
    const totalActual = remittances.reduce((s, r) => s + r.actualAmount, 0);
    const totalVariance = remittances.reduce((s, r) => s + r.varianceAmount, 0);
    return { pending, verified, flagged, totalExpected, totalActual, totalVariance };
  }, [remittances]);

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-slate-900">Remittance Review</CardTitle>
            <p className="text-sm text-slate-600">
              {lastLoaded
                ? `Showing: ${lastLoaded} · ${remittances.length} records`
                : 'Set filters and click Load to review remittances'}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-600">Status</p>
                <div className="flex gap-1">
                  {(['pending', 'flagged', 'verified', 'all'] as StatusFilter[]).map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={statusFilter === s ? 'default' : 'outline'}
                      onClick={() => setStatusFilter(s)}
                    >
                      {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-600">Date Range</p>
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                  <span className="text-xs text-slate-400">→</span>
                  <input
                    type="date"
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>

              <Button onClick={() => void loadData()} disabled={loading}>
                {loading ? 'Loading...' : 'Load'}
              </Button>
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {/* Summary tiles */}
          {remittances.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                <p className="text-xs text-amber-700">Pending</p>
                <p className="text-lg font-semibold text-amber-900">{summary.pending}</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                <p className="text-xs text-emerald-700">Verified</p>
                <p className="text-lg font-semibold text-emerald-900">{summary.verified}</p>
              </div>
              <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-3">
                <p className="text-xs text-rose-700">Flagged</p>
                <p className="text-lg font-semibold text-rose-900">{summary.flagged}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Total Expected</p>
                <p className="text-lg font-semibold text-slate-900">{currency(summary.totalExpected)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Total Remitted</p>
                <p className="text-lg font-semibold text-slate-900">{currency(summary.totalActual)}</p>
              </div>
              <div className={`rounded-lg border p-3 ${summary.totalVariance < 0 ? 'border-rose-200 bg-rose-50/50' : 'border-emerald-200 bg-emerald-50/50'}`}>
                <p className={`text-xs ${summary.totalVariance < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>Total Variance</p>
                <p className={`text-lg font-semibold ${summary.totalVariance < 0 ? 'text-rose-900' : 'text-emerald-900'}`}>
                  {summary.totalVariance >= 0 ? '+' : ''}{currency(summary.totalVariance)}
                </p>
              </div>
            </div>
          )}

          {/* Table */}
          <div className="max-h-[600px] overflow-auto rounded-md border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Driver</TableHead>
                  <TableHead>Shuttle</TableHead>
                  <TableHead>Shift</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Remitted</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Driver Note</TableHead>
                  <TableHead>Admin Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {remittances.map((r) => {
                  const isActionTarget = actionLoading === r._id;
                  return (
                    <TableRow key={r._id}>
                      <TableCell>
                        <p className="font-medium text-slate-900">{getDriverName(r.driverId)}</p>
                        <p className="text-xs text-muted-foreground">{getDriverEmail(r.driverId)}</p>
                      </TableCell>
                      <TableCell className="text-sm">{getShuttleLabel(r.shuttleId)}</TableCell>
                      <TableCell className="text-xs text-slate-600">{getShiftTime(r.tripId)}</TableCell>
                      <TableCell className="text-right font-medium">{currency(r.expectedAmount)}</TableCell>
                      <TableCell className="text-right font-medium">{currency(r.actualAmount)}</TableCell>
                      <TableCell className={`text-right font-semibold ${r.varianceAmount < 0 ? 'text-rose-700' : r.varianceAmount > 0 ? 'text-emerald-700' : 'text-slate-600'}`}>
                        {r.varianceAmount >= 0 ? '+' : ''}{currency(r.varianceAmount)}
                      </TableCell>
                      <TableCell>
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status] || ''}`}>
                          {r.status}
                        </span>
                      </TableCell>
                      <TableCell>
                        <p className="max-w-[150px] truncate text-xs text-slate-600" title={r.driverNote}>
                          {r.driverNote || '—'}
                        </p>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1.5 min-w-[200px]">
                          <input
                            type="text"
                            className="h-7 rounded border border-input bg-background px-2 text-xs"
                            placeholder="Admin note..."
                            value={adminNotes[r._id] || ''}
                            onChange={(e) =>
                              setAdminNotes((prev) => ({ ...prev, [r._id]: e.target.value }))
                            }
                            disabled={isActionTarget}
                          />
                          <div className="flex gap-1">
                            {r.status !== 'verified' && (
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 bg-emerald-600 hover:bg-emerald-700 text-xs"
                                onClick={() => void handleVerify(r, 'verified')}
                                disabled={isActionTarget}
                              >
                                {isActionTarget ? '...' : '✓ Verify'}
                              </Button>
                            )}
                            {r.status !== 'flagged' && (
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 text-xs"
                                onClick={() => void handleVerify(r, 'flagged')}
                                disabled={isActionTarget}
                              >
                                {isActionTarget ? '...' : '⚠ Flag'}
                              </Button>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!loading && remittances.length === 0 && lastLoaded ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      No remittance records found for the selected filters.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
