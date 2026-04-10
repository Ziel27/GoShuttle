import { Navigate, Route, Routes } from 'react-router-dom';

import { useAuth } from '@/context/auth-context';
import { LoginPage } from '@/features/auth/login-page';
import { ProtectedRoute } from '@/features/auth/protected-route';
import { AnalyticsPage } from '@/features/dashboard/analytics-page';
import { CommunitiesPage } from '@/features/dashboard/communities-page';
import { DashboardLayout } from '@/features/dashboard/dashboard-layout';
import { OverviewPage } from '@/features/dashboard/overview-page';
import { RemittancesPage } from '@/features/dashboard/remittances-page';
import { ShuttlesPage } from '@/features/dashboard/shuttles-page';
import { UsersPage } from '@/features/dashboard/users-page';

export const AppRouter = () => {
  const { user } = useAuth();

  return (
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
        <Route path="driver-analytics" element={<Navigate to="/analytics" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
