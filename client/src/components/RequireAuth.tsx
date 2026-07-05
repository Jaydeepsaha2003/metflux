import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore, type LoginPayload } from '@/store/auth';
import { api } from '@/lib/api';
import { applyDomainCompany } from '@/lib/domainCompany';

export const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  const { user, accessToken, setSession, clear } = useAuthStore();
  const [bootstrapped, setBootstrapped] = useState(!!accessToken);
  const location = useLocation();

  useEffect(() => {
    if (accessToken) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api<LoginPayload>('/auth/refresh', { method: 'POST' });
        if (!cancelled && data?.user && data.accessToken) {
          // Honour this domain's preferred company so it stays selected on refresh.
          const applied = await applyDomainCompany(data);
          if (!cancelled) setSession(applied);
        }
      } catch {
        if (!cancelled) clear();
      } finally {
        if (!cancelled) setBootstrapped(true);
      }
    })();
    return () => { cancelled = true; };
  }, [accessToken, setSession, clear]);

  if (!bootstrapped) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500">
        Loading…
      </div>
    );
  }

  if (!user || !accessToken) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
};
