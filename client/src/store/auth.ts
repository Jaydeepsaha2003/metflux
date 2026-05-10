import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PermissionKey } from '@/lib/permissions';

export type Role = 'COMPANY_ADMIN' | 'MANAGER' | 'STAFF';

export type User = {
  id: string;
  email: string;
  username: string;
  name: string;
  isPlatformAdmin: boolean;
  isActive: boolean;
};

export type Membership = {
  id: string;
  companyId: string;
  companyName: string;
  companySlug?: string;
  companyLogoUrl?: string | null;
  role: Role;
  permissions: PermissionKey[];
  isPrimary: boolean;
};

// Server response shape for /auth/login, /auth/refresh, /auth/switch-company.
export type LoginPayload = {
  user: User;
  memberships: Membership[];
  activeCompanyId: string | null;
  activeRole: Role | null;
  activePermissions: PermissionKey[];
  accessToken: string;
};

type AuthState = {
  user: User | null;
  memberships: Membership[];
  activeCompanyId: string | null;
  activeRole: Role | null;
  activePermissions: PermissionKey[];
  accessToken: string | null;
  setSession: (payload: LoginPayload) => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      memberships: [],
      activeCompanyId: null,
      activeRole: null,
      activePermissions: [],
      accessToken: null,
      setSession: (p) =>
        set({
          user: p.user,
          memberships: p.memberships,
          activeCompanyId: p.activeCompanyId,
          activeRole: p.activeRole,
          activePermissions: p.activePermissions ?? [],
          accessToken: p.accessToken,
        }),
      clear: () =>
        set({
          user: null, memberships: [], activeCompanyId: null,
          activeRole: null, activePermissions: [], accessToken: null,
        }),
    }),
    {
      name: 'metflux-auth',
      partialize: (s) => ({
        user: s.user,
        memberships: s.memberships,
        activeCompanyId: s.activeCompanyId,
        activeRole: s.activeRole,
        activePermissions: s.activePermissions,
      }),
    }
  )
);

export const activeMembership = (s: AuthState) =>
  s.memberships.find((m) => m.companyId === s.activeCompanyId) ?? null;

// Permission check used everywhere in the UI. Platform admin and COMPANY_ADMIN
// implicitly have every permission.
export const can = (key: PermissionKey | undefined, s = useAuthStore.getState()) => {
  if (!key) return true;
  if (s.user?.isPlatformAdmin) return true;
  if (s.activeRole === 'COMPANY_ADMIN') return true;
  return s.activePermissions.includes(key);
};

export const useCan = (key?: PermissionKey) => {
  const s = useAuthStore();
  return can(key, s);
};
