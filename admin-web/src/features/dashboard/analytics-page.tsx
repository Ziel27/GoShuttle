import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    Bar,
    BarChart,
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

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
import { fetchAnalytics, fetchDriverPerformance, fetchRemittanceSummary } from '@/lib/admin-api';
import { currency } from '@/lib/format';
import type { DriverPerformanceRow, RemittanceSummaryResponse } from '@/types/domain';

const RANGE_OPTIONS = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '12m': 365,
} as const;

type RangeKey = keyof typeof RANGE_OPTIONS;
type RemittanceGroupBy = 'day' | 'week' | 'month';

const makeDateLabel = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day).toLocaleDateString('en-PH', {
    month: 'short',
    day: '2-digit',
  });

const makeMonthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;

const makeMonthLabel = (monthKey: string) => {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-PH', {
    month: 'short',
    year: 'numeric',
  });
};

const toNumeric = (value: unknown) => (typeof value === 'number' ? value : Number(value) || 0);

const toInputDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const percent = (value: number) => `${value.toFixed(1)}%`;

type SortKey =
  | 'driverName'
  | 'shifts'
  | 'passengers'
  | 'expected'
  | 'remitted'
  | 'variance'
  | 'onTimeRate'
  | 'flagRate'
  | 'ignoredRequests'
  | 'lateManualBoards';

const varianceClassName = (variance: number, varianceRate: number) => {
  if (Math.abs(variance) < 0.01) return 'text-emerald-700';
  if (varianceRate > -10) return 'text-amber-700';
  return 'text-rose-700';
};

const flagRateClassName = (flagRate: number) => {
  if (flagRate <= 0) return 'text-emerald-700';
  if (flagRate <= 20) return 'text-amber-700';
  return 'text-rose-700';
};

const ignoredClassName = (count: number) => {
  if (count <= 0) return 'text-emerald-700';
  if (count <= 2) return 'text-amber-700';
  return 'text-rose-700';
};

const sortIndicator = (active: boolean, direction: 'asc' | 'desc') => {
  if (!active) return '↕';
  return direction === 'asc' ? '↑' : '↓';
};

export const AnalyticsPage = () => {
  const [dailySeries, setDailySeries] = useState<
    Array<{ date: string; revenue: number; passengers: number; trips: number; monthKey: string }>
  >([]);
  const [rangeKey, setRangeKey] = useState<RangeKey>('30d');
  const [customStartDate, setCustomStartDate] = useState(toInputDate(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)));
  const [customEndDate, setCustomEndDate] = useState(toInputDate(new Date()));
  const [useCustomRange, setUseCustomRange] = useState(false);
  const [remittanceGroupBy, setRemittanceGroupBy] = useState<RemittanceGroupBy>('day');
  const [remittanceSummary, setRemittanceSummary] = useState<RemittanceSummaryResponse | null>(null);
  const [driverPerformanceRows, setDriverPerformanceRows] = useState<DriverPerformanceRow[]>([]);
  const [driversNeedingAttention, setDriversNeedingAttention] = useState(0);
  const [driverSortKey, setDriverSortKey] = useState<SortKey>('variance');
  const [driverSortDirection, setDriverSortDirection] = useState<'asc' | 'desc'>('asc');
  const [expandedDriverIds, setExpandedDriverIds] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastLoadedLabel, setLastLoadedLabel] = useState('');

  // Guard against concurrent requests
  const loadIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    const id = ++loadIdRef.current;

    setLoading(true);
    setError('');
    try {
      const now = new Date();
      let startDate: Date;
      let endDate: Date;

      if (useCustomRange) {
        if (!customStartDate || !customEndDate) {
          throw new Error('Please set both start and end dates.');
        }

        startDate = new Date(`${customStartDate}T00:00:00`);
        endDate = new Date(`${customEndDate}T23:59:59`);

        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
          throw new Error('Invalid date range.');
        }

        if (startDate > endDate) {
          throw new Error('Start date cannot be later than end date.');
        }
      } else {
        const rangeDays = RANGE_OPTIONS[rangeKey];
        startDate = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000);
        endDate = now;
      }

      const [analyticsData, remittanceData, performanceData] = await Promise.all([
        fetchAnalytics({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        }),
        fetchRemittanceSummary({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          groupBy: remittanceGroupBy,
        }),
        fetchDriverPerformance({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        }),
      ]);

      // Stale guard — ignore if a newer request was started
      if (id !== loadIdRef.current) return;

      setDailySeries(
        (analyticsData.series || []).map((item) => ({
          date: makeDateLabel(item._id.year, item._id.month, item._id.day),
          revenue: item.totalRevenue,
          passengers: item.totalPassengers,
          trips: item.tripCount,
          monthKey: makeMonthKey(item._id.year, item._id.month),
        }))
      );
      setRemittanceSummary(remittanceData);
      setDriverPerformanceRows(performanceData.drivers || []);
      setDriversNeedingAttention(performanceData.driversNeedingAttention || 0);
      setExpandedDriverIds((prev) => {
        const next: Record<string, boolean> = {};
        for (const driver of performanceData.drivers || []) {
          if (prev[driver.driverId]) {
            next[driver.driverId] = true;
          }
        }
        return next;
      });

      const label = useCustomRange
        ? `${customStartDate} → ${customEndDate}`
        : rangeKey;
      setLastLoadedLabel(label);
    } catch (e) {
      if (id !== loadIdRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally {
      if (id === loadIdRef.current) {
        setLoading(false);
      }
    }
  }, [rangeKey, useCustomRange, customStartDate, customEndDate, remittanceGroupBy]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void fetchData();
    }, 250);
    return () => window.clearTimeout(handle);
  }, [fetchData]);

  const totals = useMemo(() => {
    const totalRevenue = dailySeries.reduce((acc, item) => acc + item.revenue, 0);
    const totalPassengers = dailySeries.reduce((acc, item) => acc + item.passengers, 0);
    const tripCount = dailySeries.reduce((acc, item) => acc + item.trips, 0);

    return {
      trips: tripCount,
      passengers: totalPassengers,
      revenue: totalRevenue,
      avgPerTrip: tripCount > 0 ? totalPassengers / tripCount : 0,
      avgRevenuePerTrip: tripCount > 0 ? totalRevenue / tripCount : 0,
    };
  }, [dailySeries]);

  const monthlySeries = useMemo(() => {
    const grouped = dailySeries.reduce<Record<string, { revenue: number; passengers: number; trips: number }>>((acc, row) => {
      if (!acc[row.monthKey]) {
        acc[row.monthKey] = { revenue: 0, passengers: 0, trips: 0 };
      }

      acc[row.monthKey].revenue += row.revenue;
      acc[row.monthKey].passengers += row.passengers;
      acc[row.monthKey].trips += row.trips;
      return acc;
    }, {});

    return Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monthKey, values]) => ({
        month: makeMonthLabel(monthKey),
        revenue: values.revenue,
        passengers: values.passengers,
        trips: values.trips,
      }));
  }, [dailySeries]);

  const remittanceVariancePct = useMemo(() => {
    const expected = remittanceSummary?.totals.expectedAmount || 0;
    const variance = remittanceSummary?.totals.varianceAmount || 0;
    if (!expected) return 0;
    return (variance / expected) * 100;
  }, [remittanceSummary?.totals.expectedAmount, remittanceSummary?.totals.varianceAmount]);

  const exportCsv = () => {
    const summaryHeader = ['Date', 'Revenue', 'Passengers', 'Trips'];
    const summaryRows = dailySeries.map((row) => [row.date, String(row.revenue), String(row.passengers), String(row.trips)]);

    const driverHeader = [
      'Driver Name',
      'Shifts',
      'Passengers',
      'Expected',
      'Remitted',
      'Variance',
      'On-Time Rate',
      'Flag Rate',
      'Ignored Requests',
      'Late Manual Boards',
    ];
    const driverRows = driverPerformanceRows.map((row) => [
      row.driverName,
      String(row.totalShifts),
      String(row.totalPassengersBoarded),
      String(row.totalExpectedRemittance),
      String(row.totalActualRemittance),
      String(row.totalVariance),
      String(row.onTimeSubmissionRate),
      String(row.flagRate),
      String(row.totalIgnoredRequests),
      String(row.totalLateManualBoarded),
    ]);

    const shiftHeader = [
      'Driver Name',
      'Shift Date',
      'Passengers',
      'Expected',
      'Remitted',
      'Variance',
      'Status',
      'Submitted On Time',
      'Ignored Requests',
      'Late Manual Boards',
    ];
    const shiftRows = driverPerformanceRows.flatMap((driver) =>
      (driver.shifts || []).map((shift) => [
        driver.driverName,
        shift.shiftDate,
        String(shift.passengers),
        String(shift.expectedRemittance),
        String(shift.actualRemittance),
        String(shift.variance),
        shift.remittanceStatus,
        shift.submittedOnTime ? 'Yes' : 'No',
        String(shift.ignoredRequests),
        String(shift.lateManualBoards),
      ])
    );

    const sections = [
      ['SUMMARY'],
      summaryHeader,
      ...summaryRows,
      [],
      ['DRIVER PERFORMANCE'],
      driverHeader,
      ...driverRows,
      [],
      ['SHIFT DETAIL'],
      shiftHeader,
      ...shiftRows,
    ];

    const lines = sections.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','));

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const startLabel = useCustomRange ? customStartDate : toInputDate(new Date(Date.now() - RANGE_OPTIONS[rangeKey] * 24 * 60 * 60 * 1000));
    const endLabel = useCustomRange ? customEndDate : toInputDate(new Date());
    link.download = `goshuttle_analytics_${startLabel}_${endLabel}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const sortedDriverRows = useMemo(() => {
    const rows = [...driverPerformanceRows];
    const factor = driverSortDirection === 'asc' ? 1 : -1;
    const getValue = (row: DriverPerformanceRow) => {
      if (driverSortKey === 'driverName') return row.driverName.toLowerCase();
      if (driverSortKey === 'shifts') return row.totalShifts;
      if (driverSortKey === 'passengers') return row.totalPassengersBoarded;
      if (driverSortKey === 'expected') return row.totalExpectedRemittance;
      if (driverSortKey === 'remitted') return row.totalActualRemittance;
      if (driverSortKey === 'variance') return row.totalVariance;
      if (driverSortKey === 'onTimeRate') return row.onTimeSubmissionRate;
      if (driverSortKey === 'flagRate') return row.flagRate;
      if (driverSortKey === 'ignoredRequests') return row.totalIgnoredRequests;
      return row.totalLateManualBoarded;
    };

    rows.sort((a, b) => {
      const va = getValue(a);
      const vb = getValue(b);
      if (typeof va === 'string' && typeof vb === 'string') {
        return va.localeCompare(vb) * factor;
      }
      return ((Number(va) || 0) - (Number(vb) || 0)) * factor;
    });
    return rows;
  }, [driverPerformanceRows, driverSortDirection, driverSortKey]);

  const toggleSort = (key: SortKey) => {
    if (driverSortKey === key) {
      setDriverSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setDriverSortKey(key);
    setDriverSortDirection(key === 'variance' ? 'asc' : 'desc');
  };

  const toggleExpanded = (driverId: string) => {
    setExpandedDriverIds((prev) => ({
      ...prev,
      [driverId]: !prev[driverId],
    }));
  };

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-slate-900">Operational Analytics</CardTitle>
            <p className="text-sm text-slate-600">
              {lastLoadedLabel
                ? `Showing data for ${lastLoadedLabel}`
                : 'Select a range to view analytics'}
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

              {/* Custom range */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-600">Custom Range</p>
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    value={customStartDate}
                    onChange={(e) => {
                      setCustomStartDate(e.target.value);
                      setUseCustomRange(true);
                    }}
                  />
                  <span className="text-xs text-slate-400">→</span>
                  <input
                    type="date"
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    value={customEndDate}
                    onChange={(e) => {
                      setCustomEndDate(e.target.value);
                      setUseCustomRange(true);
                    }}
                  />
                </div>
              </div>

              {/* Remittance grouping */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-600">Remittance Group</p>
                <select
                  className="h-8 min-w-24 rounded-lg border border-input bg-background px-2 text-sm"
                  value={remittanceGroupBy}
                  onChange={(e) => setRemittanceGroupBy(e.target.value as RemittanceGroupBy)}
                >
                  <option value="day">Daily</option>
                  <option value="week">Weekly</option>
                  <option value="month">Monthly</option>
                </select>
              </div>

              <Button
                variant="outline"
                onClick={exportCsv}
                disabled={loading || dailySeries.length === 0}
              >
                Export CSV
              </Button>
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {/* KPI tiles */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Revenue</p>
              <p className="text-lg font-semibold text-slate-900">{currency(totals.revenue)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Passengers</p>
              <p className="text-lg font-semibold text-slate-900">{totals.passengers}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Trips</p>
              <p className="text-lg font-semibold text-slate-900">{totals.trips}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Avg Passengers / Trip</p>
              <p className="text-lg font-semibold text-slate-900">{totals.avgPerTrip.toFixed(1)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Avg Revenue / Trip</p>
              <p className="text-lg font-semibold text-slate-900">{currency(totals.avgRevenuePerTrip)}</p>
            </div>
          </div>

          {/* Charts */}
          <div className="grid gap-3 lg:grid-cols-2">
            {/* Daily Revenue & Passengers */}
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="mb-2 text-sm font-medium text-slate-900">Daily Revenue & Passengers</p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailySeries}>
                    <CartesianGrid strokeDasharray="4 4" stroke="#cbd5e1" />
                    <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fill: '#475569', fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: '#475569', fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: unknown, name: unknown) => {
                        const numeric = toNumeric(value);
                        return String(name) === 'Revenue' ? currency(numeric) : String(numeric);
                      }}
                    />
                    <Line yAxisId="left" type="monotone" dataKey="revenue" name="Revenue" stroke="#0f766e" strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="passengers" name="Passengers" stroke="#1d4ed8" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Monthly Revenue */}
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="mb-2 text-sm font-medium text-slate-900">Monthly Revenue</p>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlySeries}>
                    <CartesianGrid strokeDasharray="4 4" stroke="#cbd5e1" />
                    <XAxis dataKey="month" tick={{ fill: '#475569', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#475569', fontSize: 11 }} />
                    <Tooltip formatter={(value: unknown) => currency(toNumeric(value))} />
                    <Bar dataKey="revenue" name="Revenue" fill="#0f766e" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Cash Reconciliation */}
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="mb-2 text-sm font-medium text-slate-900">
                Cash Reconciliation ({remittanceGroupBy})
              </p>
              <div className="mb-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                  <p className="font-medium text-slate-900">Expected</p>
                  <p>{currency(remittanceSummary?.totals.expectedAmount || 0)}</p>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                  <p className="font-medium text-slate-900">Remitted</p>
                  <p>{currency(remittanceSummary?.totals.actualAmount || 0)}</p>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                  <p className="font-medium text-slate-900">Variance</p>
                  <p className={remittanceVariancePct < 0 ? 'text-rose-700' : 'text-emerald-700'}>
                    {currency(remittanceSummary?.totals.varianceAmount || 0)} ({remittanceVariancePct.toFixed(1)}%)
                  </p>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
                  <p className="font-medium text-slate-900">Status</p>
                  <p>
                    Pending {remittanceSummary?.totals.pendingCount || 0} · Flagged {remittanceSummary?.totals.flaggedCount || 0}
                  </p>
                </div>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={remittanceSummary?.series || []}>
                    <CartesianGrid strokeDasharray="4 4" stroke="#cbd5e1" />
                    <XAxis dataKey="period" tick={{ fill: '#475569', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#475569', fontSize: 11 }} />
                    <Tooltip formatter={(value: unknown) => currency(toNumeric(value))} />
                    <Bar dataKey="expectedAmount" name="Expected" fill="#0f766e" />
                    <Bar dataKey="actualAmount" name="Remitted" fill="#2563eb" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Driver remittance table */}
            <div className="rounded-xl border border-slate-200 p-3">
              <p className="mb-2 text-sm font-medium text-slate-900">Driver Remittance Breakdown</p>
              <div className="max-h-72 overflow-auto rounded-md border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Driver</TableHead>
                      <TableHead className="text-right">Expected</TableHead>
                      <TableHead className="text-right">Remitted</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                      <TableHead className="text-right">Count</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(remittanceSummary?.drivers || []).map((driver) => {
                      const variancePct = driver.expectedAmount
                        ? (driver.varianceAmount / driver.expectedAmount) * 100
                        : 0;

                      return (
                        <TableRow key={driver.driverId}>
                          <TableCell>
                            <p className="font-medium text-slate-900">{driver.firstName} {driver.lastName}</p>
                            <p className="text-xs text-muted-foreground">{driver.email}</p>
                          </TableCell>
                          <TableCell className="text-right">{currency(driver.expectedAmount)}</TableCell>
                          <TableCell className="text-right">{currency(driver.actualAmount)}</TableCell>
                          <TableCell className={`text-right ${driver.varianceAmount < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                            {currency(driver.varianceAmount)} ({variancePct.toFixed(1)}%)
                          </TableCell>
                          <TableCell className="text-right">{driver.remittanceCount}</TableCell>
                        </TableRow>
                      );
                    })}
                    {!loading && (remittanceSummary?.drivers || []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          No remittance records for this range.
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>

          {/* Missing remittance */}
          {(remittanceSummary?.missingByDriver || []).length > 0 ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50/30 p-3">
              <p className="mb-2 text-sm font-medium text-rose-900">⚠ Drivers With Missing Remittance</p>
              <div className="max-h-64 overflow-auto rounded-md border border-rose-200">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Driver</TableHead>
                      <TableHead className="text-right">Missing Shifts</TableHead>
                      <TableHead className="text-right">Missing Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(remittanceSummary?.missingByDriver || []).map((driver) => (
                      <TableRow key={driver.driverId}>
                        <TableCell>
                          <p className="font-medium text-slate-900">{driver.firstName} {driver.lastName}</p>
                          <p className="text-xs text-muted-foreground">{driver.email}</p>
                        </TableCell>
                        <TableCell className="text-right">{driver.missingCount}</TableCell>
                        <TableCell className="text-right text-rose-700">{currency(driver.missingExpectedAmount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}

          <div className="space-y-3 rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-900">Driver Performance</p>
                <p className="text-xs text-slate-500">Click a driver row to view shift-by-shift details.</p>
              </div>
              <p className="text-xs text-slate-500">{sortedDriverRows.length} drivers</p>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-900">
              ⚠ {driversNeedingAttention} drivers need attention
            </div>

            <div className="max-h-[28rem] overflow-auto rounded-md border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer" onClick={() => toggleSort('driverName')}>
                      Driver Name <span className="text-slate-400">{sortIndicator(driverSortKey === 'driverName', driverSortDirection)}</span>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right" onClick={() => toggleSort('shifts')}>
                      Shifts <span className="text-slate-400">{sortIndicator(driverSortKey === 'shifts', driverSortDirection)}</span>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right" onClick={() => toggleSort('passengers')}>
                      Passengers <span className="text-slate-400">{sortIndicator(driverSortKey === 'passengers', driverSortDirection)}</span>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right" onClick={() => toggleSort('expected')}>
                      Expected (₱) <span className="text-slate-400">{sortIndicator(driverSortKey === 'expected', driverSortDirection)}</span>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right" onClick={() => toggleSort('remitted')}>
                      Remitted (₱) <span className="text-slate-400">{sortIndicator(driverSortKey === 'remitted', driverSortDirection)}</span>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right" onClick={() => toggleSort('variance')}>
                      Variance (₱) <span className="text-slate-400">{sortIndicator(driverSortKey === 'variance', driverSortDirection)}</span>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right" onClick={() => toggleSort('onTimeRate')}>
                      On-Time Rate <span className="text-slate-400">{sortIndicator(driverSortKey === 'onTimeRate', driverSortDirection)}</span>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right" onClick={() => toggleSort('flagRate')}>
                      Flag Rate <span className="text-slate-400">{sortIndicator(driverSortKey === 'flagRate', driverSortDirection)}</span>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right" onClick={() => toggleSort('ignoredRequests')}>
                      Ignored Requests <span className="text-slate-400">{sortIndicator(driverSortKey === 'ignoredRequests', driverSortDirection)}</span>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right" onClick={() => toggleSort('lateManualBoards')}>
                      Late Manual Boards <span className="text-slate-400">{sortIndicator(driverSortKey === 'lateManualBoards', driverSortDirection)}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedDriverRows.map((driver) => {
                    const expanded = Boolean(expandedDriverIds[driver.driverId]);
                    return (
                      <Fragment key={driver.driverId}>
                        <TableRow
                          className="cursor-pointer hover:bg-slate-50 focus-within:bg-slate-50"
                          onClick={() => toggleExpanded(driver.driverId)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              toggleExpanded(driver.driverId);
                            }
                          }}
                          tabIndex={0}
                          role="button"
                          aria-expanded={expanded}
                          aria-label={`Toggle shift details for ${driver.driverName}`}
                        >
                          <TableCell className="font-medium text-slate-900">
                            <span className="inline-flex items-center gap-2">
                              <span
                                className={`inline-block text-slate-400 transition-transform ${
                                  expanded ? 'rotate-90' : ''
                                }`}
                                aria-hidden="true"
                              >
                                ▶
                              </span>
                              {driver.driverName}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">{driver.totalShifts}</TableCell>
                          <TableCell className="text-right">{driver.totalPassengersBoarded}</TableCell>
                          <TableCell className="text-right">{currency(driver.totalExpectedRemittance)}</TableCell>
                          <TableCell className="text-right">{currency(driver.totalActualRemittance)}</TableCell>
                          <TableCell className={`text-right ${varianceClassName(driver.totalVariance, driver.varianceRate)}`}>
                            {currency(driver.totalVariance)}
                          </TableCell>
                          <TableCell className="text-right">{percent(driver.onTimeSubmissionRate)}</TableCell>
                          <TableCell className={`text-right ${flagRateClassName(driver.flagRate)}`}>
                            {percent(driver.flagRate)}
                          </TableCell>
                          <TableCell className={`text-right ${ignoredClassName(driver.totalIgnoredRequests)}`}>
                            {driver.totalIgnoredRequests}
                          </TableCell>
                          <TableCell className="text-right">{driver.totalLateManualBoarded}</TableCell>
                        </TableRow>
                        {expanded ? (
                          <TableRow>
                            <TableCell colSpan={10} className="bg-slate-50/70 p-0">
                              <div className="overflow-auto">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="sticky top-0 z-10 bg-slate-100">Shift Date</TableHead>
                                      <TableHead className="sticky top-0 z-10 bg-slate-100 text-right">Passengers</TableHead>
                                      <TableHead className="sticky top-0 z-10 bg-slate-100 text-right">Expected</TableHead>
                                      <TableHead className="sticky top-0 z-10 bg-slate-100 text-right">Remitted</TableHead>
                                      <TableHead className="sticky top-0 z-10 bg-slate-100 text-right">Variance</TableHead>
                                      <TableHead className="sticky top-0 z-10 bg-slate-100">Status</TableHead>
                                      <TableHead className="sticky top-0 z-10 bg-slate-100">Submitted On Time?</TableHead>
                                      <TableHead className="sticky top-0 z-10 bg-slate-100 text-right">Ignored Requests</TableHead>
                                      <TableHead className="sticky top-0 z-10 bg-slate-100 text-right">Late Manual Boards</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {driver.shifts.map((shift) => (
                                      <TableRow key={shift.tripId}>
                                        <TableCell>
                                          {new Date(shift.shiftDate).toLocaleDateString('en-PH', {
                                            year: 'numeric',
                                            month: 'short',
                                            day: '2-digit',
                                          })}
                                        </TableCell>
                                        <TableCell className="text-right">{shift.passengers}</TableCell>
                                        <TableCell className="text-right">{currency(shift.expectedRemittance)}</TableCell>
                                        <TableCell className="text-right">{currency(shift.actualRemittance)}</TableCell>
                                        <TableCell className={`text-right ${varianceClassName(shift.variance, shift.expectedRemittance ? (shift.variance / shift.expectedRemittance) * 100 : 0)}`}>
                                          {currency(shift.variance)}
                                        </TableCell>
                                        <TableCell className="capitalize">{String(shift.remittanceStatus).replace('_', ' ')}</TableCell>
                                        <TableCell>{shift.submittedOnTime ? 'Yes' : 'No'}</TableCell>
                                        <TableCell className={`text-right ${ignoredClassName(shift.ignoredRequests)}`}>{shift.ignoredRequests}</TableCell>
                                        <TableCell className="text-right">{shift.lateManualBoards}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })}
                  {!loading && sortedDriverRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-muted-foreground">
                        No driver performance records for this range.
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
