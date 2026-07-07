import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, ChevronsUpDown, ShieldCheck, Star } from 'lucide-react';

const CompanyAvatar = ({ name, logoUrl, size = 'md' }: { name?: string; logoUrl?: string | null; size?: 'sm' | 'md' }) => {
  const cls = size === 'sm' ? 'h-6 w-6 rounded-md' : 'h-7 w-7 rounded-md';
  if (logoUrl) {
    return <img src={logoUrl} alt={name} className={`${cls} object-contain bg-white p-0.5`} />;
  }
  return (
    <div className={`${cls} grid place-items-center bg-brand-500/20 text-brand-300`}>
      <Building2 className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
    </div>
  );
};
import { useAuthStore, type LoginPayload } from '@/store/auth';
import { api } from '@/lib/api';
import { getDomainCompany, setDomainCompany } from '@/lib/domainCompany';
import { cn } from '@/lib/cn';

// Sidebar control that shows the active company and lets the user switch
// between every company they're a member of (or any company, if platform admin).
export const CompanySwitcher = () => {
  const { user, memberships, activeCompanyId, setSession } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [defaultCompany, setDefaultCompany] = useState<string | null>(getDomainCompany());

  const toggleDefault = (companyId: string) => {
    const next = defaultCompany === companyId ? null : companyId;
    setDomainCompany(next);
    setDefaultCompany(next);
  };
  const host = typeof window !== 'undefined' ? window.location.hostname : 'this site';
  const queryClient = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const active = memberships.find((m) => m.companyId === activeCompanyId);

  // Platform admins can step into ANY company even without a membership, so
  // we also fetch the full company list for them and merge it into the picker.
  const { data: allCompaniesResp } = useQuery({
    queryKey: ['companies', 'switcher'],
    queryFn: () => api<{ items: { id: string; name: string; logoUrl: string | null }[] }>('/companies'),
    enabled: !!user?.isPlatformAdmin,
    staleTime: 60_000,
  });

  const otherCompanies = (allCompaniesResp?.items ?? [])
    .filter((c) => !memberships.some((m) => m.companyId === c.id));

  // If the active company isn't in the user's memberships (platform admin
  // stepping in), look it up in the all-companies list — different shape so
  // we resolve name/logoUrl per branch rather than via a single union.
  const steppedInto = active
    ? null
    : (otherCompanies.find((c) => c.id === activeCompanyId) ?? null);
  const activeName    = active?.companyName    ?? steppedInto?.name    ?? null;
  const activeLogoUrl = active?.companyLogoUrl ?? steppedInto?.logoUrl ?? null;

  const switchTo = async (companyId: string) => {
    if (companyId === activeCompanyId) {
      setOpen(false);
      return;
    }
    setBusyId(companyId);
    try {
      const data = await api<LoginPayload>('/auth/switch-company', {
        method: 'POST',
        json: { companyId },
      });
      setSession(data);
      // Remember this choice for this domain so a page refresh keeps the same
      // company selected instead of falling back to the primary one.
      setDomainCompany(companyId);
      // Force every cached query to refetch with the new tenant context.
      queryClient.invalidateQueries();
      setOpen(false);
    } finally {
      setBusyId(null);
    }
  };

  // Only one membership and not a platform admin: render a static label.
  if (memberships.length <= 1 && !user?.isPlatformAdmin) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
        <CompanyAvatar name={activeName ?? undefined} logoUrl={activeLogoUrl} />
        <div className="min-w-0">
          <div className="truncate font-medium text-white">{activeName ?? '—'}</div>
          <div className="truncate text-[11px] text-white/50">{active?.role ?? ''}</div>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-sm transition hover:bg-white/10"
      >
        <CompanyAvatar name={activeName ?? undefined} logoUrl={activeLogoUrl} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-white">{activeName ?? 'Pick a company'}</div>
          <div className="truncate text-[11px] text-white/50">
            {active?.role ?? (user?.isPlatformAdmin ? 'Platform admin' : '—')}
          </div>
        </div>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-white/40" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-lg border border-ink-700 bg-ink-800 shadow-2xl animate-fade-up">
          {memberships.length > 0 && (
            <>
              <div className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-white/40">
                Your companies
              </div>
              <ul className="max-h-60 overflow-y-auto pb-1">
                {memberships.map((m) => (
                  <li key={m.companyId} className="flex items-center">
                    <button
                      type="button"
                      onClick={() => switchTo(m.companyId)}
                      disabled={busyId !== null}
                      className={cn(
                        'flex flex-1 min-w-0 items-center gap-2.5 px-3 py-2 text-left text-sm transition',
                        m.companyId === activeCompanyId
                          ? 'bg-white/5 text-white'
                          : 'text-white/80 hover:bg-white/5 hover:text-white'
                      )}
                    >
                      <CompanyAvatar name={m.companyName} logoUrl={m.companyLogoUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{m.companyName}</div>
                        <div className="truncate text-[11px] text-white/50">{m.role}</div>
                      </div>
                      {m.companyId === activeCompanyId && <Check className="h-4 w-4 text-brand-400" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleDefault(m.companyId)}
                      title={defaultCompany === m.companyId ? `Default on ${host}` : `Set as default on ${host}`}
                      className="shrink-0 px-2.5 py-2 text-white/30 hover:text-white/70"
                    >
                      <Star className={cn('h-4 w-4', defaultCompany === m.companyId && 'fill-amber-400 text-amber-400')} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {user?.isPlatformAdmin && otherCompanies.length > 0 && (
            <>
              <div className="border-t border-white/5 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-white/40 flex items-center gap-1.5">
                <ShieldCheck className="h-3 w-3" />
                Step in as platform admin
              </div>
              <ul className="max-h-60 overflow-y-auto pb-1">
                {otherCompanies.map((c) => (
                  <li key={c.id} className="flex items-center">
                    <button
                      type="button"
                      onClick={() => switchTo(c.id)}
                      disabled={busyId !== null}
                      className={cn(
                        'flex flex-1 min-w-0 items-center gap-2.5 px-3 py-2 text-left text-sm transition',
                        c.id === activeCompanyId
                          ? 'bg-white/5 text-white'
                          : 'text-white/80 hover:bg-white/5 hover:text-white'
                      )}
                    >
                      <CompanyAvatar name={c.name} logoUrl={c.logoUrl} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{c.name}</div>
                        <div className="truncate text-[11px] text-white/50">No membership · admin access</div>
                      </div>
                      {c.id === activeCompanyId && <Check className="h-4 w-4 text-brand-400" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleDefault(c.id)}
                      title={defaultCompany === c.id ? `Default on ${host}` : `Set as default on ${host}`}
                      className="shrink-0 px-2.5 py-2 text-white/30 hover:text-white/70"
                    >
                      <Star className={cn('h-4 w-4', defaultCompany === c.id && 'fill-amber-400 text-amber-400')} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="border-t border-white/5 px-3 py-2 text-[10.5px] leading-snug text-white/40">
            <Star className="inline h-3 w-3 -mt-0.5 mr-1 fill-amber-400 text-amber-400" />
            Starred company opens by default on <span className="text-white/60">{host}</span> (and stays selected on refresh).
          </div>

          {user?.isPlatformAdmin && memberships.length === 0 && otherCompanies.length === 0 && (
            <div className="px-3 py-4 text-center text-[12px] text-white/50">
              No companies yet —{' '}
              <a href="/settings/companies/new" className="text-brand-400 underline">create one</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
