import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { tryRefresh } from '@/lib/api';
import { applyDomainCompany } from '@/lib/domainCompany';

export const RequireAuth = ({ children }: { children: React.ReactNode }) => {
  const { user, accessToken, setSession, clear } = useAuthStore();
  const [bootstrapped, setBootstrapped] = useState(!!accessToken);
  const location = useLocation();

  // Bootstrap runs ONCE on mount — deliberately no `accessToken` dependency.
  // tryRefresh() writes the token into the store, which would re-trigger this
  // effect if accessToken were a dep; React then runs the cleanup (cancelled =
  // true) BEFORE the in-flight `finally` fires, so setBootstrapped(true) gets
  // skipped and the app hangs forever on "Loading…". Running once avoids that
  // self-cancellation entirely. `mounted` only guards against a real unmount.
  useEffect(() => {
    if (useAuthStore.getState().accessToken) { setBootstrapped(true); return; }
    let mounted = true;
    (async () => {
      try {
        // Go through the SHARED refresh so a data request that fires during
        // bootstrap reuses this same call instead of racing on the refresh
        // cookie. tryRefresh sets the session (token) as soon as it resolves.
        const token = await tryRefresh();
        if (token) {
          const s = useAuthStore.getState();
          if (s.user) {
            // Honour this domain's pinned company (if any), now authenticated.
            const applied = await applyDomainCompany({
              user: s.user, memberships: s.memberships, activeCompanyId: s.activeCompanyId,
              activeRole: s.activeRole, activePermissions: s.activePermissions, accessToken: token,
            });
            if (mounted && applied.activeCompanyId !== s.activeCompanyId) setSession(applied);
          }
        } else {
          clear();
        }
      } catch {
        clear();
      } finally {
        if (mounted) setBootstrapped(true);
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
