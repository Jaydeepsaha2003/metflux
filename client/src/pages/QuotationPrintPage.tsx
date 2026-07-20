// Sales Quotation — printable / shareable A4 document.
//
// Layout mirrors the company's Busy-style "Sales Quotation":
//   Company letterhead + logo
//   "SALES QUOTATION" title
//   Party details (left) + quotation meta (right)
//   Items table (S.N, Description, HSN/SAC, Qty, Unit, Price, Amount)
//   Sub-total + IGST / CGST+SGST + Grand Total
//   Tax breakup table + Amount in words
//   Editable Bank details + Terms & Conditions
//   Authorised Signatory footer
//
// PDF via html2pdf — same machinery as SupplierPOPrintPage.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Loader2, MessageCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { shareViaWhatsApp, type ShareTarget } from '@/lib/share';
import { useBranding } from '@/store/branding';
import { brandColorFor } from '@/lib/brandColor';
import { downloadQuotationPdf, quotationPdfBlob, type QuotationPdf } from '@/lib/reportPdf';

type Customer = { id: string; name: string; gstNumber: string | null; gstRate: number; state: string | null; address: string | null; phone?: string | null };
type QItem = {
  id: string; material: string; grade: string; measure: string;
  hsnCode: string | null; unit: string | null; pcs: number;
  rateBasis: 'PER_KG' | 'PER_PCS' | null; rateValue: number | null;
  ratePerPc: number | null; totalAmount: number | null;
};
type Quotation = {
  id: string; quotationNo: string; quotationDate: string; validUntil: string | null;
  status: string; notes: string | null; terms: string | null;
  customer: Customer; items: QItem[];
};
type CompanyMe = {
  name: string; address: string | null; phone: string | null; whatsappNumber: string | null;
  email: string | null; gstNumber: string | null; logoUrl: string | null; defaultShareTarget: ShareTarget;
};

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const fmt2 = (n: number) => n.toFixed(2);

/* Indian-style "Amount in words" — up to crores. */
const numberToWordsIndian = (num: number): string => {
  if (num === 0) return 'Zero';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const inWords = (n: number): string => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '');
    if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + inWords(n % 100) : '');
    return '';
  };
  const intPart = Math.floor(num);
  const paise = Math.round((num - intPart) * 100);
  let words = '';
  const crore = Math.floor(intPart / 10_000_000);
  const lakh = Math.floor((intPart % 10_000_000) / 100_000);
  const thou = Math.floor((intPart % 100_000) / 1000);
  const rest = intPart % 1000;
  if (crore) words += inWords(crore) + ' Crore ';
  if (lakh) words += inWords(lakh) + ' Lakh ';
  if (thou) words += inWords(thou) + ' Thousand ';
  if (rest) words += inWords(rest);
  words = words.trim();
  if (paise) words += ' and ' + inWords(paise) + ' Paise';
  return words + ' Only';
};

const rateOf = (it: QItem) =>
  it.ratePerPc ?? (it.rateBasis === 'PER_PCS' ? (it.rateValue ?? 0) : (it.pcs ? (it.totalAmount ?? 0) / it.pcs : 0));

export const QuotationPrintPage = () => {
  const { id } = useParams();
  const [generating, setGenerating] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const { data: qt, isLoading } = useQuery({
    queryKey: ['quotation-print', id],
    queryFn: () => api<Quotation>(`/quotations/${id}`),
    enabled: !!id,
  });
  const { data: company } = useQuery({
    queryKey: ['company-me'],
    queryFn: () => api<CompanyMe>('/companies/me'),
  });
  // Company-wide quotation defaults (bank + terms) set in Settings → Quotation Terms.
  const { data: qsettings } = useQuery({
    queryKey: ['company-settings', 'quotation'],
    queryFn: () => api<{ bankName: string; bankBranch: string; bankAccountName: string; bankAccountNumber: string; bankIfsc: string; terms: string }>('/company-settings/quotation'),
  });

  /* Editable bank details + terms — pre-filled from the company's saved
     quotation settings; still overridable per-quote before downloading. */
  const [bankName, setBankName] = useState('');
  const [bankAcc, setBankAcc] = useState('');
  const [bankAcctName, setBankAcctName] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [bankBranch, setBankBranch] = useState('');
  const [terms, setTerms] = useState('');
  const [edited, setEdited] = useState(false);

  // Apply saved defaults once loaded (unless the user has already edited a field).
  useEffect(() => {
    if (!qsettings || edited) return;
    setBankName(qsettings.bankName || '');
    setBankAcc(qsettings.bankAccountNumber || '');
    setBankAcctName(qsettings.bankAccountName || '');
    setBankIfsc(qsettings.bankIfsc || '');
    setBankBranch(qsettings.bankBranch || '');
    setTerms(qsettings.terms || '1. Subject to Jurisdiction only.');
  }, [qsettings, edited]);

  const totals = useMemo(() => {
    if (!qt) return { sub: 0, gstRate: 0, tax: 0, grand: 0, intra: false, totalQty: 0, unit: 'Pcs' };
    const sub = qt.items.reduce((s, it) => s + (it.totalAmount ?? 0), 0);
    const gstRate = qt.customer.gstRate ?? 0;
    // Same-state (GSTIN state code matches) → CGST+SGST; else IGST.
    const coState = (company?.gstNumber ?? '').slice(0, 2);
    const custState = (qt.customer.gstNumber ?? '').slice(0, 2);
    const intra = !!coState && !!custState && coState === custState;
    const tax = +(sub * (gstRate / 100)).toFixed(2);
    const grand = +(sub + tax).toFixed(2);
    const totalQty = qt.items.reduce((s, it) => s + it.pcs, 0);
    const unit = qt.items[0]?.unit || 'Pcs';
    return { sub: +sub.toFixed(2), gstRate, tax, grand, intra, totalQty, unit };
  }, [qt, company?.gstNumber]);

  // Colour follows the company the quotation is FOR; falls back to the domain's.
  const storeBrand = useBranding((s) => s.brandColor);

  // Assemble the structured data for the pdfmake builder.
  const buildQtData = (): QuotationPdf | null => {
    if (!qt) return null;
    return {
      company: {
        name: company?.name, address: company?.address, phone: company?.phone,
        whatsappNumber: company?.whatsappNumber, email: company?.email,
        gstNumber: company?.gstNumber, logoUrl: company?.logoUrl,
      },
      brand: brandColorFor(company?.name) ?? storeBrand,
      quotationNo: qt.quotationNo,
      quotationDate: fmtDate(qt.quotationDate),
      validUntil: qt.validUntil ? fmtDate(qt.validUntil) : '',
      status: qt.status.charAt(0) + qt.status.slice(1).toLowerCase(),
      party: {
        name: qt.customer.name,
        lines: [qt.customer.address, qt.customer.state].filter(Boolean) as string[],
        phone: qt.customer.phone ?? '',
        gstin: qt.customer.gstNumber ?? '',
      },
      items: qt.items.map((it) => {
        const showGrade = it.grade && !it.material.toUpperCase().includes(it.grade.toUpperCase());
        return {
          description: `${it.material}${it.measure ? ` - ${it.measure}` : ''}`,
          sub: showGrade ? it.grade : '',
          hsn: it.hsnCode || '',
          qty: it.pcs.toLocaleString('en-IN'),
          unit: it.unit || 'Pcs',
          price: fmt2(rateOf(it)),
          amount: fmt2(it.totalAmount ?? 0),
        };
      }),
      totalQty: totals.totalQty.toLocaleString('en-IN'),
      unit: totals.unit,
      subTotal: fmt2(totals.sub),
      gstRate: totals.gstRate, intra: totals.intra,
      tax: fmt2(totals.tax), grandTotal: fmt2(totals.grand),
      amountWords: numberToWordsIndian(totals.grand),
      bank: { name: bankName, accountName: bankAcctName, accountNumber: bankAcc, ifsc: bankIfsc, branch: bankBranch },
      terms, notes: qt.notes ?? '',
    };
  };
  const fileName = () => `Quotation-${(qt?.quotationNo ?? 'PL').replace(/[\\/:*?"<>|]/g, '-')}`;

  const handleDownload = async () => {
    const data = buildQtData();
    if (!data) return;
    setGenerating(true);
    try { await downloadQuotationPdf(data, `${fileName()}.pdf`); }
    finally { setGenerating(false); }
  };

  const handleWhatsappShare = async () => {
    const data = buildQtData();
    if (!qt || !data) return;
    setGenerating(true);
    try {
      const blob = await quotationPdfBlob(data);
      const message = [
        `*Sales Quotation ${qt.quotationNo}*`,
        company?.name ? `From: ${company.name}` : null,
        `To: ${qt.customer.name}`,
        `Date: ${fmtDate(qt.quotationDate)}`,
        `Grand Total: ₹ ${fmt2(totals.grand)}`,
      ].filter(Boolean).join('\n');
      await shareViaWhatsApp({
        message,
        target: company?.defaultShareTarget,
        companyPhone: company?.whatsappNumber ?? null,
        customerPhone: qt.customer.phone ?? null,
        pdf: { blob, filename: fileName() },
      });
    } finally { setGenerating(false); }
  };

  if (isLoading) return <div className="card p-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></div>;
  if (!qt) return <div className="card p-10 text-center text-slate-400">Quotation not found.</div>;

  const partyLines = [qt.customer.address, qt.customer.state].filter(Boolean) as string[];
  const taxLabel = totals.intra ? 'CGST + SGST' : 'IGST';

  return (
    <div className="space-y-4 max-w-[1100px]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link to="/quotation/manage" className="btn-ghost text-slate-600"><ArrowLeft className="h-4 w-4" /> Back</Link>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Quotation — {qt.quotationNo}</h1>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={handleWhatsappShare} disabled={generating} className="btn-ghost text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
            <MessageCircle className="h-4 w-4" /> Share on WhatsApp
          </button>
          <button type="button" onClick={handleDownload} disabled={generating} className="btn-primary">
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PDF
          </button>
        </div>
      </div>

      {/* ── Printable A4 sheet ── */}
      <div className="overflow-x-auto rounded-xl shadow-md print:overflow-visible print:shadow-none print:rounded-none">
        <div ref={printRef} id="quote-print-doc"
             className="bg-white text-slate-900 min-w-[760px] rounded-xl overflow-hidden print:min-w-0 print:rounded-none print:overflow-visible">

          {/* Company letterhead — company text left; logo + SALES QUOTATION stacked top-right */}
          <div className="flex items-start justify-between gap-6 px-6 pt-5 pb-4 border-b-4 border-brand-600">
            <div className="min-w-0">
              <div className="text-2xl font-black uppercase tracking-wide leading-tight text-brand-800">{company?.name ?? 'Company Name'}</div>
              {company?.address && <div className="text-[11px] font-semibold text-slate-700 mt-1 max-w-md leading-snug whitespace-pre-line">{company.address}</div>}
              <div className="text-[11px] text-slate-700 mt-1 leading-snug">
                {company?.phone && <>Phone : {company.phone}<br /></>}
                {company?.email && <>E-mail : {company.email}<br /></>}
                {company?.gstNumber && <>GSTIN : <span className="font-mono">{company.gstNumber}</span></>}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              {company?.logoUrl
                ? <img src={company.logoUrl} alt={company.name} className="h-16 w-auto max-w-[180px] object-contain" />
                : <div className="h-16 w-28 rounded-lg bg-slate-100 grid place-items-center text-xs text-slate-400">LOGO</div>}
              <div className="bg-brand-700 text-white px-4 py-1.5 text-center">
                <div className="text-sm font-extrabold uppercase tracking-[0.15em] whitespace-nowrap">Sales Quotation</div>
              </div>
            </div>
          </div>

          {/* Party block + quotation meta */}
          <div className="grid grid-cols-2 text-[12px] border-b border-slate-300">
            <div className="border-r border-slate-300 px-5 py-3 space-y-1.5">
              <div className="text-[10px] uppercase tracking-wide text-brand-700 font-bold">Party Details</div>
              <div className="font-semibold">{qt.customer.name}</div>
              {partyLines.map((line, i) => <div key={i} className="text-slate-700 whitespace-pre-line">{line}</div>)}
              {qt.customer.phone && <div className="text-slate-700">Phone {qt.customer.phone}</div>}
              <div className="pt-1"><span className="text-slate-500 font-semibold">GSTIN : </span><span className="font-mono">{qt.customer.gstNumber ?? '—'}</span></div>
            </div>
            <div className="px-5 py-3 space-y-1.5">
              <div className="flex"><span className="w-32 text-slate-500 font-semibold">Quotation No. :</span><span className="font-semibold whitespace-nowrap">{qt.quotationNo}</span></div>
              <div className="flex"><span className="w-32 text-slate-500 font-semibold">Dated :</span><span>{fmtDate(qt.quotationDate)}</span></div>
              {qt.validUntil && <div className="flex"><span className="w-32 text-slate-500 font-semibold">Valid Until :</span><span>{fmtDate(qt.validUntil)}</span></div>}
              <div className="flex"><span className="w-32 text-slate-500 font-semibold">Status :</span><span>{qt.status.charAt(0) + qt.status.slice(1).toLowerCase()}</span></div>
            </div>
          </div>

          {/* Items table */}
          <table className="w-full text-[12px] border-collapse" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '5%' }} />
              <col style={{ width: '39%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '11%' }} />
              <col style={{ width: '13%' }} />
            </colgroup>
            <thead>
              <tr className="bg-brand-600 text-white border-b-2 border-brand-700">
                <th className="px-2 py-1.5 border-r border-brand-500 text-center font-bold">S.N</th>
                <th className="px-2 py-1.5 border-r border-brand-500 text-left font-bold">Description of Goods</th>
                <th className="px-2 py-1.5 border-r border-brand-500 text-center font-bold">HSN/SAC</th>
                <th className="px-2 py-1.5 border-r border-brand-500 text-right font-bold">Qty</th>
                <th className="px-2 py-1.5 border-r border-brand-500 text-center font-bold">Unit</th>
                <th className="px-2 py-1.5 border-r border-brand-500 text-right font-bold">Price</th>
                <th className="px-2 py-1.5 text-right font-bold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {qt.items.map((it, idx) => {
                // Hide the grade sub-line when it's already part of the material name
                // (e.g. material "SS CASE" + grade "SS" was showing a redundant "SS").
                const showGrade = it.grade && !it.material.toUpperCase().includes(it.grade.toUpperCase());
                return (
                <tr key={it.id} className="border-b border-slate-200 align-top">
                  <td className="px-2 py-2 border-r border-slate-200 text-center">{idx + 1}</td>
                  <td className="px-2 py-2 border-r border-slate-200">
                    <div className="font-medium">{it.material}{it.measure ? ` - ${it.measure}` : ''}</div>
                    {showGrade && <div className="mt-0.5 text-[11px] text-slate-500">{it.grade}</div>}
                  </td>
                  <td className="px-2 py-2 border-r border-slate-200 text-center font-mono">{it.hsnCode || '—'}</td>
                  <td className="px-2 py-2 border-r border-slate-200 text-right tabular-nums">{it.pcs.toLocaleString('en-IN')}</td>
                  <td className="px-2 py-2 border-r border-slate-200 text-center">{it.unit || 'Pcs'}</td>
                  <td className="px-2 py-2 border-r border-slate-200 text-right tabular-nums">{fmt2(rateOf(it))}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-semibold">{fmt2(it.totalAmount ?? 0)}</td>
                </tr>
                );
              })}
              <tr className="bg-slate-50 border-y border-slate-300">
                <td colSpan={3} className="px-2 py-1.5 text-right text-[11px] uppercase tracking-wide text-slate-600 font-semibold">Total :</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{totals.totalQty.toLocaleString('en-IN')}</td>
                <td className="px-2 py-1.5 text-center text-slate-600">{totals.unit}</td>
                <td className="px-2 py-1.5"></td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmt2(totals.sub)}</td>
              </tr>
            </tbody>
          </table>

          {/* Totals + Amount in words */}
          <div className="grid grid-cols-2 border-b border-slate-300">
            <div className="border-r border-slate-300 px-5 py-3 text-[12px]">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Amount In Words</div>
              <div className="font-semibold">INR {numberToWordsIndian(totals.grand)}</div>
            </div>
            <div className="px-5 py-3 text-[12px] space-y-1">
              <div className="flex justify-between"><span className="text-slate-600">Sub Total</span><span className="tabular-nums">{fmt2(totals.sub)}</span></div>
              {totals.gstRate > 0 && (totals.intra ? (
                <>
                  <div className="flex justify-between"><span className="text-slate-600">CGST @ {(totals.gstRate / 2).toFixed(2)}%</span><span className="tabular-nums">{fmt2(totals.tax / 2)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">SGST @ {(totals.gstRate / 2).toFixed(2)}%</span><span className="tabular-nums">{fmt2(totals.tax / 2)}</span></div>
                </>
              ) : (
                <div className="flex justify-between"><span className="text-slate-600">IGST @ {totals.gstRate.toFixed(2)}%</span><span className="tabular-nums">{fmt2(totals.tax)}</span></div>
              ))}
              <div className="flex justify-between border-t-2 border-brand-600 pt-1.5 mt-1.5">
                <span className="font-bold text-brand-800">Grand Total</span>
                <span className="tabular-nums font-bold text-brand-800">₹ {fmt2(totals.grand)}</span>
              </div>
            </div>
          </div>

          {/* Tax breakup */}
          {totals.gstRate > 0 && (
            <div className="px-5 py-2 border-b border-slate-300">
              <table className="w-full text-[11px] border border-slate-300">
                <thead>
                  <tr className="bg-slate-50 text-slate-600">
                    <th className="px-2 py-1 border-r border-slate-200 text-left font-semibold">Tax Rate</th>
                    <th className="px-2 py-1 border-r border-slate-200 text-right font-semibold">Taxable Amt</th>
                    <th className="px-2 py-1 border-r border-slate-200 text-right font-semibold">{taxLabel} Amt</th>
                    <th className="px-2 py-1 text-right font-semibold">Total Tax</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-2 py-1 border-r border-slate-200">{totals.gstRate.toFixed(0)}%</td>
                    <td className="px-2 py-1 border-r border-slate-200 text-right tabular-nums">{fmt2(totals.sub)}</td>
                    <td className="px-2 py-1 border-r border-slate-200 text-right tabular-nums">{fmt2(totals.tax)}</td>
                    <td className="px-2 py-1 text-right tabular-nums font-semibold">{fmt2(totals.tax)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Notes */}
          {qt.notes && (
            <div className="px-5 py-2 text-[12px] border-b border-slate-300">
              <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Note : </span>
              <span className="whitespace-pre-line">{qt.notes}</span>
            </div>
          )}

          {/* Bank details — single line, full width */}
          <div className="border-b border-slate-300 px-5 py-2 text-[12px]">
            <span className="text-[11px] font-bold uppercase tracking-wide text-brand-700 mr-2">Bank Details</span>
            <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-1 align-middle">
              <span className="text-slate-500">Bank:</span>
              <input className="w-28 border-b border-dashed border-slate-300 bg-transparent outline-none focus:border-brand-500 px-1" value={bankName} onChange={(e) => { setBankName(e.target.value); setEdited(true); }} placeholder="ICICI BANK" />
              <span className="text-slate-400">·</span><span className="text-slate-500">A/C Name:</span>
              <input className="w-36 border-b border-dashed border-slate-300 bg-transparent outline-none focus:border-brand-500 px-1" value={bankAcctName} onChange={(e) => { setBankAcctName(e.target.value); setEdited(true); }} placeholder="Account holder" />
              <span className="text-slate-400">·</span><span className="text-slate-500">A/C No:</span>
              <input className="w-32 border-b border-dashed border-slate-300 bg-transparent outline-none focus:border-brand-500 px-1 font-mono" value={bankAcc} onChange={(e) => { setBankAcc(e.target.value); setEdited(true); }} placeholder="000000000000" />
              <span className="text-slate-400">·</span><span className="text-slate-500">IFSC:</span>
              <input className="w-28 border-b border-dashed border-slate-300 bg-transparent outline-none focus:border-brand-500 px-1 font-mono" value={bankIfsc} onChange={(e) => { setBankIfsc(e.target.value); setEdited(true); }} placeholder="ICIC0000000" />
              <span className="text-slate-400">·</span><span className="text-slate-500">Branch:</span>
              <input className="w-28 border-b border-dashed border-slate-300 bg-transparent outline-none focus:border-brand-500 px-1" value={bankBranch} onChange={(e) => { setBankBranch(e.target.value); setEdited(true); }} placeholder="Branch" />
            </span>
          </div>

          {/* Terms & Conditions — full width, brand-tinted panel, semibold */}
          <div className="border-b border-slate-300 px-5 py-2">
            <div className="bg-brand-700 text-white text-[11px] font-bold uppercase tracking-widest px-2 py-1 rounded-t-md">Terms &amp; Conditions</div>
            <textarea className="w-full text-[11px] font-semibold leading-relaxed border border-brand-200 border-t-0 rounded-b-md bg-brand-50/40 p-2.5 outline-none focus:border-brand-500 min-h-[104px]" value={terms} onChange={(e) => { setTerms(e.target.value); setEdited(true); }} />
          </div>

          {/* Signature footer */}
          <div className="grid grid-cols-2 text-[12px] no-break">
            <div className="border-r border-slate-300 px-5 py-3 text-slate-500">
              <div className="text-[11px]">Receiver's Signature</div>
              <div className="mt-8 text-[10px]">E. &amp; O.E.</div>
            </div>
            <div className="px-5 py-3 text-right">
              <div className="font-semibold uppercase text-[11px] tracking-wide">For, {company?.name ?? 'Company Name'}</div>
              <div className="mt-10 text-[11px] text-slate-600">Authorised Signatory</div>
            </div>
          </div>

          <div className="px-5 py-1.5 text-[10px] text-slate-500 border-t border-slate-200 flex items-center justify-between">
            <span>Quotation No. &amp; Date : {qt.quotationNo} — {fmtDate(qt.quotationDate)}</span>
            <span>Page 1 of 1</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuotationPrintPage;
