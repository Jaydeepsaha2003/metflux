// Custom Pages-Router _app. We deliberately don't ship a _document.tsx
// because Next.js 15 + Pages Router + `output: 'export'` has a known
// interaction that throws "<Html> should not be imported outside of
// pages/_document" during static generation when any custom _document is
// present (even an entirely standard one). Defaults from Next.js for the
// <html>/<body> structure are fine for a static marketing site — favicon
// and theme metadata move here via next/head.
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import PageWrapper from '@/components/PageWrapper';
import { BRAND } from '@/brand/brand.config';
import '../src/index.css';

// Brand-override CSS — injected into <Head> below. The default values in
// index.css are Metflux's, so we only emit overrides for non-default brands.
// This is the static-export-safe alternative to a <html data-brand="..."> on
// _document.tsx (which Next 15 + export doesn't support cleanly).
const BRAND_OVERRIDE_CSS: Record<string, string> = {
  toroflux: `:root{--primary:223 90% 48%;--ring:223 90% 48%;--brand-accent-hex:#0f50e5}.dark{--primary:223 90% 48%}`,
};

export default function App({ Component, pageProps }: AppProps) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Head>
          {/* Favicons + theme color — was in _document.tsx; moved here so we
              can drop _document and dodge the static-export bug. */}
          <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
          <link rel="icon" type="image/x-icon" href="/favicon.ico" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
          <meta name="theme-color" content="#010101" />
          {/* Brand CSS override — emitted into the static HTML head only when
              the active brand isn't Metflux (the default in index.css). */}
          {BRAND_OVERRIDE_CSS[BRAND] && (
            <style dangerouslySetInnerHTML={{ __html: BRAND_OVERRIDE_CSS[BRAND] }} />
          )}
        </Head>
        <Toaster />
        <Sonner />
        <PageWrapper>
          <Component {...pageProps} />
        </PageWrapper>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
