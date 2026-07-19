// App Branding — platform-admin upload of the global webapp logo (shown on the
// login screen + sidebar, and used as the browser favicon).
import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Image as ImageIcon, Upload, Trash2, Loader2, Info, Palette, RotateCcw, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useBranding } from '@/store/branding';

const DEFAULT_BRAND = '#22c55e';
const PRESETS = [
  { name: 'Green (Metflux)', hex: '#22c55e' },
  { name: 'Blue', hex: '#2563eb' },
  { name: 'Indigo', hex: '#4f46e5' },
  { name: 'Teal', hex: '#0d9488' },
  { name: 'Amber', hex: '#d97706' },
  { name: 'Red', hex: '#dc2626' },
];

export const BrandingPage = () => {
  const isPlatform = !!useAuthStore((s) => s.user?.isPlatformAdmin);
  const { logoUrl, brandColor, set, setColor } = useBranding();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [color, setLocalColor] = useState(brandColor || DEFAULT_BRAND);

  // Live-preview the whole UI as the colour changes; persist only on Save.
  const preview = (hex: string) => { setLocalColor(hex); setColor(hex); };

  const saveColor = useMutation({
    mutationFn: (hex: string) => api<{ brandColor: string | null }>('/app-settings/color', { method: 'PUT', json: { brandColor: hex } }),
    onSuccess: (r) => { setColor(r.brandColor); setError(null); },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not save colour'),
  });
  const resetColor = useMutation({
    mutationFn: () => api<{ brandColor: null }>('/app-settings/color', { method: 'PUT', json: { brandColor: null } }),
    onSuccess: () => { setColor(null); setLocalColor(DEFAULT_BRAND); setError(null); },
  });

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

  // Normalise to a 512×512 PNG (transparent, contained) so it's a valid PWA
  // install icon on Android + iOS (iOS ignores SVG; Chrome wants a 512 png).
  const toIcon = (file: File) => new Promise<File>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('Canvas not supported')); return; }
      const scale = Math.min(size / (img.width || size), size / (img.height || size));
      const w = (img.width || size) * scale, h = (img.height || size) * scale;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Could not process image')); return; }
        resolve(new File([blob], 'logo.png', { type: 'image/png' }));
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the image')); };
    img.src = url;
  });

  const onPick = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { setError('Please choose an image file.'); return; }
    if (f.size > 4 * 1024 * 1024) { setError('Image must be under 4 MB.'); return; }
    setError(null);
    try {
      const icon = await toIcon(f);
      upload.mutate(icon);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not process the image');
    }
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

      {/* ── Brand colour ── */}
      <div className="card p-5 space-y-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand-600"><Palette className="h-4 w-4" /></span>
            Brand colour
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Sets the accent colour across the whole app <span className="text-slate-400">and</span> the Packing List / Testing Report PDFs.
            Each domain has its own — set this per website (e.g. green for Metflux, its logo colour for Toroflux).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="relative h-12 w-12 cursor-pointer overflow-hidden rounded-xl border border-slate-200 shadow-sm">
            <span className="absolute inset-0" style={{ backgroundColor: color }} />
            <input type="color" value={color} onChange={(e) => preview(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Hex</span>
            <input
              value={color}
              onChange={(e) => { const v = e.target.value; setLocalColor(v); if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) setColor(v); }}
              className="input h-9 w-28 font-mono text-sm"
              placeholder="#22c55e"
            />
          </div>
          <div className="ml-auto flex gap-2">
            <button onClick={() => resetColor.mutate()} disabled={resetColor.isPending} className="btn-ghost border border-slate-300 text-slate-600 hover:bg-slate-50">
              {resetColor.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Reset to green
            </button>
            <button onClick={() => saveColor.mutate(color)} disabled={saveColor.isPending || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)} className="btn-primary">
              {saveColor.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save colour
            </button>
          </div>
        </div>

        {/* Presets */}
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button key={p.hex} type="button" onClick={() => preview(p.hex)} title={p.name}
              className="flex items-center gap-1.5 rounded-full border border-slate-200 py-1 pl-1 pr-2.5 text-xs text-slate-600 hover:bg-slate-50">
              <span className="h-4 w-4 rounded-full" style={{ backgroundColor: p.hex }} />
              {p.name}
            </button>
          ))}
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Changing the swatch previews the theme live. Click <span className="font-medium">Save colour</span> to store it for this deployment — every user picks it up on their next load. {brandColor ? `Current saved colour: ${brandColor}.` : 'No custom colour saved yet (using default green).'}
        </div>
      </div>
    </div>
  );
};
