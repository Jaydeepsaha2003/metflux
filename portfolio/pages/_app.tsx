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
import '../src/index.css';

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
