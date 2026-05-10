// Thin fetch wrapper — attaches the Authorization header from the auth store
// and auto-refreshes the access token once on 401 by calling /api/auth/refresh.
import { useAuthStore, type LoginPayload } from '@/store/auth';

const BASE = '/api';

class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let refreshing: Promise<string | null> | null = null;

const tryRefresh = async (): Promise<string | null> => {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return null;
      const data = (await res.json()) as LoginPayload;
      useAuthStore.getState().setSession(data);
      return data.accessToken;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
};

export const api = async <T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown } = {}
): Promise<T> => {
  const { json, headers, ...rest } = init;
  const token = useAuthStore.getState().accessToken;

  const isFormData = rest.body instanceof FormData;
  const exec = (auth: string | null) =>
    fetch(`${BASE}${path}`, {
      ...rest,
      credentials: 'include',
      headers: {
        // Let the browser set Content-Type for FormData (it adds the boundary).
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });

  let res = await exec(token);

  if (res.status === 401 && path !== '/auth/refresh' && path !== '/auth/login') {
    const fresh = await tryRefresh();
    if (fresh) res = await exec(fresh);
    else useAuthStore.getState().clear();
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(err.message ?? `Request failed (${res.status})`, res.status, err.code, err.details);
  }
  return data as T;
};

export { ApiError };
