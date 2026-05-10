// Generic "this module is coming soon" page used for routes whose UI hasn't
// been ported yet. Once a real page is built, replace its route in App.tsx.
import { Construction } from 'lucide-react';

export const PlaceholderPage = ({ title, blurb }: { title: string; blurb?: string }) => (
  <div className="flex min-h-[60vh] items-center justify-center">
    <div className="card max-w-md p-8 text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">
        <Construction className="h-6 w-6" />
      </div>
      <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">
        {blurb ?? 'This module is on the roadmap. The route, sidebar entry and permissions are wired — the screen itself will land in a follow-up turn.'}
      </p>
    </div>
  </div>
);
