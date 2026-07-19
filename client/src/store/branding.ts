// Global webapp branding — the platform-wide logo shown on the login screen and
// sidebar, and used as the browser favicon. Fetched once (unauthenticated) on
// app start; updated live after an admin uploads/removes a logo.
import { create } from 'zustand';
import { api } from '@/lib/api';
import { applyBrandColor, hostBrandColor, brandColorFor } from '@/lib/brandColor';

type BrandingState = {
  logoUrl: string | null;
  brandColor: string | null;
  // The colour explicitly saved on the Branding page (global app-setting), if any.
  // Kept separate so company/host resolution can fall back to it.
  serverColor: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  set: (logoUrl: string | null) => void;
  setColor: (brandColor: string | null) => void;
  // Re-theme for the active company. Precedence: the company's own brand colour
  // (by name) → the saved Branding-page colour → the hostname default. So opening
  // TOROFLUX INDUSTRIES turns the whole UI blue even on the Metflux domain.
  applyForCompany: (companyName: string | null | undefined) => void;
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

export const useBranding = create<BrandingState>((set, get) => ({
  logoUrl: null,
  brandColor: null,
  serverColor: null,
  loaded: false,
  load: async () => {
    // Apply the per-domain colour immediately (brand is keyed by hostname), so
    // there's no flash of the default green before the network responds.
    const hostColor = hostBrandColor();
    applyBrandColor(hostColor);
    set({ brandColor: hostColor });
    try {
      const r = await api<{ logoUrl: string | null; brandColor: string | null }>('/public/app-branding');
      // A colour explicitly saved on the Branding page wins; otherwise keep the
      // hostname default (so each domain themes itself with no config).
      const color = r.brandColor ?? hostColor;
      set({ logoUrl: r.logoUrl, serverColor: r.brandColor ?? null, brandColor: color, loaded: true });
      applyFavicon(r.logoUrl);
      applyBrandColor(color);
    } catch {
      set({ loaded: true });
    }
  },
  set: (logoUrl) => {
    set({ logoUrl });
    applyFavicon(logoUrl);
  },
  setColor: (brandColor) => {
    set({ brandColor, serverColor: brandColor });
    applyBrandColor(brandColor);
  },
  applyForCompany: (companyName) => {
    const color = brandColorFor(companyName) ?? get().serverColor ?? hostBrandColor();
    set({ brandColor: color });
    applyBrandColor(color);
  },
}));
