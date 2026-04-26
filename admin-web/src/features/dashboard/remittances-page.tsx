import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
import { fetchRemittances, fetchRemittanceSummary, verifyRemittance } from '@/lib/admin-api';
import { currency } from '@/lib/format';
import type { Remittance, RideRequestBreakdown, RideRequestBreakdownByDriverRow } from '@/types/domain';

type StatusFilter = 'all' | 'not_submitted' | 'pending' | 'verified' | 'flagged' | 'overdue' | 'escalated';

const RANGE_OPTIONS = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '12m': 365,
} as const;

type RangeKey = keyof typeof RANGE_OPTIONS;

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
  not_submitted: 'bg-slate-100 text-slate-800 border-slate-300',
  overdue: 'bg-orange-50 text-orange-800 border-orange-200',
  escalated: 'bg-red-100 text-red-900 border-red-300 font-bold',
};

const receiptHref = (receiptUrl?: string) => {
  if (!receiptUrl) return '';
  if (receiptUrl.startsWith('http://') || receiptUrl.startsWith('https://')) return receiptUrl;
  const base = (import.meta as any).env?.VITE_API_URL
    ? String((import.meta as any).env.VITE_API_URL).replace(/\/api\/?$/, '')
    : '';
  return base ? `${base}${receiptUrl}` : receiptUrl;
};

export const RemittancesPage = () => {
  const [remittances, setRemittances] = useState<Remittance[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [rangeKey, setRangeKey] = useState<RangeKey>('7d');
  const [startDate, setStartDate] = useState(toInputDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
  const [endDate, setEndDate] = useState(toInputDate(new Date()));
  const [useCustomRange, setUseCustomRange] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});
  const [lastLoaded, setLastLoaded] = useState('');
  const [rideRequestBreakdown, setRideRequestBreakdown] = useState<RideRequestBreakdown | null>(null);
  const [rideRequestByDriver, setRideRequestByDriver] = useState<RideRequestBreakdownByDriverRow[]>([]);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState('');

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

      // Fetch ride request accountability breakdown in parallel
      try {
        const summaryData = await fetchRemittanceSummary({
          startDate: `${startDate}T00:00:00`,
          endDate: `${endDate}T23:59:59`,
        });
        if (id === loadIdRef.current) {
          setRideRequestBreakdown(summaryData.rideRequestBreakdown || null);
          setRideRequestByDriver(summaryData.rideRequestBreakdownByDriver || []);
        }
      } catch {
        // Non-critical: breakdown is supplementary data
        if (id === loadIdRef.current) {
          setRideRequestBreakdown(null);
          setRideRequestByDriver([]);
        }
      }

      setLastLoaded(`${statusFilter === 'all' ? 'All' : statusFilter} · ${startDate} → ${endDate}`);
    } catch (e) {
      if (id !== loadIdRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load remittances.');
    } finally {
      if (id === loadIdRef.current) setLoading(false);
    }
  }, [startDate, endDate, statusFilter]);

  useEffect(() => {
    if (useCustomRange) return;
    const days = RANGE_OPTIONS[rangeKey];
    const now = new Date();
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    setStartDate(toInputDate(start));
    setEndDate(toInputDate(now));
  }, [rangeKey, useCustomRange]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadData();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [loadData]);

  const handleVerify = async (remittance: Remittance, newStatus: 'verified' | 'flagged') => {
    if (remittance.status === 'escalated' && !adminNotes[remittance._id]?.trim()) {
      setError('An admin note is strictly required to resolve an escalated remittance.');
      return;
    }
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
                : 'Select filters to review remittances'}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              {/* Quick range */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-600">Quick Range</p>
                <div className="flex gap-1">
                  {(Object.keys(RANGE_OPTIONS) as RangeKey[]).map((key) => (
                    <Button
                      key={key}
                      size="sm"
                      variant={!useCustomRange && rangeKey === key ? 'default' : 'outline'}
                      onClick={() => {
                        setRangeKey(key);
                        setUseCustomRange(false);
                      }}
                    >
                      {key}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-600">Status</p>
                <div className="flex gap-1">
                  {(['pending', 'flagged', 'verified', 'overdue', 'escalated', 'not_submitted', 'all'] as StatusFilter[]).map((s) => (
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
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      setUseCustomRange(true);
                    }}
                  />
                  <span className="text-xs text-slate-400">→</span>
                  <input
                    type="date"
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      setUseCustomRange(true);
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {/* Ride Request Accountability */}
          {rideRequestBreakdown && rideRequestBreakdown.totalRequests > 0 && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-indigo-900">Ride Request Accountability</h3>
                {rideRequestBreakdown.totalIgnored > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800">
                    ⚠ {rideRequestBreakdown.totalIgnored} Ignored — Requires Review
                  </span>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <p className="text-xs text-slate-500">Total Requests</p>
                  <p className="text-lg font-semibold text-slate-900">{rideRequestBreakdown.totalRequests}</p>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-2.5">
                  <p className="text-xs text-emerald-700">Boarded</p>
                  <p className="text-lg font-semibold text-emerald-900">{rideRequestBreakdown.totalBoarded + rideRequestBreakdown.totalCompleted}</p>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-2.5">
                  <p className="text-xs text-amber-700">Cancelled (No Show)</p>
                  <p className="text-lg font-semibold text-amber-900">{rideRequestBreakdown.totalCancelled}</p>
                </div>
                <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-2.5">
                  <p className="text-xs text-sky-700">Late Manual Boards</p>
                  <p className="text-lg font-semibold text-sky-900">{rideRequestBreakdown.totalLateManual}</p>
                </div>
                <div className={`rounded-lg border p-2.5 ${
                  rideRequestBreakdown.totalIgnored > 0
                    ? 'border-rose-300 bg-rose-50'
                    : 'border-slate-200 bg-white'
                }`}>
                  <p className={`text-xs ${rideRequestBreakdown.totalIgnored > 0 ? 'text-rose-700 font-semibold' : 'text-slate-500'}`}>Ignored</p>
                  <p className={`text-lg font-semibold ${rideRequestBreakdown.totalIgnored > 0 ? 'text-rose-900' : 'text-slate-900'}`}>
                    {rideRequestBreakdown.totalIgnored}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                  <p className="text-xs text-slate-500">Still Pending</p>
                  <p className="text-lg font-semibold text-slate-900">{rideRequestBreakdown.totalPending}</p>
                </div>
              </div>
              {rideRequestBreakdown.totalIgnored > 0 && (
                <p className="text-xs text-rose-700 font-medium">
                  Ignored ride requests indicate passengers who submitted requests but were never boarded or resolved.
                  This may indicate unaccounted cash collection. Verify remittances flagged in this period.
                </p>
              )}

              {rideRequestByDriver.length > 0 && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-900">By driver</p>
                    <p className="text-xs text-slate-500">{rideRequestByDriver.length} drivers</p>
                  </div>
                  <div className="mt-2 overflow-auto rounded-md border border-slate-200">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Driver</TableHead>
                          <TableHead className="text-right">Ignored</TableHead>
                          <TableHead className="text-right">Late manual</TableHead>
                          <TableHead className="text-right">Pending</TableHead>
                          <TableHead className="text-right">Cancelled</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rideRequestByDriver.map((row) => (
                          <TableRow key={row.driverId}>
                            <TableCell>
                              <p className="text-sm font-medium text-slate-900">{row.firstName} {row.lastName}</p>
                              <p className="text-xs text-muted-foreground">{row.email}</p>
                            </TableCell>
                            <TableCell className={`text-right font-semibold ${row.totalIgnored > 0 ? 'text-rose-700' : 'text-slate-700'}`}>
                              {row.totalIgnored}
                            </TableCell>
                            <TableCell className="text-right">{row.totalLateManual}</TableCell>
                            <TableCell className="text-right">{row.totalPending}</TableCell>
                            <TableCell className="text-right">{row.totalCancelled}</TableCell>
                            <TableCell className="text-right">{row.totalRequests}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          )}

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
                  <TableHead>Receipt</TableHead>
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
                  const receipt = receiptHref(r.receiptUrl);
                  return (
                    <TableRow key={r._id}>
                      <TableCell>
                        <p className="font-medium text-slate-900">{getDriverName(r.driverId)}</p>
                        <p className="text-xs text-muted-foreground">{getDriverEmail(r.driverId)}</p>
                      </TableCell>
                      <TableCell className="text-sm">{getShuttleLabel(r.shuttleId)}</TableCell>
                      <TableCell className="text-xs text-slate-600">{getShiftTime(r.tripId)}</TableCell>
                      <TableCell className="text-xs">
                        {receipt ? (
                          <button
                            type="button"
                            onClick={() => setReceiptPreviewUrl(receipt)}
                            className="text-emerald-700 hover:underline"
                          >
                            View
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>
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
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                      No remittance records found for the selected filters.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {receiptPreviewUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setReceiptPreviewUrl('')}
          role="presentation"
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-xl bg-white p-2 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Receipt preview"
          >
            <button
              type="button"
              onClick={() => setReceiptPreviewUrl('')}
              className="absolute right-2 top-2 rounded bg-black/60 px-2 py-1 text-xs font-semibold text-white hover:bg-black/80"
            >
              Close
            </button>
            <img
              src={receiptPreviewUrl}
              alt="Remittance receipt"
              className="max-h-[86vh] max-w-[86vw] rounded object-contain"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
};
