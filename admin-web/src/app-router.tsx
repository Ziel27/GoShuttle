import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { useAuth } from '@/context/auth-context';
import { ProtectedRoute } from '@/features/auth/protected-route';
import { DashboardLayout } from '@/features/dashboard/dashboard-layout';

const LoginPage = lazy(() => import('@/features/auth/login-page').then((mod) => ({ default: mod.LoginPage })));
const AnalyticsPage = lazy(() => import('@/features/dashboard/analytics-page').then((mod) => ({ default: mod.AnalyticsPage })));
const AnnouncementsPage = lazy(() => import('@/features/dashboard/announcements-page').then((mod) => ({ default: mod.AnnouncementsPage })));
const CommunitiesPage = lazy(() => import('@/features/dashboard/communities-page').then((mod) => ({ default: mod.CommunitiesPage })));
const OverviewPage = lazy(() => import('@/features/dashboard/overview-page').then((mod) => ({ default: mod.OverviewPage })));
const RemittancesPage = lazy(() => import('@/features/dashboard/remittances-page').then((mod) => ({ default: mod.RemittancesPage })));
const ShuttlesPage = lazy(() => import('@/features/dashboard/shuttles-page').then((mod) => ({ default: mod.ShuttlesPage })));
const UsersPage = lazy(() => import('@/features/dashboard/users-page').then((mod) => ({ default: mod.UsersPage })));

const RouteFallback = () => (
  <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
    Loading...
  </div>
);

export const AppRouter = () => {
  const { user } = useAuth();

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<OverviewPage />} />
          <Route path="communities" element={<CommunitiesPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="shuttles" element={<ShuttlesPage />} />
          <Route path="remittances" element={<RemittancesPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="announcements" element={<AnnouncementsPage />} />
          <Route path="driver-analytics" element={<Navigate to="/analytics" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
};
