// Per-domain default company. Each brand domain (metfluxelectrical.com,
// torofluxindustries.com) can remember which company should be active, so the
// right one loads and stays selected after every refresh. Stored per hostname
// in localStorage (per browser), applied right after login / token refresh.
import { api } from '@/lib/api';
import type { LoginPayload } from '@/store/auth';

const key = () => `metflux-default-company:${window.location.hostname}`;

export const getDomainCompany = (): string | null => {
  try { return localStorage.getItem(key()); } catch { return null; }
};

export const setDomainCompany = (companyId: string | null) => {
  try {
    if (companyId) localStorage.setItem(key(), companyId);
    else localStorage.removeItem(key());
  } catch { /* ignore */ }
};

/** If this domain has a preferred company (and the user may use it), switch the
 *  session to it. Returns the payload to store — either the switched one or the
 *  original if no preference applies. Never throws. */
export const applyDomainCompany = async (data: LoginPayload): Promise<LoginPayload> => {
  const pref = getDomainCompany();
  if (!pref || pref === data.activeCompanyId) return data;
  const canUse = data.user?.isPlatformAdmin || data.memberships.some((m) => m.companyId === pref);
  if (!canUse) return data;
  try {
    return await api<LoginPayload>('/auth/switch-company', { method: 'POST', json: { companyId: pref } });
  } catch {
    return data;
  }
};
