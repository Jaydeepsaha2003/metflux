import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import { App } from './App';

// Auto-open native <select> dropdowns when focused (Tab key UX).
// Browsers don't open <select> on focus by default — user has to click or press
// Space/Alt+Down. showPicker() is the standards API for forcing it open and is
// supported in Chrome/Edge 113+, Firefox 122+, Safari 17+. The try/catch
// silently swallows InvalidStateError on older browsers and on programmatic
// focus events (which aren't a user gesture).
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (el instanceof HTMLSelectElement && !el.disabled) {
    try { el.showPicker?.(); } catch { /* unsupported or non-gesture focus */ }
  }
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/s/admin">
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
