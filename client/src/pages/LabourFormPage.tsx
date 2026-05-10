import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Loader2, Users2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

type Company = { id: string; name: string };
type Labour = {
  id: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  companies: { company: Company }[];
};

export const LabourFormPage = () => {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [error, setError] = useState<{ message: string; details?: string[] } | null>(null);

  // Pull company list from the auth store — no extra API call needed.
  const memberships = useAuthStore((s) => s.memberships);
  const companies: Company[] = memberships.map((m) => ({ id: m.companyId, name: m.companyName }));

  const { data: labour } = useQuery({
    queryKey: ['labour', id],
    queryFn: () => api<Labour>(`/labours/${id}`),
    enabled: isEdit,
  });

  useEffect(() => {
    if (!labour) return;
    setName(labour.name);
    setPhone(labour.phone ?? '');
    setIsActive(labour.isActive);
    setSelectedCompanies(labour.companies.map((c) => c.company.id));
  }, [labour]);

  const save = useMutation({
    mutationFn: (body: unknown) =>
      isEdit
        ? api(`/labours/${id}`, { method: 'PATCH', json: body })
        : api('/labours', { method: 'POST', json: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['labours'] });
      queryClient.invalidateQueries({ queryKey: ['labour', id] });
      navigate('/settings/labours');
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        const d = (e.details ?? {}) as { fieldErrors?: Record<string, string[]>; formErrors?: string[] };
        const lines: string[] = [];
        for (const [field, msgs] of Object.entries(d.fieldErrors ?? {})) {
          for (const m of msgs ?? []) lines.push(`${field}: ${m}`);
        }
        for (const m of d.formErrors ?? []) lines.push(m);
        setError({ message: e.message, details: lines.length ? lines : undefined });
      } else {
        setError({ message: 'Save failed' });
      }
    },
  });

  const onSave = () => {
    setError(null);
    const missing: string[] = [];
    if (!name.trim()) missing.push('Name is required');
    if (selectedCompanies.length === 0) missing.push('Assign to at least one company');
    if (missing.length) {
      setError({ message: 'Please fix the form', details: missing });
      return;
    }
    save.mutate({
      name: name.trim(),
      phone: phone.trim() || null,
      isActive,
      companyIds: selectedCompanies,
    });
  };

  const toggleCompany = (cid: string) => {
    setSelectedCompanies((prev) =>
      prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid]
    );
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link to="/settings/labours" className="btn-ghost text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Users2 className="h-5 w-5 text-brand-600" /> {isEdit ? 'Edit Worker' : 'Add Worker'}
        </h1>
      </div>

      <section className="card p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block col-span-2 sm:col-span-1">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Name *</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value.toUpperCase())} placeholder="WORKER NAME" />
          </label>
          <label className="block col-span-2 sm:col-span-1">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Phone</span>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
          </label>
        </div>

        <div>
          <span className="mb-2 block text-[11px] font-medium uppercase tracking-wide text-slate-500">Assign to Companies *</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {companies.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                  checked={selectedCompanies.includes(c.id)}
                  onChange={() => toggleCompany(c.id)}
                />
                <span className="text-sm font-medium">{c.name}</span>
              </label>
            ))}
          </div>
        </div>

        {isEdit && (
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 accent-brand-600"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span className="text-sm font-medium">Active</span>
          </label>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <div className="font-medium">{error.message}</div>
            {error.details && (
              <ul className="mt-1 list-disc pl-5 text-xs">
                {error.details.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Link to="/settings/labours" className="btn-ghost">Cancel</Link>
          <button onClick={onSave} disabled={save.isPending} className="btn-primary">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isEdit ? 'Save changes' : 'Add worker'}
          </button>
        </div>
      </section>
    </div>
  );
};
