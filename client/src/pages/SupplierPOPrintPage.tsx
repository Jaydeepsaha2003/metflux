// Supplier Purchase Order — printable / shareable A4 invoice.
//
// Layout mirrors a classic AVCON-style PO:
//   Company letterhead + logo
//   "PURCHASE ORDER" title
//   Vendor block (left) + PO meta (right)
//   Items table (Item, HSN, GST%, UOM, Qty, Rate, Amount)
//   Totals box (Basic, GST split, Grand Total) + Amount In Words
//   Editable Terms & Conditions
//   Signature footer (Prepared By / Authorised By)
//
// Output uses html2pdf — same approach as PackingListPage + WorkAllotment.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Loader2, MessageCircle } from 'lucide-react';
import html2pdf from 'html2pdf.js';
import { api } from '@/lib/api';
import { shareViaWhatsApp, type ShareTarget } from '@/lib/share';

/* ── Types ──────────────────────────────────────────────────── */
type Supplier = {
  id: string;
  name: string;
  gstNumber: string | null;
  gstRate: number;
  state: string | null;
  address: string | null;
  phone?: string | null;
  email?: string | null;
};

type Item = {
  id: string;
  description: string;
  hsnCode: string | null;
  qty: number;
  unit: string;
  rate: number;
  amount: number;
  notes: string | null;
  receivedQty: number;
};

type SupplierOrder = {
  id: string;
  poNumber: string;
  orderDate: string;
  expectedDate: string | null;
  status: 'PENDING' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';
  notes: string | null;
  supplier: Supplier;
  items: Item[];
};

type CompanyMe = {
  name: string;
  address: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  email: string | null;
  gstNumber: string | null;
  logoUrl: string | null;
  defaultShareTarget: ShareTarget;
};

/* ── Helpers ────────────────────────────────────────────────── */
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const fmt2 = (n: number) => n.toFixed(2);

/* Indian-style "Amount in words" — works for amounts up to crores. */
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
  const lakh  = Math.floor((intPart % 10_000_000) / 100_000);
  const thou  = Math.floor((intPart % 100_000) / 1000);
  const rest  = intPart % 1000;
  if (crore) words += inWords(crore) + ' Crore ';
  if (lakh)  words += inWords(lakh)  + ' Lakh ';
  if (thou)  words += inWords(thou)  + ' Thousand ';
  if (rest)  words += inWords(rest);
  words = words.trim();
  if (paise) words += ' and ' + inWords(paise) + ' Paise';
  return words + ' Only';
};

/* ── Page ───────────────────────────────────────────────────── */
const DEFAULT_GENERAL_TERMS = `1. Stores timing of material receipt is 09:30 A.M. to 05:00 P.M.
2. It is mandatory to mention purchase order number on all Invoices
3. It is mandatory to make separate Invoice against each purchase order
4. Extra Material other than purchase order quantity will not be acceptable
5. We reserve the right to cancel or amend the purchase order
6. The material on receipt will be inspected by us and in case of rejection it will be notified to you. Such rejected material must be lifted from our stores within 5 days from the date of intimation.
7. Any breakage, damage and transit losses due to weak, poor or insufficient packing shall be on your account.`;

export const SupplierPOPrintPage = () => {
  const { id } = useParams();
  const [generating, setGenerating] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  /* PO + active company */
  const { data: po, isLoading } = useQuery({
    queryKey: ['supplier-order-print', id],
    queryFn: () => api<SupplierOrder>(`/supplier-orders/${id}`),
    enabled: !!id,
  });
  const { data: company } = useQuery({
    queryKey: ['company-me'],
    queryFn: () => api<CompanyMe>('/companies/me'),
  });

  /* Editable Terms & Conditions — initialised from sensible defaults but
     the user can edit any line before downloading the PDF. */
  const [tcPacking,   setTcPacking]   = useState('NIL');
  const [tcFreight,   setTcFreight]   = useState('Paid');
  const [tcGst,       setTcGst]       = useState('GST as applicable');
  const [tcPayment,   setTcPayment]   = useState('30 Days from Invoice');
  const [tcDespatch,  setTcDespatch]  = useState('Through Reliable Transport');
  const [tcTransport, setTcTransport] = useState('Dispatch Through Transport Vehicle');
  const [tcGeneral,   setTcGeneral]   = useState(DEFAULT_GENERAL_TERMS);

  // Default GST line to match supplier's gstRate when PO loads.
  useEffect(() => {
    if (po?.supplier?.gstRate) {
      setTcGst(`GST ${po.supplier.gstRate}%`);
    }
  }, [po?.supplier?.gstRate]);

  /* Totals */
  const totals = useMemo(() => {
    if (!po) return { basic: 0, gst: 0, grand: 0, gstRate: 0 };
    const basic = po.items.reduce((s, it) => s + it.amount, 0);
    const gstRate = po.supplier.gstRate ?? 0;
    // IGST when supplier is out of state vs company; CGST+SGST when same state.
    // We just label "GST" for simplicity — both compute to the same total.
    const gst = +(basic * (gstRate / 100)).toFixed(2);
    const grand = +(basic + gst).toFixed(2);
    return { basic: +basic.toFixed(2), gst, grand, gstRate };
  }, [po]);

  /* Build the PDF job — clones the print area, swaps inputs for static
     text, captures with html2canvas. */
  const buildPdfJob = () => {
    const el = printRef.current;
    if (!el || !po) return null;

    // A4 portrait with 8 mm margins: usable = 194 mm = 194/25.4*96 ≈ 733 px.
    // Use 720 px for a safe 13 px buffer so nothing clips at the right edge.
    const A4_USABLE_PX = 720;
    const clone = el.cloneNode(true) as HTMLElement;

    // Replace live form controls (inputs / textareas) with static spans
    // carrying their current value, so html2canvas doesn't render empty
    // text fields.
    const liveCtrls = Array.from(
      el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
    );
    const cloneCtrls = Array.from(
      clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
    );
    cloneCtrls.forEach((ci, i) => {
      const live = liveCtrls[i];
      const val = (live?.value ?? '').toString();
      const span = document.createElement(ci.tagName === 'TEXTAREA' ? 'div' : 'span');
      span.className = ci.className;
      // Preserve newlines from textareas.
      span.style.whiteSpace = 'pre-wrap';
      span.style.display    = 'block';
      // Strip all borders so input underlines / textarea boxes don't appear in PDF.
      span.style.border       = 'none';
      span.style.borderBottom = 'none';
      span.style.outline      = 'none';
      span.style.minHeight    = 'auto';
      span.textContent        = val.length ? val : ' ';
      ci.replaceWith(span);
    });

    clone.style.width = `${A4_USABLE_PX}px`;
    clone.style.minWidth = '0';
    clone.style.overflow = 'visible';
    clone.style.borderRadius = '0';
    clone.style.boxShadow = 'none';

    const offscreen = document.createElement('div');
    offscreen.style.position = 'fixed';
    offscreen.style.left = '-10000px';
    offscreen.style.top  = '0';
    offscreen.style.width = `${A4_USABLE_PX}px`;
    offscreen.style.background = '#ffffff';
    offscreen.appendChild(clone);
    document.body.appendChild(offscreen);

    const filename = `PO-${po.poNumber.replace(/[\\/:*?"<>|]/g, '-')}.pdf`;
    const worker = html2pdf().set({
      margin: 8,
      filename,
      image: { type: 'jpeg', quality: 0.97 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        width: A4_USABLE_PX,
        windowWidth: A4_USABLE_PX,
      },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', 'thead', '.no-break'] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).from(clone);

    return { worker, filename, teardown: () => document.body.removeChild(offscreen) };
  };

  const handleDownload = async () => {
    setGenerating(true);
    const job = buildPdfJob();
    if (!job) { setGenerating(false); return; }
    await new Promise((r) => requestAnimationFrame(r));
    try { await job.worker.save(); }
    finally { job.teardown(); setGenerating(false); }
  };

  const handleWhatsappShare = async () => {
    if (!po) return;
    setGenerating(true);
    const job = buildPdfJob();
    if (!job) { setGenerating(false); return; }
    await new Promise((r) => requestAnimationFrame(r));
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = (await (job.worker as any).output('blob')) as Blob;
      const message = [
        `*Purchase Order ${po.poNumber}*`,
        company?.name ? `From: ${company.name}` : null,
        `To: ${po.supplier.name}`,
        `Order Date: ${fmtDate(po.orderDate)}`,
        `Grand Total: ₹ ${fmt2(totals.grand)}`,
      ].filter(Boolean).join('\n');
      await shareViaWhatsApp({
        message,
        target: company?.defaultShareTarget,
        companyPhone: company?.whatsappNumber ?? null,
        customerPhone: po.supplier.phone ?? null,
        pdf: { blob, filename: job.filename.replace(/\.pdf$/i, '') },
      });
    } finally {
      job.teardown();
      setGenerating(false);
    }
  };

  if (isLoading) {
    return <div className="card p-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></div>;
  }
  if (!po) {
    return <div className="card p-10 text-center text-slate-400">Supplier order not found.</div>;
  }

  /* Buyer / supplier address blocks broken into lines. */
  const supplierLines = [
    po.supplier.address,
    po.supplier.state,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-4 max-w-[1100px]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link to="/supplier-po/manage" className="btn-ghost text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
          Purchase Order — {po.poNumber}
        </h1>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={handleWhatsappShare}
            disabled={generating}
            className="btn-ghost text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            <MessageCircle className="h-4 w-4" /> Share on WhatsApp
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={generating}
            className="btn-primary"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download PDF
          </button>
        </div>
      </div>

      {/* ── Printable A4 sheet ── */}
      <div className="overflow-x-auto rounded-xl shadow-md print:overflow-visible print:shadow-none print:rounded-none">
        <div ref={printRef} id="po-print-doc"
             className="bg-white text-slate-900 min-w-[760px] rounded-xl overflow-hidden print:min-w-0 print:rounded-none print:overflow-visible">

          {/* Company letterhead */}
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b-2 border-slate-900">
            <div className="min-w-0">
              <div className="text-xl font-black uppercase tracking-wide leading-tight">
                {company?.name ?? 'Company Name'}
              </div>
              {company?.address && (
                <div className="text-[11px] font-semibold text-slate-700 mt-1 max-w-md leading-snug whitespace-pre-line">
                  {company.address}
                </div>
              )}
              <div className="text-[11px] text-slate-700 mt-1 leading-snug">
                {company?.phone    && <>Phone : {company.phone}<br /></>}
                {company?.email    && <>E-mail : {company.email}<br /></>}
                {company?.gstNumber&& <>GSTIN : <span className="font-mono">{company.gstNumber}</span></>}
              </div>
            </div>
            {company?.logoUrl
              ? <img src={company.logoUrl} alt={company.name}
                    className="h-20 w-auto object-contain shrink-0" />
              : <div className="h-20 w-20 rounded-lg bg-slate-100 grid place-items-center text-xs text-slate-400 shrink-0">LOGO</div>}
          </div>

          {/* Title */}
          <div className="text-center py-2.5 border-b border-slate-300">
            <h2 className="text-lg font-bold uppercase tracking-widest">Purchase Order</h2>
          </div>

          {/* Vendor block + PO meta */}
          <div className="grid grid-cols-2 text-[12px] border-b border-slate-300">
            {/* Left — vendor */}
            <div className="border-r border-slate-300 px-5 py-3 space-y-1.5">
              <div className="flex"><span className="w-28 text-slate-500 font-semibold">Vendor Code :</span><span className="font-medium">{po.supplier.id.slice(0, 8).toUpperCase()}</span></div>
              <div className="flex"><span className="w-28 text-slate-500 font-semibold">GSTIN :</span><span className="font-mono">{po.supplier.gstNumber ?? '—'}</span></div>
              <div className="mt-2 flex items-start">
                <span className="w-12 text-slate-500 font-semibold">M/S.</span>
                <div className="flex-1">
                  <div className="font-semibold">{po.supplier.name}</div>
                  {supplierLines.map((line, i) => (
                    <div key={i} className="text-slate-700 whitespace-pre-line">{line}</div>
                  ))}
                  {po.supplier.phone && <div className="text-slate-700 mt-0.5">Phone {po.supplier.phone}</div>}
                </div>
              </div>
            </div>
            {/* Right — PO meta */}
            <div className="px-5 py-3 space-y-1.5">
              <div className="flex">
                <span className="w-28 text-slate-500 font-semibold">P.O. No. :</span>
                <span className="font-mono font-semibold">{po.poNumber}</span>
              </div>
              <div className="flex">
                <span className="w-28 text-slate-500 font-semibold">P.O. Date :</span>
                <span>{fmtDate(po.orderDate)}</span>
              </div>
              <div className="flex">
                <span className="w-28 text-slate-500 font-semibold">Expected :</span>
                <span>{fmtDate(po.expectedDate)}</span>
              </div>
              <div className="flex">
                <span className="w-28 text-slate-500 font-semibold">Status :</span>
                <span>{po.status}</span>
              </div>
            </div>
          </div>

          {/* Items table — percentage columns so content always fits A4 width */}
          <table className="w-full text-[12px] border-collapse" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '4%' }} />   {/* No. */}
              <col style={{ width: '33%' }} />  {/* Item Details */}
              <col style={{ width: '11%' }} />  {/* HSN/SAC */}
              <col style={{ width: '7%' }} />   {/* GST % */}
              <col style={{ width: '7%' }} />   {/* UOM */}
              <col style={{ width: '11%' }} />  {/* Quantity */}
              <col style={{ width: '13%' }} />  {/* Rate */}
              <col style={{ width: '14%' }} />  {/* Amount (INR) */}
            </colgroup>
            <thead>
              <tr className="bg-slate-100 border-b-2 border-slate-400">
                <th className="px-2 py-1.5 border-r border-slate-300 text-center font-bold">No.</th>
                <th className="px-2 py-1.5 border-r border-slate-300 text-left font-bold">Item Details</th>
                <th className="px-2 py-1.5 border-r border-slate-300 text-center font-bold">HSN/SAC</th>
                <th className="px-2 py-1.5 border-r border-slate-300 text-center font-bold">GST %</th>
                <th className="px-2 py-1.5 border-r border-slate-300 text-center font-bold">UOM</th>
                <th className="px-2 py-1.5 border-r border-slate-300 text-right font-bold">Quantity</th>
                <th className="px-2 py-1.5 border-r border-slate-300 text-right font-bold">Rate</th>
                <th className="px-2 py-1.5 text-right font-bold">Amount (INR)</th>
              </tr>
            </thead>
            <tbody>
              {po.items.map((it, idx) => (
                <tr key={it.id} className="border-b border-slate-200 align-top">
                  <td className="px-2 py-2 border-r border-slate-200 text-center">{idx + 1}</td>
                  <td className="px-2 py-2 border-r border-slate-200">
                    <div className="font-medium">{it.description}</div>
                    {it.notes && (
                      <div className="mt-0.5 text-[11px] text-slate-600 whitespace-pre-wrap leading-snug">{it.notes}</div>
                    )}
                    {it.receivedQty > 0 && (
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        Received : {it.receivedQty} {it.unit}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 border-r border-slate-200 text-center font-mono">{it.hsnCode ?? '—'}</td>
                  <td className="px-2 py-2 border-r border-slate-200 text-center tabular-nums">{totals.gstRate.toFixed(2)}</td>
                  <td className="px-2 py-2 border-r border-slate-200 text-center">{it.unit}</td>
                  <td className="px-2 py-2 border-r border-slate-200 text-right tabular-nums">{it.qty.toFixed(3)}</td>
                  <td className="px-2 py-2 border-r border-slate-200 text-right tabular-nums">{fmt2(it.rate)}</td>
                  <td className="px-2 py-2 text-right tabular-nums font-semibold">{fmt2(it.amount)}</td>
                </tr>
              ))}

              {/* Total qty row */}
              <tr className="bg-slate-50 border-y border-slate-300">
                <td colSpan={5} className="px-2 py-1.5 text-right text-[11px] uppercase tracking-wide text-slate-600 font-semibold">Total Qty :</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                  {po.items.reduce((s, it) => s + it.qty, 0).toFixed(3)}
                </td>
                <td colSpan={2}></td>
              </tr>
            </tbody>
          </table>

          {/* Totals + Amount in Words */}
          <div className="grid grid-cols-2 border-b border-slate-300">
            <div className="border-r border-slate-300 px-5 py-3 text-[12px]">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Amount In Words</div>
              <div className="font-semibold">INR {numberToWordsIndian(totals.grand)}</div>
            </div>
            <div className="px-5 py-3 text-[12px] space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-600">Basic Amount</span>
                <span className="tabular-nums">{fmt2(totals.basic)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Sub Total</span>
                <span className="tabular-nums">{fmt2(totals.basic)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">GST ({totals.gstRate.toFixed(2)}%)</span>
                <span className="tabular-nums">{fmt2(totals.gst)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-400 pt-1 mt-1">
                <span className="font-bold">Grand Total</span>
                <span className="tabular-nums font-bold">{fmt2(totals.grand)}</span>
              </div>
            </div>
          </div>

          {/* Editable Terms & Conditions */}
          <div className="px-5 py-2 text-[12px] border-b border-slate-300">
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-700 mb-1.5">Terms &amp; Conditions :-</div>
            <div className="grid grid-cols-[110px_1fr] gap-y-0.5 gap-x-3 mb-2">
              <span className="text-slate-600">Packing :</span>
              <input className="border-b border-dashed border-slate-300 bg-transparent outline-none focus:border-brand-500 px-1" value={tcPacking}   onChange={(e) => setTcPacking(e.target.value)} />
              <span className="text-slate-600">Freight :</span>
              <input className="border-b border-dashed border-slate-300 bg-transparent outline-none focus:border-brand-500 px-1" value={tcFreight}   onChange={(e) => setTcFreight(e.target.value)} />
              <span className="text-slate-600">GST :</span>
              <input className="border-b border-dashed border-slate-300 bg-transparent outline-none focus:border-brand-500 px-1" value={tcGst}       onChange={(e) => setTcGst(e.target.value)} />
              <span className="text-slate-600">Payment :</span>
              <input className="border-b border-dashed border-slate-300 bg-transparent outline-none focus:border-brand-500 px-1" value={tcPayment}   onChange={(e) => setTcPayment(e.target.value)} />
              <span className="text-slate-600">Despatch :</span>
              <input className="border-b border-dashed border-slate-300 bg-transparent outline-none focus:border-brand-500 px-1" value={tcDespatch}  onChange={(e) => setTcDespatch(e.target.value)} />
              <span className="text-slate-600">Transport :</span>
              <input className="border-b border-dashed border-slate-300 bg-transparent outline-none focus:border-brand-500 px-1" value={tcTransport} onChange={(e) => setTcTransport(e.target.value)} />
            </div>
            <div className="text-slate-600 mb-1">General terms &amp; condition :</div>
            <textarea
              className="w-full text-[11px] leading-snug border border-slate-200 rounded-md p-1.5 outline-none focus:border-brand-500 min-h-[96px]"
              value={tcGeneral}
              onChange={(e) => setTcGeneral(e.target.value)}
            />
          </div>

          {/* Signature footer — no-break keeps GSTIN + signatures on the same page */}
          <div className="grid grid-cols-2 text-[12px] no-break">
            <div className="border-r border-slate-300 px-5 py-2 space-y-1">
              <div className="flex"><span className="w-16 text-slate-500 font-semibold">GSTIN :</span><span className="font-mono">{company?.gstNumber ?? '—'}</span></div>
              <div className="flex"><span className="w-16 text-slate-500 font-semibold">PAN No.:</span><span className="font-mono">{company?.gstNumber ? company.gstNumber.slice(2, 12) : '—'}</span></div>
            </div>
            <div className="px-5 py-2">
              <div className="font-semibold uppercase text-[11px] tracking-wide">For, {company?.name ?? 'Company Name'}</div>
              <div className="grid grid-cols-2 gap-2 mt-8 text-center text-[11px] text-slate-600">
                <div className="border-t border-slate-400 pt-1">Prepared By</div>
                <div className="border-t border-slate-400 pt-1">Authorised By</div>
              </div>
            </div>
          </div>

          {/* Footer slug */}
          <div className="px-5 py-1.5 text-[10px] text-slate-500 border-t border-slate-200 flex items-center justify-between">
            <span>P.O. No. &amp; Date : {po.poNumber} — {fmtDate(po.orderDate)}</span>
            <span>Page 1 of 1</span>
          </div>
        </div>
      </div>
    </div>
  );
};
