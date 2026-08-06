// Public (no-login) e-copy of a Lorry Receipt — opened by scanning the QR on a
// printed LR. Reached at /lr/view/:token OUTSIDE the auth guard. Because it is a
// public page, data is fetched with a PLAIN fetch (never the authed api() helper,
// which can redirect on 401) — mirroring CustomerPortalPage's approach.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle, Printer, Download, Truck, MapPin, Phone, Mail } from 'lucide-react';
import QRCode from 'qrcode';
import { type LorryReceipt, inrLR } from '@/lib/lr';
import { downloadLrPdf, type LrPdf } from '@/lib/reportPdf';

/* ── API shape ──────────────────────────────────────────────── */
type Transporter = {
  name: string; tagline?: string | null; address?: string | null;
  phone?: string | null; email?: string | null; gstin?: string | null; logo?: string | null;
};
type Company = {
  name?: string; address?: string; phone?: string; gstNumber?: string; logoUrl?: string;
};
type LrPublicData = {
  lr: LorryReceipt;
  transporter: Transporter | null;
  company: Company | null;
};

/* ── Helpers ────────────────────────────────────────────────── */
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
};

/* Coloured payment stamp — TO-PAY amber / PAID green / TBB slate. */
const PAY_STAMP: Record<string, string> = {
  'TO-PAY': 'border-amber-400 text-amber-600 bg-amber-50',
  PAID: 'border-emerald-500 text-emerald-600 bg-emerald-50',
  TBB: 'border-slate-400 text-slate-600 bg-slate-50',
};

/* Small uppercase label. */
const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{children}</div>
);

/* A single charge row (only rendered by caller when non-zero / relevant). */
const ChargeRow = ({ label, amount }: { label: string; amount: number }) => (
  <div className="flex items-center justify-between py-1 text-[12px]">
    <span className="text-slate-600">{label}</span>
    <span className="tabular-nums font-medium text-slate-800">₹{inrLR(amount)}</span>
  </div>
);

/* Party (consignor / consignee) card. */
const PartyCard = ({
  title, name, address, gstin, mobile,
}: {
  title: string; name: string; address: string | null; gstin: string | null; mobile: string | null;
}) => (
  <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
    <Label>{title}</Label>
    <div className="mt-1 text-[14px] font-bold leading-tight text-slate-900">{name || '—'}</div>
    {address && <div className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-slate-600">{address}</div>}
    <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
      {gstin && <div>GSTIN: <span className="font-mono">{gstin}</span></div>}
      {mobile && <div className="flex items-center gap-1"><Phone className="h-3 w-3" />{mobile}</div>}
    </div>
  </div>
);

/* Simple field pair (label over value). */
const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div>
    <Label>{label}</Label>
    <div className="mt-0.5 text-[13px] font-medium text-slate-800">{value || '—'}</div>
  </div>
);

/* ── Loading / not-found states ─────────────────────────────── */
const Centered = ({ children }: { children: React.ReactNode }) => (
  <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">{children}</div>
);

/* ── Page ───────────────────────────────────────────────────── */
export const LrPublicViewPage = () => {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, isError } = useQuery<LrPublicData>({
    queryKey: ['public-lr', token],
    queryFn: async () => {
      const res = await fetch(`/api/public/lr/${token}`);
      if (!res.ok) throw new Error('Lorry Receipt not found');
      return res.json();
    },
    enabled: !!token,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const [busy, setBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState('');

  if (isLoading) {
    return (
      <Centered>
        <div className="space-y-3 text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-slate-500" />
          <p className="text-sm font-medium text-slate-500">Loading Lorry Receipt…</p>
        </div>
      </Centered>
    );
  }

  if (isError || !data?.lr) {
    return (
      <Centered>
        <div className="w-full max-w-sm space-y-3 rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50">
            <AlertCircle className="h-7 w-7 text-red-400" />
          </div>
          <h1 className="text-lg font-bold text-slate-900">Lorry Receipt not found</h1>
          <p className="text-sm text-slate-500">This link may be invalid or expired.</p>
        </div>
      </Centered>
    );
  }

  const { lr, transporter, company } = data;
  const head = {
    name: transporter?.name || company?.name || 'Lorry Receipt',
    tagline: transporter?.tagline || null,
    address: transporter?.address || company?.address || null,
    phone: transporter?.phone || company?.phone || null,
    email: transporter?.email || null,
    gstin: transporter?.gstin || company?.gstNumber || null,
    logo: transporter?.logo || company?.logoUrl || null,
  };
  const stamp = PAY_STAMP[lr.paymentMode] ?? PAY_STAMP.TBB;
  const freightBase = Number(lr.chargedWt || 0) * Number(lr.rate || 0);

  // Same charge rows shown below (ChargeRow) — reused for the downloadable PDF.
  const chargeRows: { label: string; hint?: string; value: number }[] = [
    { label: 'Freight', hint: `${inrLR(lr.chargedWt)} × ${inrLR(lr.rate)}`, value: freightBase },
  ];
  if (lr.stCh) chargeRows.push({ label: 'ST Charge', value: lr.stCh });
  if (lr.hamali) chargeRows.push({ label: 'Hamali', value: lr.hamali });
  if (lr.otherCh) chargeRows.push({ label: 'Other', value: lr.otherCh });
  if (lr.ddCh) chargeRows.push({ label: 'D/D Charge', value: lr.ddCh });
  if (lr.riskFovAmount) chargeRows.push({ label: 'Risk/FOV', hint: lr.riskFovPct ? `@ ${lr.riskFovPct}%` : undefined, value: lr.riskFovAmount });

  // Filename mirrors the app's convention: "LR-<lrNo>-<party name>.pdf".
  const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').trim();
  const fileName = () => `LR-${sanitize(lr.lrNo || 'Draft')}-${sanitize(lr.consigneeName || 'Party')}`;

  const onDownload = async () => {
    setPdfErr(''); setBusy(true);
    try {
      const ecopyUrl = lr.publicToken ? `${window.location.origin}/s/admin/lr/view/${lr.publicToken}` : '';
      const qrDataUrl = ecopyUrl
        ? await QRCode.toDataURL(ecopyUrl, { width: 240, margin: 0, color: { dark: '#0f172a', light: '#ffffff' } })
        : undefined;
      const data: LrPdf = {
        copyLabel: 'e-Copy',
        head: { name: head.name, tagline: head.tagline ?? undefined, address: head.address ?? undefined, phone: head.phone ?? undefined, email: head.email ?? undefined, gstin: head.gstin ?? undefined, logo: head.logo ?? undefined },
        lrNo: lr.lrNo, lrDate: fmtDate(lr.lrDate), paymentMode: lr.paymentMode,
        consignor: { name: lr.consignorName, address: lr.consignorAddress ?? undefined, gstin: lr.consignorGstin ?? undefined, mobile: lr.consignorMobile ?? undefined },
        consignee: { name: lr.consigneeName, address: lr.consigneeAddress ?? undefined, gstin: lr.consigneeGstin ?? undefined, mobile: lr.consigneeMobile ?? undefined },
        fromLoc: lr.fromLoc ?? '', toLoc: lr.toLoc ?? '', modeOfDispatch: lr.modeOfDispatch ?? '', vehNo: lr.vehNo ?? '',
        goods: { packages: String(lr.packages), packMethod: lr.packMethod ?? '', particular: lr.particular ?? '', actualWt: inrLR(lr.actualWt), chargedWt: inrLR(lr.chargedWt) },
        charges: chargeRows.map((c) => ({ label: c.label, hint: c.hint, value: inrLR(c.value) })),
        total: `₹${inrLR(lr.totalValue)}`,
        documents: {
          invNo: [lr.invNo, lr.invDate ? fmtDate(lr.invDate) : ''].filter(Boolean).join(' · '),
          ewayBillNo: lr.ewayBillNo ?? '', valueDeclare: `₹${inrLR(lr.valueDeclare)}`,
        },
        remark: lr.remark ?? undefined,
        qrDataUrl,
      };
      await downloadLrPdf(data, `${fileName()}.pdf`);
    } catch (e) {
      setPdfErr(e instanceof Error ? e.message : 'Failed to generate the PDF');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100">
      {/* @page margin is 0 on purpose — with any margin set, the browser draws its
          own header/footer (date, title, URL, page count) into that space. Zero
          margin leaves no room for it, so it disappears without the visitor having
          to untick "Headers and footers" in the print dialog. The visual margin is
          recreated as padding on the content wrapper instead (print:p-[10mm]). */}
      <style>{`@media print {
        @page { margin: 0; }
        html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
      }`}</style>

      <div className="mx-auto max-w-[720px] p-3 sm:p-5 print:max-w-none print:p-[10mm]">
        {/* Print / download buttons (hidden on print). */}
        <div className="mb-3 flex justify-end gap-2 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>
          <button
            type="button"
            onClick={onDownload}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download PDF
          </button>
        </div>
        {pdfErr && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 print:hidden">{pdfErr}</div>
        )}

        {/* Document */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none">
          {/* Letterhead */}
          <div className="flex items-start gap-3 border-b border-slate-200 p-4 sm:p-5">
            {head.logo && (
              <img src={head.logo} alt={head.name} className="max-h-16 w-auto shrink-0 object-contain" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[18px] font-black leading-tight text-slate-900 sm:text-[20px]">{head.name}</div>
              {head.tagline && <div className="text-[12px] font-medium text-slate-500">{head.tagline}</div>}
              {head.address && (
                <div className="mt-1 flex items-start gap-1 text-[11px] leading-relaxed text-slate-500">
                  <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                  <span className="whitespace-pre-line">{head.address}</span>
                </div>
              )}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                {head.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{head.phone}</span>}
                {head.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{head.email}</span>}
                {head.gstin && <span>GSTIN: <span className="font-mono">{head.gstin}</span></span>}
              </div>
            </div>
          </div>

          {/* Header row: title + LR No / Date + payment stamp */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/60 p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <Truck className="h-6 w-6 text-slate-700" />
              <div>
                <div className="text-[20px] font-black uppercase leading-none tracking-tight text-slate-900 sm:text-[24px]">
                  Lorry Receipt
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 text-[12px] text-slate-600">
                  <span>LR No: <span className="font-bold text-slate-900">{lr.lrNo}</span></span>
                  <span>Date: <span className="font-bold text-slate-900">{fmtDate(lr.lrDate)}</span></span>
                </div>
              </div>
            </div>
            <div className={`rounded-md border-2 px-3 py-1 text-[14px] font-black uppercase tracking-wide ${stamp}`}>
              {lr.paymentMode}
            </div>
          </div>

          {/* Consignor / Consignee */}
          <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
            <PartyCard
              title="Consignor"
              name={lr.consignorName}
              address={lr.consignorAddress}
              gstin={lr.consignorGstin}
              mobile={lr.consignorMobile}
            />
            <PartyCard
              title="Consignee"
              name={lr.consigneeName}
              address={lr.consigneeAddress}
              gstin={lr.consigneeGstin}
              mobile={lr.consigneeMobile}
            />
          </div>

          {/* Route / dispatch */}
          <div className="grid grid-cols-2 gap-3 border-t border-slate-200 p-4 sm:grid-cols-4 sm:p-5">
            <Field label="From" value={lr.fromLoc} />
            <Field label="To" value={lr.toLoc} />
            <Field label="Mode of Dispatch" value={lr.modeOfDispatch} />
            <Field label="Vehicle No." value={lr.vehNo} />
          </div>

          {/* Goods */}
          <div className="grid grid-cols-2 gap-3 border-t border-slate-200 p-4 sm:grid-cols-3 sm:p-5">
            <Field label="Packages" value={lr.packages} />
            <Field label="Method" value={lr.packMethod} />
            <Field label="Particulars" value={lr.particular} />
            <Field label="Actual Wt" value={lr.actualWt ? `${lr.actualWt} kg` : '—'} />
            <Field label="Charged Wt" value={lr.chargedWt ? `${lr.chargedWt} kg` : '—'} />
          </div>

          {/* Charges */}
          <div className="border-t border-slate-200 p-4 sm:p-5">
            <Label>Freight Charges</Label>
            <div className="mt-2 divide-y divide-slate-100">
              <ChargeRow label={`Freight (${lr.chargedWt || 0} × ${lr.rate || 0})`} amount={freightBase} />
              {lr.stCh > 0 && <ChargeRow label="ST Charge" amount={lr.stCh} />}
              {lr.hamali > 0 && <ChargeRow label="Hamali" amount={lr.hamali} />}
              {lr.otherCh > 0 && <ChargeRow label="Other" amount={lr.otherCh} />}
              {lr.ddCh > 0 && <ChargeRow label="D/D" amount={lr.ddCh} />}
              {lr.riskFovAmount > 0 && (
                <ChargeRow label={`Risk / FOV (${lr.riskFovPct}%)`} amount={lr.riskFovAmount} />
              )}
            </div>
            <div className="mt-2 flex items-center justify-between border-t-2 border-slate-800 pt-2">
              <span className="text-[13px] font-bold uppercase tracking-wide text-slate-800">Total</span>
              <span className="text-[16px] font-black tabular-nums text-slate-900">₹{inrLR(lr.totalValue)}</span>
            </div>
          </div>

          {/* Documents */}
          <div className="grid grid-cols-2 gap-3 border-t border-slate-200 p-4 sm:grid-cols-4 sm:p-5">
            <Field label="Invoice No" value={lr.invNo} />
            <Field label="Invoice Date" value={lr.invDate ? fmtDate(lr.invDate) : '—'} />
            <Field label="E-Way Bill No" value={lr.ewayBillNo} />
            <Field label="Declared Value" value={`₹${inrLR(lr.valueDeclare)}`} />
          </div>

          {/* Remark */}
          {lr.remark && (
            <div className="border-t border-slate-200 p-4 sm:p-5">
              <Label>Remark</Label>
              <div className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-slate-600">{lr.remark}</div>
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-slate-200 bg-slate-50/60 p-4 text-center sm:p-5">
            <p className="text-[11px] font-medium text-slate-500">Goods carried at owner's risk.</p>
            <p className="mt-0.5 text-[10px] text-slate-400">e-copy · generated by {head.name}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LrPublicViewPage;
