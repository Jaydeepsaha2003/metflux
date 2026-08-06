// Lorry Receipt (LR / transport consignment note) — printable / PDF document.
//
// A dense, Tally-style bordered consignment note:
//   Transporter letterhead (active company) + boxed "LORRY RECEIPT" title
//   Consignor / Consignee boxes + From→To / dispatch / vehicle row
//   Goods table + freight/charges table
//   Documents row (Invoice / E-Way / Declared value)
//   Remark + signature footer
//
// Company source mirrors QuotationPrintPage: api<CompanyMe>('/companies/me').
// Print via window.print(); toolbar hidden on print.
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer, Download, ArrowLeft, Pencil, Loader2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import QRCode from 'qrcode';
import { api } from '@/lib/api';
import { type LorryReceipt, type LrTransporter, inrLR } from '@/lib/lr';
import { downloadLrPdf, printLrPdf, type LrPdf } from '@/lib/reportPdf';

type CompanyMe = {
  name: string; address: string | null; phone: string | null; whatsappNumber?: string | null;
  email?: string | null; gstNumber: string | null; logoUrl: string | null;
};

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// A charge row for the freight table; only rendered when the value is non-zero
// (except the freight base, which always shows).
const ChargeRow = ({ label, hint, value, always }: { label: string; hint?: string; value: number; always?: boolean }) => {
  if (!always && !value) return null;
  return (
    <tr className="border-b border-slate-300">
      <td className="px-2 py-1 border-r border-slate-300">
        <span className="uppercase text-[10px] tracking-wide text-slate-600 font-semibold">{label}</span>
        {hint && <span className="ml-1 text-[10px] text-slate-400">{hint}</span>}
      </td>
      <td className="px-2 py-1 text-right tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>{inrLR(value)}</td>
    </tr>
  );
};

export const LorryReceiptPrintPage = () => {
  const { id } = useParams();

  const { data: lr, isLoading } = useQuery({
    queryKey: ['lorry-receipt-print', id],
    queryFn: () => api<LorryReceipt>(`/lorry-receipts/${id}`),
    enabled: !!id,
  });
  const { data: company } = useQuery({
    queryKey: ['company-me'],
    queryFn: () => api<CompanyMe>('/companies/me'),
  });
  const { data: transporters } = useQuery({
    queryKey: ['lr-transporters'],
    queryFn: () => api<{ items: LrTransporter[] }>('/lorry-receipts/transporters'),
  });
  const [busy, setBusy] = useState<'download' | 'print' | null>(null);
  const [pdfErr, setPdfErr] = useState('');

  if (isLoading) {
    return <div className="card p-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></div>;
  }
  if (!lr) {
    return <div className="card p-10 text-center text-slate-400">Lorry Receipt not found.</div>;
  }

  // Letterhead source: the LR's chosen transporter → the default transporter →
  // fall back to the active company. `head` is a normalised shape either way.
  const list = transporters?.items ?? [];
  const picked =
    list.find((t) => t.id === lr.transporterId) ??
    list.find((t) => !!t.isDefault) ??
    null;
  const head = picked
    ? {
        name: picked.name,
        tagline: picked.tagline ?? undefined,
        address: picked.address ?? undefined,
        phone: picked.phone ?? undefined,
        email: picked.email ?? undefined,
        gstin: picked.gstin ?? undefined,
        logo: picked.logo ?? undefined,
      }
    : {
        name: company?.name ?? 'Transporter Name',
        tagline: undefined as string | undefined,
        address: company?.address ?? undefined,
        phone: company?.phone ?? undefined,
        email: company?.email ?? undefined,
        gstin: company?.gstNumber ?? undefined,
        logo: company?.logoUrl ?? undefined,
      };

  const freightBase = (Number(lr.chargedWt) || 0) * (Number(lr.rate) || 0);
  const payMode = lr.paymentMode;
  // Scannable e-copy URL (public, no login) — encoded in the QR on the LR.
  const ecopyUrl = lr.publicToken ? `${window.location.origin}/s/admin/lr/view/${lr.publicToken}` : '';
  // Colour the payment stamp: amber for TO-PAY, green for PAID, slate for TBB.
  const stampCls =
    payMode === 'PAID' ? 'border-emerald-600 text-emerald-700 bg-emerald-50'
    : payMode === 'TO-PAY' ? 'border-amber-600 text-amber-700 bg-amber-50'
    : 'border-slate-600 text-slate-700 bg-slate-50';

  // Same charge rows shown on-screen (ChargeRow below) — Freight always,
  // the rest only when non-zero — reused for the downloadable PDF.
  const chargeRows: { label: string; hint?: string; value: number }[] = [
    { label: 'Freight', hint: `${inrLR(lr.chargedWt)} × ${inrLR(lr.rate)}`, value: freightBase },
  ];
  if (lr.stCh) chargeRows.push({ label: 'ST Charge', value: lr.stCh });
  if (lr.hamali) chargeRows.push({ label: 'Hamali', value: lr.hamali });
  if (lr.otherCh) chargeRows.push({ label: 'Other', value: lr.otherCh });
  if (lr.ddCh) chargeRows.push({ label: 'D/D Charge', value: lr.ddCh });
  if (lr.riskFovAmount) chargeRows.push({ label: 'Risk/FOV', hint: lr.riskFovPct ? `@ ${lr.riskFovPct}%` : undefined, value: lr.riskFovAmount });

  // Filename mirrors the app's convention (illegal characters → "-") plus the
  // party name, e.g. "LR-BL-0073-WELLMAN POWER PVT LTD.pdf".
  const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-').trim();
  const fileName = () => `LR-${sanitize(lr.lrNo || 'Draft')}-${sanitize(lr.consigneeName || 'Party')}`;

  const buildPdfData = async (): Promise<LrPdf> => {
    const qrDataUrl = ecopyUrl
      ? await QRCode.toDataURL(ecopyUrl, { width: 240, margin: 0, color: { dark: '#0f172a', light: '#ffffff' } })
      : undefined;
    return {
      copyLabel: 'Consignor Copy',
      head: { name: head.name, tagline: head.tagline, address: head.address, phone: head.phone, email: head.email, gstin: head.gstin, logo: head.logo ?? undefined },
      lrNo: lr.lrNo, lrDate: fmtDate(lr.lrDate), paymentMode: payMode,
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
  };

  const onDownload = async () => {
    setPdfErr(''); setBusy('download');
    try { await downloadLrPdf(await buildPdfData(), `${fileName()}.pdf`); }
    catch (e) { setPdfErr(e instanceof Error ? e.message : 'Failed to generate the PDF'); }
    finally { setBusy(null); }
  };
  // Prints the actual generated PDF (not the HTML page) — guarantees exact A4
  // layout and has no browser header/footer to worry about.
  const onPrint = async () => {
    setPdfErr(''); setBusy('print');
    try { await printLrPdf(await buildPdfData()); }
    catch (e) { setPdfErr(e instanceof Error ? e.message : 'Failed to open the print dialog'); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      {/* Print rules: hide the toolbar, drop shadow/margins so only the note prints.
          @page margin is 0 on purpose — with any margin set, Chrome renders its own
          header/footer (date, title, URL, page count) into that space. Zero margin
          leaves it no room to draw them, so they disappear automatically without the
          user having to untick "Headers and footers" in the print dialog. The visual
          margin is recreated as padding on .lr-sheet instead. */}
      <style>{`
        @media print {
          @page { size: A4; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .lr-toolbar { display: none !important; }
          .lr-sheet { box-shadow: none !important; margin: 0 !important; padding: 10mm !important; max-width: none !important; width: 100% !important; }
        }
      `}</style>

      {/* Toolbar (screen only) */}
      <div className="lr-toolbar flex flex-wrap items-center gap-3 print:hidden max-w-[820px] mx-auto">
        <Link to="/lr" className="btn-ghost text-slate-600"><ArrowLeft className="h-4 w-4" /> Back</Link>
        <h1 className="text-lg sm:text-xl font-bold tracking-tight">Lorry Receipt — {lr.lrNo}</h1>
        <div className="ml-auto flex gap-2">
          <Link to={`/lr/${id}/edit`} className="btn-ghost text-slate-600 hover:bg-slate-100">
            <Pencil className="h-4 w-4" /> Edit
          </Link>
          <button type="button" onClick={onPrint} disabled={busy !== null} className="btn-ghost border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50">
            {busy === 'print' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} Print
          </button>
          <button type="button" onClick={onDownload} disabled={busy !== null} className="btn-primary disabled:opacity-50">
            {busy === 'download' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PDF
          </button>
        </div>
      </div>
      {pdfErr && (
        <div className="lr-toolbar max-w-[820px] mx-auto rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 print:hidden">{pdfErr}</div>
      )}

      {/* ── Printable consignment note ── */}
      <div className="lr-sheet bg-white text-slate-900 max-w-[820px] mx-auto shadow-md print:shadow-none text-[12px]">
        <div className="border border-slate-800">

          {/* Copy label */}
          <div className="border-b border-slate-800 px-3 py-0.5 text-right text-[10px] uppercase tracking-widest text-slate-500 font-semibold">
            Consignor Copy
          </div>

          {/* Top band: transporter header + LR title box */}
          <div className="flex items-stretch border-b border-slate-800">
            <div className="flex-1 px-3 py-2 border-r border-slate-800 min-w-0">
              <div className="flex items-start gap-3">
                {head.logo && (
                  <img src={head.logo} alt={head.name} className="h-12 w-auto max-w-[120px] object-contain shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-lg font-black uppercase tracking-wide leading-tight">{head.name}</div>
                  {head.tagline && <div className="text-[11px] text-slate-600 italic leading-snug">{head.tagline}</div>}
                  {head.address && <div className="text-[11px] text-slate-700 leading-snug whitespace-pre-line">{head.address}</div>}
                  <div className="text-[11px] text-slate-700 leading-snug">
                    {head.phone && <span>Phone: {head.phone}&nbsp;&nbsp;</span>}
                    {head.email && <span>Email: {head.email}&nbsp;&nbsp;</span>}
                    {head.gstin && <span>GSTIN: <span className="font-mono">{head.gstin}</span></span>}
                  </div>
                </div>
              </div>
            </div>
            <div className="w-[240px] shrink-0 flex flex-col">
              <div className="bg-slate-800 text-white text-center py-1 text-sm font-extrabold uppercase tracking-[0.2em]">
                Lorry Receipt
              </div>
              <div className="flex-1 grid grid-cols-2 text-[11px]">
                <div className="px-2 py-1 border-r border-b border-slate-800">
                  <div className="uppercase text-[9px] tracking-wide text-slate-500 font-semibold">LR No.</div>
                  <div className="font-bold text-[13px]">{lr.lrNo}</div>
                </div>
                <div className="px-2 py-1 border-b border-slate-800">
                  <div className="uppercase text-[9px] tracking-wide text-slate-500 font-semibold">Date</div>
                  <div className="font-semibold">{fmtDate(lr.lrDate)}</div>
                </div>
                <div className="col-span-2 px-2 py-1.5 grid place-items-center">
                  <span className={`inline-block rounded-full border-2 px-4 py-0.5 text-[12px] font-black uppercase tracking-widest ${stampCls}`}>
                    {payMode}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Consignor / Consignee */}
          <div className="grid grid-cols-2 border-b border-slate-800">
            <div className="px-3 py-2 border-r border-slate-800">
              <div className="uppercase text-[9px] tracking-widest text-slate-500 font-bold mb-0.5">Consignor</div>
              <div className="font-bold">{lr.consignorName}</div>
              {lr.consignorAddress && <div className="text-slate-700 whitespace-pre-line leading-snug">{lr.consignorAddress}</div>}
              <div className="text-slate-700 leading-snug">
                {lr.consignorGstin && <div>GSTIN: <span className="font-mono">{lr.consignorGstin}</span></div>}
                {lr.consignorMobile && <div>Mobile: {lr.consignorMobile}</div>}
              </div>
            </div>
            <div className="px-3 py-2">
              <div className="uppercase text-[9px] tracking-widest text-slate-500 font-bold mb-0.5">Consignee</div>
              <div className="font-bold">{lr.consigneeName}</div>
              {lr.consigneeAddress && <div className="text-slate-700 whitespace-pre-line leading-snug">{lr.consigneeAddress}</div>}
              <div className="text-slate-700 leading-snug">
                {lr.consigneeGstin && <div>GSTIN: <span className="font-mono">{lr.consigneeGstin}</span></div>}
                {lr.consigneeMobile && <div>Mobile: {lr.consigneeMobile}</div>}
              </div>
            </div>
          </div>

          {/* From / To / Dispatch / Vehicle */}
          <div className="grid grid-cols-4 border-b border-slate-800 text-[11px]">
            <div className="px-3 py-1.5 border-r border-slate-800">
              <div className="uppercase text-[9px] tracking-wide text-slate-500 font-semibold">From</div>
              <div className="font-semibold">{lr.fromLoc || '—'}</div>
            </div>
            <div className="px-3 py-1.5 border-r border-slate-800">
              <div className="uppercase text-[9px] tracking-wide text-slate-500 font-semibold">To</div>
              <div className="font-semibold">{lr.toLoc || '—'}</div>
            </div>
            <div className="px-3 py-1.5 border-r border-slate-800">
              <div className="uppercase text-[9px] tracking-wide text-slate-500 font-semibold">Mode of Dispatch</div>
              <div className="font-semibold">{lr.modeOfDispatch || '—'}</div>
            </div>
            <div className="px-3 py-1.5">
              <div className="uppercase text-[9px] tracking-wide text-slate-500 font-semibold">Vehicle No.</div>
              <div className="font-semibold font-mono">{lr.vehNo || '—'}</div>
            </div>
          </div>

          {/* Goods + charges: goods table (left) beside freight table (right) */}
          <div className="grid grid-cols-3 border-b border-slate-800">
            {/* Goods */}
            <div className="col-span-2 border-r border-slate-800">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-800">
                    <th className="px-2 py-1 border-r border-slate-800 text-center font-bold uppercase text-[9px] tracking-wide">No. of Pkgs.</th>
                    <th className="px-2 py-1 border-r border-slate-800 text-left font-bold uppercase text-[9px] tracking-wide">Method of Packing</th>
                    <th className="px-2 py-1 border-r border-slate-800 text-left font-bold uppercase text-[9px] tracking-wide">Particulars</th>
                    <th className="px-2 py-1 border-r border-slate-800 text-right font-bold uppercase text-[9px] tracking-wide">Actual Wt.</th>
                    <th className="px-2 py-1 text-right font-bold uppercase text-[9px] tracking-wide">Charged Wt.</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="align-top">
                    <td className="px-2 py-2 border-r border-slate-300 text-center tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>{lr.packages}</td>
                    <td className="px-2 py-2 border-r border-slate-300">{lr.packMethod || '—'}</td>
                    <td className="px-2 py-2 border-r border-slate-300 whitespace-pre-line">{lr.particular || '—'}</td>
                    <td className="px-2 py-2 border-r border-slate-300 text-right tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>{inrLR(lr.actualWt)}</td>
                    <td className="px-2 py-2 text-right tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>{inrLR(lr.chargedWt)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {/* Freight / charges */}
            <div className="col-span-1">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-800">
                    <th className="px-2 py-1 border-r border-slate-300 text-left font-bold uppercase text-[9px] tracking-wide">Charges</th>
                    <th className="px-2 py-1 text-right font-bold uppercase text-[9px] tracking-wide">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <ChargeRow label="Freight" hint={`${inrLR(lr.chargedWt)} × ${inrLR(lr.rate)}`} value={freightBase} always />
                  <ChargeRow label="ST Charge" value={lr.stCh} />
                  <ChargeRow label="Hamali" value={lr.hamali} />
                  <ChargeRow label="Other" value={lr.otherCh} />
                  <ChargeRow label="D/D Charge" value={lr.ddCh} />
                  <ChargeRow label="Risk/FOV" hint={lr.riskFovPct ? `@ ${lr.riskFovPct}%` : undefined} value={lr.riskFovAmount} />
                  <tr className="bg-slate-800 text-white">
                    <td className="px-2 py-1.5 border-r border-slate-600 font-bold uppercase text-[10px] tracking-wide">Total</td>
                    <td className="px-2 py-1.5 text-right font-black tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>₹{inrLR(lr.totalValue)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Documents row */}
          <div className="grid grid-cols-3 border-b border-slate-800 text-[11px]">
            <div className="px-3 py-1.5 border-r border-slate-800">
              <div className="uppercase text-[9px] tracking-wide text-slate-500 font-semibold">Invoice No.</div>
              <div className="font-semibold">{lr.invNo || '—'}{lr.invDate ? ` · ${fmtDate(lr.invDate)}` : ''}</div>
            </div>
            <div className="px-3 py-1.5 border-r border-slate-800">
              <div className="uppercase text-[9px] tracking-wide text-slate-500 font-semibold">E-Way Bill No.</div>
              <div className="font-semibold font-mono">{lr.ewayBillNo || '—'}</div>
            </div>
            <div className="px-3 py-1.5">
              <div className="uppercase text-[9px] tracking-wide text-slate-500 font-semibold">Value Declared</div>
              <div className="font-semibold tabular-nums" style={{ fontVariantNumeric: 'tabular-nums' }}>₹{inrLR(lr.valueDeclare)}</div>
            </div>
          </div>

          {/* Remark */}
          {lr.remark && (
            <div className="px-3 py-1.5 border-b border-slate-800 text-[11px]">
              <span className="uppercase text-[9px] tracking-wide text-slate-500 font-semibold">Remark: </span>
              <span className="whitespace-pre-line">{lr.remark}</span>
            </div>
          )}

          {/* Footer: risk note + QR e-copy + signatures */}
          <div className="grid grid-cols-[1fr,auto,1fr] text-[11px]">
            <div className="px-3 py-3 border-r border-slate-800">
              <div className="text-[10px] text-slate-500 italic mb-8">Goods carried at owner's risk.</div>
              <div className="border-t border-slate-400 pt-1 text-slate-600">Receiver's Signature</div>
            </div>
            <div className="flex flex-col items-center justify-center gap-1 border-r border-slate-800 px-3 py-2">
              {ecopyUrl
                ? <QRCodeSVG value={ecopyUrl} size={78} level="M" />
                : <div className="h-[78px] w-[78px] bg-slate-100" />}
              <div className="text-center text-[8px] uppercase tracking-wide text-slate-500 leading-tight">Scan for e-copy<br />&amp; details</div>
            </div>
            <div className="px-3 py-3 text-right">
              <div className="font-semibold uppercase mb-8">For {head.name}</div>
              <div className="border-t border-slate-400 pt-1 text-slate-600">Authorised Signatory</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LorryReceiptPrintPage;
