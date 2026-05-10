import type { AppProps } from 'next/app'
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from 'react';
import PageWrapper from "@/components/PageWrapper";
import '../src/index.css'

export default function App({ Component, pageProps }: AppProps) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <PageWrapper>
          <Component {...pageProps} />
        </PageWrapper>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
