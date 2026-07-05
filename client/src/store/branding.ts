// Global webapp branding — the platform-wide logo shown on the login screen and
// sidebar, and used as the browser favicon. Fetched once (unauthenticated) on
// app start; updated live after an admin uploads/removes a logo.
import { create } from 'zustand';
import { api } from '@/lib/api';

type BrandingState = {
  logoUrl: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  set: (logoUrl: string | null) => void;
};

// Point the browser tab favicon at the uploaded logo (data URL) when present.
const applyFavicon = (logoUrl: string | null) => {
  if (!logoUrl) return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = logoUrl.startsWith('data:image/svg') ? 'image/svg+xml' : 'image/png';
  link.href = logoUrl;
};

export const useBranding = create<BrandingState>((set) => ({
  logoUrl: null,
  loaded: false,
  load: async () => {
    try {
      const r = await api<{ logoUrl: string | null }>('/public/app-branding');
      set({ logoUrl: r.logoUrl, loaded: true });
      applyFavicon(r.logoUrl);
    } catch {
      set({ loaded: true });
    }
  },
  set: (logoUrl) => {
    set({ logoUrl });
    applyFavicon(logoUrl);
  },
}));
