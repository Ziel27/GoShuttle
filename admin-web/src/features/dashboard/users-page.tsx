import { useEffect, useMemo, useState } from 'react';

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
import { createManagedUser, fetchUsers, patchUserStatus } from '@/lib/admin-api';
import type { User } from '@/types/domain';

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
    return {
      label: 'On shift',
      detail: 'Driver currently driving',
      variant: 'default' as const,
    };
  }
  if (status === 'active') {
    return {
      label: 'Online',
      detail: 'Account active',
      variant: 'secondary' as const,
    };
  }
  return {
    label: 'Offline',
    detail: 'Account active',
    variant: 'outline' as const,
  };
};

export const UsersPage = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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

  useEffect(() => {
    void loadUsers();
  }, []);

  const toggleActive = async (user: User) => {
    setMutatingId(user._id);
    try {
      const updated = await patchUserStatus(user._id, { isActive: !user.isActive });
      setUsers((prev) => prev.map((item) => (item._id === updated._id ? updated : item)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update user');
    } finally {
      setMutatingId('');
    }
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

  return (
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
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.map((user) => (
              <TableRow key={user._id}>
                <TableCell>{user.firstName} {user.lastName}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell className="capitalize">{user.role}</TableCell>
                <TableCell>
                  {(() => {
                    const state = getAccountState(user);
                    return (
                      <div className="space-y-1">
                        <Badge variant={state.variant}>{state.label}</Badge>
                        <p className="text-xs text-slate-500">{state.detail}</p>
                      </div>
                    );
                  })()}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={mutatingId === user._id}
                    onClick={() => void toggleActive(user)}
                  >
                    {mutatingId === user._id ? 'Saving...' : user.isActive === false ? 'Activate' : 'Deactivate'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!loading && filteredUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No users match the current filter.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};
