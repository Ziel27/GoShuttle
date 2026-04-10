import { Navigate } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/context/auth-context';

export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="mx-auto mt-20 w-full max-w-5xl space-y-4 px-4">
        <Skeleton className="h-12 w-2/5" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
};
