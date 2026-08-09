// Lorry Receipts (LR / transport consignment) record book — browse / search
// saved LRs, print, edit, delete, and import/export the FULL record set as a
// nicely formatted Excel file (round-trips losslessly with itself).
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Truck, Plus, Search, Pencil, Trash2, FileText, Loader2, Download, Upload, Settings, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useConfirm } from '@/hooks/useConfirm';
import { Pagination } from '@/components/Pagination';
import { readXlsx, todayStamp } from '@/lib/excel';
import { downloadStyledXlsx } from '@/lib/xlsxGrouped';
import { type LorryReceipt, type LrTransporter, inrLR } from '@/lib/lr';

const PAGE_SIZE = 20;

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const isoDate = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

const PAY_STYLE: Record<LorryReceipt['paymentMode'], string> = {
  'TO-PAY': 'bg-amber-50 text-amber-700',
  PAID: 'bg-emerald-50 text-emerald-700',
  TBB: 'bg-slate-100 text-slate-500',
};

// Full field set for a lossless round-trip — Export writes exactly these
// headers, Import reads them back (order-independent, matched by name).
const FULL_HEADERS = [
  'LR No', 'LR Date', 'Transporter',
  'Consignor Name', 'Consignor Address', 'Consignor GSTIN', 'Consignor Mobile',
  'Consignee Name', 'Consignee Address', 'Consignee GSTIN', 'Consignee Mobile',
  'From', 'To', 'Packages', 'Method', 'Particular',
  'Actual Wt', 'Charged Wt', 'Rate', 'ST Charge', 'Risk FOV %', 'Hamali', 'Other Charge', 'D/D Charge', 'Total Value',
  'Invoice No', 'Invoice Date', 'E-Way Bill No', 'Mode Of Dispatch', 'Payment Mode', 'Goods Declared Value',
  'Vehicle No', 'Dispatch Date', 'Remark',
] as const;

// Header text → the lrSchema field it feeds, so import is header-order-independent.
const HEADER_FIELD: Record<string, string> = {
  'LR No': 'lrNo', 'LR Date': 'lrDate', 'Transporter': '_transporterName',
  'Consignor Name': 'consignorName', 'Consignor Address': 'consignorAddress', 'Consignor GSTIN': 'consignorGstin', 'Consignor Mobile': 'consignorMobile',
  'Consignee Name': 'consigneeName', 'Consignee Address': 'consigneeAddress', 'Consignee GSTIN': 'consigneeGstin', 'Consignee Mobile': 'consigneeMobile',
  'From': 'fromLoc', 'To': 'toLoc', 'Packages': 'packages', 'Method': 'packMethod', 'Particular': 'particular',
  'Actual Wt': 'actualWt', 'Charged Wt': 'chargedWt', 'Rate': 'rate', 'ST Charge': 'stCh', 'Risk FOV %': 'riskFovPct',
  'Hamali': 'hamali', 'Other Charge': 'otherCh', 'D/D Charge': 'ddCh', 'Total Value': '_ignore',
  'Invoice No': 'invNo', 'Invoice Date': 'invDate', 'E-Way Bill No': 'ewayBillNo', 'Mode Of Dispatch': 'modeOfDispatch',
  'Payment Mode': 'paymentMode', 'Goods Declared Value': 'valueDeclare',
  'Vehicle No': 'vehNo', 'Dispatch Date': 'dispatchDate', 'Remark': 'remark',
};

const normPayMode = (s: string): 'TO-PAY' | 'PAID' | 'TBB' => {
  const u = s.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (u.includes('PAID')) return 'PAID';
  if (u === 'TBB') return 'TBB';
  return 'TO-PAY';
};

export const LorryReceiptsPage = () => {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const changePageSize = (n: number) => { setPageSize(n); setPage(1); };
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [banner, setBanner] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['lorry-receipts', page, pageSize, search],
    queryFn: () =>
      api<{ items: LorryReceipt[]; total: number; page: number; pageSize: number }>(
        `/lorry-receipts?page=${page}&pageSize=${pageSize}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      ),
  });
  const rows = data?.items ?? [];

  const { data: transportersResp } = useQuery({
    queryKey: ['lr-transporters'],
    queryFn: () => api<{ items: LrTransporter[] }>('/lorry-receipts/transporters'),
  });
  const transporters = transportersResp?.items ?? [];

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/lorry-receipts/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lorry-receipts'] }),
  });

  const onDelete = async (r: LorryReceipt) => {
    const ok = await confirm({
      title: `Delete ${r.lrNo}?`,
      message: 'This permanently removes the lorry receipt. This cannot be undone.',
      tone: 'danger',
      confirmLabel: 'Delete',
    });
    if (ok) deleteMut.mutate(r.id);
  };

  /* Export EVERY matching LR (not just this page) as a fully formatted,
     lossless workbook — every field the form captures, Calibri + banded header. */
  const onExport = async () => {
    setBusy('export'); setBanner(null);
    try {
      const all = await api<{ items: LorryReceipt[] }>(
        `/lorry-receipts?page=1&pageSize=10000${search ? `&search=${encodeURIComponent(search)}` : ''}`,
      );
      const nameOf = new Map(transporters.map((t) => [t.id, t.name]));
      const body = all.items.map((r) => [
        r.lrNo, isoDate(r.lrDate), (r.transporterId && nameOf.get(r.transporterId)) || '',
        r.consignorName, r.consignorAddress ?? '', r.consignorGstin ?? '', r.consignorMobile ?? '',
        r.consigneeName, r.consigneeAddress ?? '', r.consigneeGstin ?? '', r.consigneeMobile ?? '',
        r.fromLoc ?? '', r.toLoc ?? '', r.packages, r.packMethod ?? '', r.particular ?? '',
        r.actualWt, r.chargedWt, r.rate, r.stCh, r.riskFovPct, r.hamali, r.otherCh, r.ddCh, r.totalValue,
        r.invNo ?? '', isoDate(r.invDate), r.ewayBillNo ?? '', r.modeOfDispatch ?? '', r.paymentMode, r.valueDeclare,
        r.vehNo ?? '', isoDate(r.dispatchDate), r.remark ?? '',
      ]);
      downloadStyledXlsx({
        filename: `lorry-receipts-${todayStamp()}`,
        sheetName: 'Lorry Receipts',
        headers: [...FULL_HEADERS],
        rows: body,
      });
    } finally { setBusy(null); }
  };

  /* Import a workbook in the SAME format Export produces (header-matched, so
     column order doesn't matter). Creates new LRs; existing LR numbers are
     skipped server-side, so re-importing the same file is safe. */
  const onImportFile = async (file: File) => {
    setBusy('import'); setBanner(null);
    try {
      const sheetRows = await readXlsx(file);
      if (!sheetRows.length) { setBanner({ tone: 'err', text: 'No rows found in that file.' }); return; }
      const nameToId = new Map(transporters.map((t) => [t.name.trim().toUpperCase(), t.id]));
      const payload = sheetRows.map((row) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rec: Record<string, any> = {};
        for (const [header, raw] of Object.entries(row)) {
          const field = HEADER_FIELD[header.trim()];
          if (!field || field === '_ignore') continue;
          if (field === '_transporterName') {
            const id = nameToId.get(String(raw).trim().toUpperCase());
            if (id) rec.transporterId = id;
            continue;
          }
          rec[field] = raw;
        }
        if (rec.paymentMode) rec.paymentMode = normPayMode(String(rec.paymentMode));
        return rec;
      }).filter((r) => r.lrNo && r.consignorName && r.consigneeName);

      if (!payload.length) { setBanner({ tone: 'err', text: 'No valid rows — check the file has LR No / Consignor Name / Consignee Name columns.' }); return; }

      const res = await api<{ imported: number; skipped: number; errors: string[] }>('/lorry-receipts/import', {
        method: 'POST', body: JSON.stringify({ rows: payload }),
      });
      queryClient.invalidateQueries({ queryKey: ['lorry-receipts'] });
      setBanner({
        tone: res.errors.length ? 'err' : 'ok',
        text: `Imported ${res.imported}, skipped ${res.skipped} duplicate(s)${res.errors.length ? `, ${res.errors.length} error(s): ${res.errors.slice(0, 3).join('; ')}` : '.'}`,
      });
    } catch (e) {
      setBanner({ tone: 'err', text: e instanceof Error ? e.message : 'Import failed.' });
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 rounded-xl bg-brand-600 px-4 py-3.5 text-white shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/15 ring-1 ring-white/20">
            <Truck className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-base font-bold leading-tight tracking-wide sm:text-lg">Lorry Receipts</h1>
            <p className="text-[11px] text-white/75">LR record book · print, edit, import/export</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/lr/settings" className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/15 px-3 py-2 text-sm font-semibold text-white hover:bg-white/25" title="Transporter settings">
            <Settings className="h-4 w-4" /> Settings
          </Link>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/15 px-3 py-2 text-sm font-semibold text-white hover:bg-white/25 disabled:opacity-50">
            {busy === 'import' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Import
          </button>
          <button type="button" onClick={onExport} disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/25 bg-white/15 px-3 py-2 text-sm font-semibold text-white hover:bg-white/25 disabled:opacity-50"
            title="Download every matching LR as a formatted Excel file">
            {busy === 'export' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export
          </button>
          <Link to="/lr/new" className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-white/90">
            <Plus className="h-4 w-4" /> New LR
          </Link>
        </div>
      </div>

      {banner && (
        <div className={cn('flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm', banner.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800')}>
          {banner.tone === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{banner.text}</span>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="input h-9 w-full pl-8 text-sm"
          placeholder="Search LR #, consignor, consignee, vehicle, invoice…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          No lorry receipts yet. Click <span className="font-medium">New LR</span> to create one, or <span className="font-medium">Import</span> an Excel file.
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead>
                <tr className="border-b-2 border-slate-300 bg-slate-100 text-left text-[10.5px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-semibold">LR No</th>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Consignor</th>
                  <th className="px-3 py-2 font-semibold">Consignee</th>
                  <th className="px-3 py-2 font-semibold">Route</th>
                  <th className="px-3 py-2 text-center font-semibold">Pkgs</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                  <th className="px-3 py-2 text-center font-semibold">Pay</th>
                  <th className="px-3 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 last:border-0 odd:bg-white even:bg-slate-50/40 hover:bg-brand-50/40">
                    <td className="px-3 py-1.5">
                      <Link to={`/lr/${r.id}/print`} className="font-mono font-medium text-brand-700 hover:underline">{r.lrNo}</Link>
                    </td>
                    <td className="px-3 py-1.5 text-slate-600">{fmtDate(r.lrDate)}</td>
                    <td className="px-3 py-1.5 font-medium text-slate-800">{r.consignorName}</td>
                    <td className="px-3 py-1.5 text-slate-700">{r.consigneeName}</td>
                    <td className="px-3 py-1.5 text-slate-600">{(r.fromLoc || '—')} → {(r.toLoc || '—')}</td>
                    <td className="px-3 py-1.5 text-center tabular-nums text-slate-600">{r.packages}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">₹{inrLR(r.totalValue)}</td>
                    <td className="px-3 py-1.5 text-center">
                      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', PAY_STYLE[r.paymentMode])}>
                        {r.paymentMode}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        <Link to={`/lr/${r.id}/print`} title="Print / PDF" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"><FileText className="h-4 w-4" /></Link>
                        <Link to={`/lr/${r.id}/edit`} title="Edit LR" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Pencil className="h-4 w-4" /></Link>
                        <button type="button" onClick={() => onDelete(r)} title="Delete" className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPageChange={setPage} onPageSizeChange={changePageSize} />
          </div>

          {/* Mobile stacked cards */}
          <div className="space-y-3 md:hidden">
            {rows.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/lr/${r.id}/print`} className="font-mono font-medium text-brand-700 hover:underline">{r.lrNo}</Link>
                    <div className="mt-0.5 truncate font-medium text-slate-800">{r.consignorName}</div>
                    <div className="truncate text-sm text-slate-600">→ {r.consigneeName}</div>
                  </div>
                  <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium', PAY_STYLE[r.paymentMode])}>
                    {r.paymentMode}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Date</div>
                    <div className="text-slate-600">{fmtDate(r.lrDate)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Pkgs</div>
                    <div className="tabular-nums text-slate-600">{r.packages}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400">Total</div>
                    <div className="tabular-nums font-semibold">₹{inrLR(r.totalValue)}</div>
                  </div>
                </div>
                <div className="mt-2 text-sm text-slate-600">
                  <span className="text-[11px] uppercase tracking-wide text-slate-400">Route </span>
                  {(r.fromLoc || '—')} → {(r.toLoc || '—')}
                </div>
                <div className="mt-3 flex items-center justify-end gap-1 border-t border-slate-100 pt-3">
                  <Link to={`/lr/${r.id}/print`} title="Print / PDF" className="rounded p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"><FileText className="h-4 w-4" /></Link>
                  <Link to={`/lr/${r.id}/edit`} title="Edit LR" className="rounded p-2 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Pencil className="h-4 w-4" /></Link>
                  <button type="button" onClick={() => onDelete(r)} title="Delete" className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
            <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} onPageChange={setPage} onPageSizeChange={changePageSize} />
          </div>
        </>
      )}
      {confirmDialog}
    </div>
  );
};

export default LorryReceiptsPage;
