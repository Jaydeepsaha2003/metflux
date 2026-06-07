import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, AtSign, Loader2, Eye, EyeOff } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { LoginPayload } from '@/store/auth';
import { cn } from '@/lib/cn';

const getBrand = () => {
  const h = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : '';
  return h.includes('toroflux')
    ? { name: 'Toroflux Industries', short: 'TOROFLUX', color: '#0f50e5' }
    : { name: 'Metflux', short: 'METFLUX', color: '#2cab4a' };
};

export const AuthPage = () => {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const brand = getBrand();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await api<LoginPayload>('/auth/login', {
        method: 'POST',
        json: { identifier, password },
      });
      setSession(data);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8 sm:py-10"
      style={{
        paddingTop: 'max(2rem, env(safe-area-inset-top))',
        paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
      }}
    >
      {/* Animated gradient backdrop — charcoal → deep green → charcoal */}
      <div
        className="absolute inset-0 -z-30 animate-gradient-x"
        style={{
          backgroundSize: '200% 200%',
          backgroundImage:
            'linear-gradient(135deg, #0d0e11 0%, #0e3a22 45%, #1a1c20 100%)',
        }}
      />

      {/* Subtle dot grid overlay */}
      <div className="absolute inset-0 -z-20 bg-dot-grid opacity-60" />

      {/* Floating green blobs */}
      <div className="pointer-events-none absolute -top-24 -left-24 -z-10 h-64 w-64 sm:h-96 sm:w-96 rounded-full bg-brand-500/30 blur-3xl animate-blob-slow" />
      <div className="pointer-events-none absolute -bottom-24 -right-16 -z-10 h-72 w-72 sm:h-[28rem] sm:w-[28rem] rounded-full bg-brand-400/20 blur-3xl animate-blob-medium" />
      <div className="pointer-events-none absolute top-1/2 left-1/3 -z-10 h-52 w-52 sm:h-72 sm:w-72 rounded-full bg-emerald-300/15 blur-3xl animate-blob-fast" />

      <div className="w-full max-w-sm animate-fade-in">
        <div className="rounded-2xl border border-white/15 bg-white/95 p-6 shadow-2xl backdrop-blur-xl sm:p-7">
          {/* Brand header */}
          <div className="mb-5 text-center">
            <div
              className="inline-flex items-center justify-center h-10 w-10 rounded-xl mb-3 text-white text-sm font-black tracking-tight"
              style={{ backgroundColor: brand.color }}
            >
              {brand.short.slice(0, 2)}
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-0.5">
              Admin Portal
            </div>
            <div className="text-base font-bold text-slate-900" style={{ fontFamily: 'Poppins, sans-serif' }}>
              {brand.name}
            </div>
          </div>

          <form onSubmit={submit} className="space-y-4 animate-fade-up">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Sign in</h1>

            <Field
              icon={AtSign}
              label="User ID"
              value={identifier}
              onChange={setIdentifier}
              placeholder="User ID or email"
              autoComplete="username"
            />
            <Field
              icon={Lock}
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              autoComplete="current-password"
            />

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 animate-fade-up">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Signing in…' : 'Login'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

/* ---------- shared field ---------- */

type FieldProps = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  hint?: string;
};

const Field = ({
  icon: Icon, label, type = 'text', value, onChange, placeholder, autoComplete, hint,
}: FieldProps) => {
  const isPassword = type === 'password';
  const [reveal, setReveal] = useState(false);
  const inputType = isPassword && reveal ? 'text' : type;

  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <div className="group relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-brand-600" />
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
          className={cn('input pl-10', isPassword && 'pr-10')}
        />
        {isPassword && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition-colors hover:text-slate-600"
          >
            {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
};
