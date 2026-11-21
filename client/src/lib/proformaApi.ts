// What every proforma screen needs besides the invoice itself: the company's saved
// exporter / bank / terms, and the company's name and logo. One place, so the form,
// the register's download button and the settings page agree on what "empty" means.
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DEFAULT_TERMS } from './proformaLists';
import { downloadProformaXlsx, type PiSettings } from './proformaXlsx';
import { downloadProformaPdf } from './proformaPdf';
import { useBranding } from '@/store/branding';
import { brandColorFor } from '@/lib/brandColor';
import { fromRecord, type PiForm } from './proforma';

type Company = { name: string; logoUrl: string | null; address: string | null; phone: string | null; email: string | null; gstNumber: string | null };

/** A company that has never saved PI settings starts from the standard terms, and from
 *  the contact details it already keeps on its company record. */
export const withDefaults = (s: PiSettings, c?: Company | null): PiSettings => ({
  ...s,
  address: s.address || c?.address?.replace(/\n+/g, ', ') || '',
  phone: s.phone || c?.phone || '',
  email: s.email || c?.email || '',
  gstin: s.gstin || c?.gstNumber || '',
  // GSTIN characters 3–12 are the PAN, and an exporter's IEC is normally the same.
  pan: s.pan || (c?.gstNumber ? c.gstNumber.slice(2, 12) : ''),
  terms: s.terms.length ? s.terms : DEFAULT_TERMS,
});

export const usePiSettings = () => {
  const settings = useQuery({ queryKey: ['company-settings', 'proforma'], queryFn: () => api<PiSettings>('/company-settings/proforma') });
  const company = useQuery({ queryKey: ['company-me'], queryFn: () => api<Company | null>('/companies/me') });
  return {
    settings: settings.data ? withDefaults(settings.data, company.data) : null,
    company: company.data ?? null,
    ready: !!settings.data && company.data !== undefined,
  };
};

type Rec = Parameters<typeof fromRecord>[0] & { id: string };

/** The PDF takes the colour of the company it is for, as every other PDF does. */
const brandOf = (name?: string | null) => brandColorFor(name) ?? useBranding.getState().brandColor;

/** Download a saved PI as Excel or PDF: fetch the record, the settings and the company, build. */
export const downloadSavedPi = async (id: string, kind: 'xlsx' | 'pdf' = 'xlsx') => {
  const [rec, saved, company] = await Promise.all([
    api<Rec>(`/proforma-invoices/${id}`),
    api<PiSettings>('/company-settings/proforma'),
    api<Company | null>('/companies/me'),
  ]);
  const who = { name: company?.name ?? 'Company', logoUrl: company?.logoUrl };
  if (kind === 'pdf') await downloadProformaPdf(fromRecord(rec), withDefaults(saved, company), who, brandOf(company?.name));
  else await downloadProformaXlsx(fromRecord(rec), withDefaults(saved, company), who);
};

export const downloadPiForm = async (pi: PiForm, settings: PiSettings, company: Company | null, kind: 'xlsx' | 'pdf' = 'xlsx') => {
  const who = { name: company?.name ?? 'Company', logoUrl: company?.logoUrl };
  return kind === 'pdf' ? downloadProformaPdf(pi, settings, who, brandOf(company?.name)) : downloadProformaXlsx(pi, settings, who);
};
