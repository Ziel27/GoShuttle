import { useEffect, useMemo, useRef, useState } from 'react';

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
import {
    createManagedUser,
    deactivateUserWithNote,
    fetchDiscountVerifications,
    fetchUsers,
    patchUserStatus,
    reviewDiscountVerification,
    sendUserWarning,
    type DiscountVerificationItem,
} from '@/lib/admin-api';
import type { User } from '@/types/domain';
import { useAuth } from '@/context/auth-context';
import { communityIdFromUnknown } from '@/lib/format';

const MAX_WARNINGS = 2;

const getAccountState = (user: User) => {
  if (user.isActive === false) {
    return {
      label: 'Inactive account',
      detail: 'Login disabled',
      variant: 'destructive' as const,
    };
  }

  const status = user.status || 'offline';
  if (status === 'driving') {
    return { label: 'On shift', detail: 'Driver currently driving', variant: 'default' as const };
  }
  if (status === 'active') {
    return { label: 'Online', detail: 'Account active', variant: 'secondary' as const };
  }
  return { label: 'Offline', detail: 'Account active', variant: 'outline' as const };
};

type ActionModalProps = {
  type: 'warn' | 'deactivate';
  user: User;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void>;
};

const ActionModal = ({ type, user, onClose, onConfirm }: ActionModalProps) => {
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const warningCount = user.warnings?.length ?? 0;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const isWarn = type === 'warn';
  const title = isWarn ? `Send Warning (${warningCount + 1}/${MAX_WARNINGS})` : 'Deactivate Account';
  const confirmLabel = isWarn ? 'Send Warning' : 'Deactivate Account';
  const placeholder = isWarn
    ? 'Describe the reason for this warning (e.g., repeated late boarding, disruptive behaviour)...'
    : 'Describe the reason for deactivation (e.g., repeated violations after 2 warnings)...';

  const handleSubmit = async () => {
    if (!note.trim() || note.trim().length < 5) {
      setError('Please provide a note of at least 5 characters.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await onConfirm(note.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className={`rounded-t-2xl px-6 py-5 ${isWarn ? 'bg-amber-50 border-b border-amber-200' : 'bg-red-50 border-b border-red-200'}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className={`text-base font-semibold ${isWarn ? 'text-amber-900' : 'text-red-900'}`}>{title}</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {user.firstName} {user.lastName} · {user.email}
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={loading}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="space-y-4 px-6 py-5">
          {isWarn && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {warningCount === 0
                ? 'This is the 1st warning. After a 2nd warning, you can deactivate this account.'
                : 'This is the final (2nd) warning. After this, the Deactivate button will appear.'}
            </div>
          )}
          {!isWarn && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              This will permanently disable login for this user. A notification email will be sent with your note.
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="action-note" className="text-sm font-medium text-slate-700">
              {isWarn ? 'Warning Reason' : 'Deactivation Reason'}
            </Label>
            <textarea
              id="action-note"
              ref={textareaRef}
              value={note}
              onChange={(e) => { setNote(e.target.value); setError(''); }}
              placeholder={placeholder}
              rows={4}
              maxLength={500}
              disabled={loading}
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300 disabled:opacity-60"
            />
            <div className="flex items-center justify-between">
              {error ? <p className="text-xs text-red-600">{error}</p> : <span />}
              <p className="text-xs text-slate-400">{note.length}/500</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 rounded-b-2xl border-t border-slate-100 bg-slate-50 px-6 py-4">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            disabled={loading}
            onClick={() => void handleSubmit()}
            className={isWarn
              ? 'bg-amber-500 text-white hover:bg-amber-600'
              : 'bg-red-600 text-white hover:bg-red-700'}
          >
            {loading ? 'Sending...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};

export const UsersPage = () => {
  const { user: authUser } = useAuth();
  const scopedCommunityId = communityIdFromUnknown(authUser?.communityId);

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [discountVerifications, setDiscountVerifications] = useState<DiscountVerificationItem[]>([]);
  const [discountVerifLoading, setDiscountVerifLoading] = useState(false);
  const [discountVerifError, setDiscountVerifError] = useState('');
  const [discountVerifFilter, setDiscountVerifFilter] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [discountVerifReviewing, setDiscountVerifReviewing] = useState('');
  const [discountVerifRejectTarget, setDiscountVerifRejectTarget] = useState('');
  const [discountVerifRejectionReason, setDiscountVerifRejectionReason] = useState('');
  const [mutatingId, setMutatingId] = useState('');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'driver' | 'passenger'>('all');
  const [creating, setCreating] = useState(false);
  const [newRole, setNewRole] = useState<'admin' | 'driver'>('driver');
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPhone, setNewPhone] = useState('');

  // Modal state
  const [modalTarget, setModalTarget] = useState<{ user: User; type: 'warn' | 'deactivate' } | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const scoped = await fetchUsers({ active: false });
      setUsers(scoped);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const loadDiscountVerifications = async (filter: 'pending' | 'approved' | 'rejected') => {
    if (!scopedCommunityId) return;
    setDiscountVerifLoading(true);
    setDiscountVerifError('');
    try {
      const items = await fetchDiscountVerifications(scopedCommunityId, filter);
      setDiscountVerifications(items);
    } catch (e) {
      setDiscountVerifError(e instanceof Error ? e.message : 'Failed to load verifications');
    } finally {
      setDiscountVerifLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
    void loadDiscountVerifications('pending');
  }, []);

  const activateUser = async (user: User) => {
    setMutatingId(user._id);
    try {
      const updated = await patchUserStatus(user._id, { isActive: true });
      setUsers((prev) => prev.map((item) => (item._id === updated._id ? updated : item)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to activate user');
    } finally {
      setMutatingId('');
    }
  };

  const handleModalConfirm = async (note: string) => {
    if (!modalTarget) return;
    const { user, type } = modalTarget;

    const updated =
      type === 'warn'
        ? await sendUserWarning(user._id, note)
        : await deactivateUserWithNote(user._id, note);

    setUsers((prev) => prev.map((item) => (item._id === updated._id ? updated : item)));
    setModalTarget(null);
  };

  const createUser = async () => {
    setCreating(true);
    setError('');
    try {
      await createManagedUser({
        role: newRole,
        firstName: newFirstName.trim(),
        lastName: newLastName.trim(),
        email: newEmail.trim().toLowerCase(),
        password: newPassword,
        phone: newPhone.trim(),
      });
      setNewFirstName('');
      setNewLastName('');
      setNewEmail('');
      setNewPassword('');
      setNewPhone('');
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  const grouped = useMemo(() => {
    const admins = users.filter((u) => u.role === 'admin').length;
    const drivers = users.filter((u) => u.role === 'driver').length;
    const passengers = users.filter((u) => u.role === 'passenger').length;
    return { admins, drivers, passengers };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return users.filter((user) => {
      const roleMatch = roleFilter === 'all' ? true : user.role === roleFilter;
      const text = `${user.firstName} ${user.lastName} ${user.email}`.toLowerCase();
      const queryMatch = normalized ? text.includes(normalized) : true;
      return roleMatch && queryMatch;
    });
  }, [users, query, roleFilter]);

  const renderActionButton = (user: User) => {
    const isBusy = mutatingId === user._id;
    const warningCount = user.warnings?.length ?? 0;

    if (user.isActive === false) {
      return (
        <Button size="sm" variant="outline" disabled={isBusy} onClick={() => void activateUser(user)}>
          {isBusy ? 'Saving...' : 'Activate'}
        </Button>
      );
    }

    if (warningCount >= MAX_WARNINGS) {
      return (
        <Button
          size="sm"
          disabled={isBusy}
          className="bg-red-600 text-white hover:bg-red-700"
          onClick={() => setModalTarget({ user, type: 'deactivate' })}
        >
          Deactivate
        </Button>
      );
    }

    return (
      <Button
        size="sm"
        disabled={isBusy}
        className="bg-amber-500 text-white hover:bg-amber-600"
        onClick={() => setModalTarget({ user, type: 'warn' })}
      >
        Warn ({warningCount}/{MAX_WARNINGS})
      </Button>
    );
  };

  return (
    <>
      {modalTarget && (
        <ActionModal
          type={modalTarget.type}
          user={modalTarget.user}
          onClose={() => setModalTarget(null)}
          onConfirm={handleModalConfirm}
        />
      )}

      {/* Discount Verification Queue */}
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-slate-900">Discount ID Verifications</CardTitle>
            <p className="mt-1 text-xs text-slate-500">Review passenger discount ID submissions.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {(['pending', 'approved', 'rejected'] as const).map((f) => (
              <button
                key={f}
                onClick={() => {
                  setDiscountVerifFilter(f);
                  void loadDiscountVerifications(f);
                }}
                className={`rounded px-3 py-1 text-xs font-medium border transition-colors ${
                  discountVerifFilter === f
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
            <button
              onClick={() => void loadDiscountVerifications(discountVerifFilter)}
              className="rounded px-3 py-1 text-xs font-medium border bg-white text-slate-600 border-slate-200 hover:border-slate-400"
            >
              Refresh
            </button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {discountVerifError ? <p className="text-sm text-destructive">{discountVerifError}</p> : null}
          {discountVerifLoading ? <p className="text-sm text-slate-500">Loading...</p> : null}
          {!discountVerifLoading && discountVerifications.length === 0 ? (
            <p className="text-sm text-slate-400">No {discountVerifFilter} ID verification requests.</p>
          ) : null}
          <div className="space-y-2">
            {discountVerifications.map((item) => (
              <div key={item.userId} className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{item.firstName} {item.lastName}</p>
                    <p className="text-xs text-slate-500">{item.email}</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Type: <span className="font-medium capitalize">{item.discountType}</span>
                      {' · '}
                      Submitted: {new Date(item.submittedAt).toLocaleDateString()}
                    </p>
                    {item.status === 'rejected' && item.rejectionReason ? (
                      <p className="text-xs text-red-600 mt-0.5">Reason: {item.rejectionReason}</p>
                    ) : null}
                  </div>
                  {item.idImageUrl ? (
                    <a
                      href={item.idImageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-blue-600 underline"
                    >
                      View ID Photo →
                    </a>
                  ) : null}
                </div>

                {item.status === 'pending' && (
                  <div className="space-y-2">
                    {discountVerifRejectTarget === item.userId ? (
                      <div className="space-y-2">
                        <input
                          type="text"
                          placeholder="Rejection reason (optional)"
                          value={discountVerifRejectionReason}
                          onChange={(e) => setDiscountVerifRejectionReason(e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-slate-400"
                        />
                        <div className="flex gap-2">
                          <button
                            disabled={discountVerifReviewing === item.userId}
                            onClick={async () => {
                              if (!scopedCommunityId) return;
                              setDiscountVerifReviewing(item.userId);
                              try {
                                await reviewDiscountVerification(scopedCommunityId, item.userId, {
                                  action: 'reject',
                                  ...(discountVerifRejectionReason.trim() ? { rejectionReason: discountVerifRejectionReason.trim() } : {}),
                                });
                                setDiscountVerifications((prev) => prev.filter((v) => v.userId !== item.userId));
                                setDiscountVerifRejectTarget('');
                                setDiscountVerifRejectionReason('');
                              } catch (e) {
                                setDiscountVerifError(e instanceof Error ? e.message : 'Failed');
                              } finally {
                                setDiscountVerifReviewing('');
                              }
                            }}
                            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700 disabled:opacity-60"
                          >
                            {discountVerifReviewing === item.userId ? 'Rejecting...' : 'Confirm Reject'}
                          </button>
                          <button
                            onClick={() => { setDiscountVerifRejectTarget(''); setDiscountVerifRejectionReason(''); }}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-slate-400"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          disabled={discountVerifReviewing === item.userId}
                          onClick={async () => {
                            if (!scopedCommunityId) return;
                            setDiscountVerifReviewing(item.userId);
                            try {
                              await reviewDiscountVerification(scopedCommunityId, item.userId, { action: 'approve' });
                              setDiscountVerifications((prev) => prev.filter((v) => v.userId !== item.userId));
                            } catch (e) {
                              setDiscountVerifError(e instanceof Error ? e.message : 'Failed');
                            } finally {
                              setDiscountVerifReviewing('');
                            }
                          }}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-60"
                        >
                          {discountVerifReviewing === item.userId ? 'Approving...' : 'Approve'}
                        </button>
                        <button
                          onClick={() => setDiscountVerifRejectTarget(item.userId)}
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 hover:border-red-400"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-slate-900">Users</CardTitle>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">Admins: {grouped.admins}</Badge>
              <Badge variant="outline">Drivers: {grouped.drivers}</Badge>
              <Badge variant="outline">Passengers: {grouped.passengers}</Badge>
            </div>
          </div>
          <Button variant="outline" onClick={() => void loadUsers()} disabled={loading}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-900">Create Admin / Driver</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="new-role">Role</Label>
                <select
                  id="new-role"
                  value={newRole}
                  onChange={(event) => setNewRole(event.target.value as 'admin' | 'driver')}
                  className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm"
                >
                  <option value="driver">driver</option>
                  <option value="admin">admin</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-phone">Phone (optional)</Label>
                <Input id="new-phone" value={newPhone} onChange={(event) => setNewPhone(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-firstname">First name</Label>
                <Input id="new-firstname" value={newFirstName} onChange={(event) => setNewFirstName(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-lastname">Last name</Label>
                <Input id="new-lastname" value={newLastName} onChange={(event) => setNewLastName(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-email">Email</Label>
                <Input id="new-email" type="email" value={newEmail} onChange={(event) => setNewEmail(event.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-password">Password</Label>
                <Input id="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => void createUser()} disabled={creating}>
                {creating ? 'Creating...' : 'Create User'}
              </Button>
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-[1fr,auto]">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or email"
              aria-label="Search users"
            />
            <div className="flex flex-wrap gap-2">
              {(['all', 'admin', 'driver', 'passenger'] as const).map((role) => (
                <Button
                  key={role}
                  size="sm"
                  variant={roleFilter === role ? 'default' : 'outline'}
                  onClick={() => setRoleFilter(role)}
                >
                  {role}
                </Button>
              ))}
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Account State</TableHead>
                <TableHead>Warnings</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((user) => {
                const state = getAccountState(user);
                const warningCount = user.warnings?.length ?? 0;
                return (
                  <TableRow key={user._id}>
                    <TableCell>{user.firstName} {user.lastName}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell className="capitalize">{user.role}</TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Badge variant={state.variant}>{state.label}</Badge>
                        <p className="text-xs text-slate-500">{state.detail}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {warningCount === 0 ? (
                        <span className="text-xs text-slate-400">None</span>
                      ) : (
                        <div className="space-y-1">
                          <Badge
                            variant="outline"
                            className={warningCount >= MAX_WARNINGS
                              ? 'border-red-300 bg-red-50 text-red-700'
                              : 'border-amber-300 bg-amber-50 text-amber-700'}
                          >
                            {warningCount}/{MAX_WARNINGS}
                          </Badge>
                          {user.warnings?.map((w, i) => (
                            <p key={w._id} className="text-xs text-slate-500 max-w-[180px] truncate" title={w.note}>
                              #{i + 1}: {w.note}
                            </p>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {renderActionButton(user)}
                    </TableCell>
                  </TableRow>
                );
              })}
              {!loading && filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No users match the current filter.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
};
