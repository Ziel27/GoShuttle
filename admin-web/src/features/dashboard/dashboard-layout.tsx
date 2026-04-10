import { FiBarChart2, FiFileText, FiLogOut, FiMap, FiTrendingUp, FiTruck, FiUsers } from 'react-icons/fi';
import { NavLink, Outlet } from 'react-router-dom';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useAuth } from '@/context/auth-context';
import { LiveEventsPanel } from '@/features/dashboard/live-events-panel';
import { useLiveEvents } from '@/features/dashboard/use-live-events';
import { communityIdFromUnknown } from '@/lib/format';

const navItems = [
  { to: '/', label: 'Overview', icon: FiBarChart2, end: true },
  { to: '/communities', label: 'Community Control', icon: FiMap },
  { to: '/users', label: 'Users', icon: FiUsers },
  { to: '/shuttles', label: 'Shuttles', icon: FiTruck },
  { to: '/remittances', label: 'Remittances', icon: FiFileText },
  { to: '/analytics', label: 'Analytics', icon: FiTrendingUp },
];

export const DashboardLayout = () => {
  const { user, token, logout } = useAuth();
  const communityId = communityIdFromUnknown(user?.communityId);
  const { events, connected } = useLiveEvents(token, communityId);

  return (
    <div className="min-h-screen w-full bg-slate-100">
      <div className="grid min-h-screen w-full gap-3 p-2 lg:grid-cols-[280px_minmax(0,1fr)] lg:p-3">
        <aside className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-3 lg:h-[calc(100vh-1.5rem)] lg:overflow-y-auto">
          <div className="mb-5 flex items-center gap-3">
            <Avatar className="size-9 bg-emerald-100 text-emerald-700">
              <AvatarFallback>{user?.firstName?.[0] || 'A'}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-semibold">{user?.firstName} {user?.lastName}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                      isActive
                        ? 'border-emerald-700 bg-emerald-700 text-white shadow-sm'
                        : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900'
                    }`
                  }
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>

          <div className="mt-auto pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={() => void logout()}
              className="flex w-full items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-sm text-red-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
            >
              <FiLogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        </aside>

        <main className="min-w-0 space-y-4 pb-3">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Operations Dashboard</h1>
            <p className="text-sm text-slate-600">
              Single-community operations, realtime fleet visibility, and geofence control.
            </p>
          </div>

          <div className="space-y-4">
            <Outlet />
            <LiveEventsPanel events={events} connected={connected} />
          </div>
        </main>
      </div>
    </div>
  );
};
