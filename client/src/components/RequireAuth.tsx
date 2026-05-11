import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';

export const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  const { user, accessToken } = useAuthStore();
  const location = useLocation();

  if (!user || !accessToken) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
};
