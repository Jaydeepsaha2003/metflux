// App Branding — platform-admin upload of the global webapp logo (shown on the
// login screen + sidebar, and used as the browser favicon).
import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Image as ImageIcon, Upload, Trash2, Loader2, Info } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useBranding } from '@/store/branding';

export const BrandingPage = () => {
  const isPlatform = !!useAuthStore((s) => s.user?.isPlatformAdmin);
  const { logoUrl, set } = useBranding();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('logo', file);
      return api<{ logoUrl: string | null }>('/app-settings/logo', { method: 'POST', body: fd });
    },
    onSuccess: (r) => { set(r.logoUrl); setError(null); },
    onError: (e) => setError(e instanceof Error ? e.message : 'Upload failed'),
  });

  const remove = useMutation({
    mutationFn: () => api<{ logoUrl: null }>('/app-settings/logo', { method: 'DELETE' }),
    onSuccess: () => set(null),
  });

  const onPick = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { setError('Please choose an image file.'); return; }
    if (f.size > 2 * 1024 * 1024) { setError('Image must be under 2 MB.'); return; }
    upload.mutate(f);
  };

  if (!isPlatform) {
    return <div className="card p-8 text-center text-sm text-slate-500">Platform admin only.</div>;
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-50 text-brand-600"><ImageIcon className="h-5 w-5" /></span>
          App Branding
        </h1>
        <p className="mt-1 text-sm text-slate-500">Upload the global webapp logo — it appears on the login screen, the sidebar, and as the browser tab icon.</p>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-4">
          <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            {logoUrl
              ? <img src={logoUrl} alt="App logo" className="h-full w-full object-contain p-2" />
              : <ImageIcon className="h-8 w-8 text-slate-300" />}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-900">{logoUrl ? 'Current logo' : 'No logo set'}</div>
            <p className="mt-0.5 text-xs text-slate-500">PNG or SVG, square works best. Max 2 MB.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={upload.isPending}
                className="btn-primary"
              >
                {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {logoUrl ? 'Replace' : 'Upload'} logo
              </button>
              {logoUrl && (
                <button
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                  className="btn-ghost border border-slate-300 text-red-600 hover:bg-red-50"
                >
                  {remove.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }}
        />

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          The logo is stored in the database, so it survives deployments. The favicon updates immediately; other users see it on their next page load.
        </div>
      </div>
    </div>
  );
};
