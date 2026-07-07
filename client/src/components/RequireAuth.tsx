import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { tryRefresh } from '@/lib/api';
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
        // Go through the SHARED refresh so a data request that fires during
        // bootstrap reuses this same call instead of racing on the refresh
        // cookie. tryRefresh sets the session (token) as soon as it resolves.
        const token = await tryRefresh();
        if (!cancelled && token) {
          const s = useAuthStore.getState();
          if (s.user) {
            // Honour this domain's pinned company (if any), now authenticated.
            const applied = await applyDomainCompany({
              user: s.user, memberships: s.memberships, activeCompanyId: s.activeCompanyId,
              activeRole: s.activeRole, activePermissions: s.activePermissions, accessToken: token,
            });
            if (!cancelled && applied.activeCompanyId !== s.activeCompanyId) setSession(applied);
          }
        } else if (!cancelled) {
          clear();
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
