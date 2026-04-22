import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createAnnouncement, fetchAnnouncements } from '@/lib/admin-api';
import type { Announcement, AnnouncementLevel } from '@/types/domain';

const levelStyles: Record<AnnouncementLevel, string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  critical: 'border-rose-200 bg-rose-50 text-rose-800',
};

const createdByLabel = (createdBy: Announcement['createdBy']) => {
  if (typeof createdBy === 'object' && createdBy !== null) {
    const name = `${createdBy.firstName || ''} ${createdBy.lastName || ''}`.trim();
    return name || createdBy.email || 'Admin';
  }
  return 'Admin';
};

export const AnnouncementsPage = () => {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [level, setLevel] = useState<AnnouncementLevel>('info');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchAnnouncements({ limit: 30 });
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load announcements.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const canPost = useMemo(() => title.trim().length > 0 && body.trim().length > 0, [title, body]);

  const handlePost = async () => {
    if (!canPost || posting) return;
    setPosting(true);
    setError('');
    setSuccess('');
    try {
      const created = await createAnnouncement({
        title: title.trim(),
        body: body.trim(),
        level,
      });
      setItems((prev) => [created, ...prev]);
      setTitle('');
      setBody('');
      setLevel('info');
      setSuccess('Announcement posted.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to post announcement.');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-slate-900">Announcements</CardTitle>
          <p className="text-sm text-slate-600">
            Publish service updates to all users in this community.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-[1fr_180px]">
            <div className="space-y-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-600">Title</p>
                <input
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Route advisory: Gate 2 closed"
                  maxLength={120}
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-600">Message</p>
                <textarea
                  className="min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write the announcement details..."
                  maxLength={2000}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-slate-600">Level</p>
                <select
                  className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
                  value={level}
                  onChange={(e) => setLevel(e.target.value as AnnouncementLevel)}
                >
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              <Button onClick={() => void handlePost()} disabled={!canPost || posting} className="w-full">
                {posting ? 'Posting...' : 'Post Announcement'}
              </Button>

              <Button variant="outline" onClick={() => void load()} disabled={loading} className="w-full">
                {loading ? 'Refreshing...' : 'Refresh'}
              </Button>
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-slate-900">Recent</CardTitle>
            <p className="text-sm text-slate-600">{items.length} announcements</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 && !loading ? (
            <p className="text-sm text-slate-600">No announcements yet.</p>
          ) : null}

          <div className="space-y-2">
            {items.map((a) => (
              <div key={a._id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{a.title}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(a.createdAt).toLocaleString('en-PH')} · {createdByLabel(a.createdBy)}
                    </p>
                  </div>
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${levelStyles[a.level]}`}>
                    {a.level}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{a.body}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

