import { useEffect, useMemo, useState } from 'react';
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchAnalytics } from '@/lib/admin-api';
import { currency } from '@/lib/format';
import type { AnalyticsResponse } from '@/types/domain';

type ChartPoint = {
  date: string;
  passengers: number;
  revenue: number;
  trips: number;
};

const dayLabel = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day).toLocaleDateString('en-PH', {
    month: 'short',
    day: '2-digit',
  });

export const OverviewPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError('');
      try {
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - 13 * 24 * 60 * 60 * 1000);

        const data = await fetchAnalytics({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        });

        setAnalytics(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load analytics');
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, []);

  const chartData = useMemo<ChartPoint[]>(() => {
    if (!analytics) return [];
    return analytics.series.map((item) => ({
      date: dayLabel(item._id.year, item._id.month, item._id.day),
      passengers: item.totalPassengers,
      revenue: item.totalRevenue,
      trips: item.tripCount,
    }));
  }, [analytics]);

  return (
    <div className="space-y-4">
      <section className="grid gap-4 md:grid-cols-3">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm text-slate-500">Passengers (14d)</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <p className="text-2xl font-semibold text-slate-900">{analytics?.totals.totalPassengers || 0}</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm text-slate-500">Revenue (14d)</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <p className="text-2xl font-semibold text-slate-900">{currency(analytics?.totals.totalRevenue || 0)}</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-sm text-slate-500">Trips (14d)</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p className="text-2xl font-semibold text-slate-900">{analytics?.totals.tripCount || 0}</p>
            )}
          </CardContent>
        </Card>
      </section>

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Daily Trend</CardTitle>

          </div>
          <p className="text-sm text-slate-600">Overview for the last 14 days</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-72 w-full" />
          ) : chartData.length ? (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="4 4" stroke="#cbd5e1" />
                  <XAxis dataKey="date" tick={{ fill: '#475569', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#475569', fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: unknown, name: unknown) => {
                      const numeric =
                        typeof value === 'number' ? value : Number(value) || 0;
                      return name === 'revenue' ? currency(numeric) : numeric;
                    }}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#0f766e" fill="#0f766e" fillOpacity={0.16} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No analytics data for selected range.</p>
          )}
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
};
