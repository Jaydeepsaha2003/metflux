// Reusable bulk Excel toolbar: Template (blank headers + example), Import
// (upload → validate server-side → results), Export (download current rows).
// Each list page passes a small config; all the file I/O + result UI lives here.
import { useRef, useState } from 'react';
import { Download, Upload, FileSpreadsheet, Loader2, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { downloadXlsx, readXlsx, todayStamp } from '@/lib/excel';

export type BulkExcelConfig = {
  /** Plural entity label, e.g. "Customers". */
  entityLabel: string;
  /** Filename stem, e.g. "customers" → customers-2026-06-11.xlsx. */
  filenameBase: string;
  /** Excel sheet name (≤31 chars). */
  sheetName: string;
  /** Template columns — header names + an example value shown in row 1. The
   *  same headers the import endpoint expects. */
  template: { header: string; example: string }[];
  /** Fetch the current records as export rows (objects keyed by column header). */
  fetchExportRows: () => Promise<Record<string, string | number | null | undefined>[]>;
  /** Import endpoint — POST { rows } → ImportResult. */
  importPath: string;
  /** Called after a successful import so the page can refetch. */
  onImported?: () => void;
};

type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; name?: string; message: string }[];
};

export const BulkExcel = ({ config }: { config: BulkExcelConfig }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | 'export' | 'import'>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onTemplate = () => {
    const example: Record<string, string> = {};
    for (const c of config.template) example[c.header] = c.example;
    downloadXlsx(`${config.filenameBase}-template`, config.sheetName, [example]);
  };

  const onExport = async () => {
    setBusy('export'); setError(null);
    try {
      const rows = await config.fetchExportRows();
      if (!rows.length) { setError('Nothing to export yet.'); return; }
      downloadXlsx(`${config.filenameBase}-${todayStamp()}`, config.sheetName, rows);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Export failed.');
    } finally { setBusy(null); }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setBusy('import'); setError(null); setResult(null);
    try {
      const rows = await readXlsx(file);
      if (!rows.length) { setError('That file has no data rows.'); return; }
      const res = await api<ImportResult>(config.importPath, { method: 'POST', json: { rows } });
      setResult(res);
      config.onImported?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Import failed — check the column headers match the template.');
    } finally { setBusy(null); }
  };

  return (
    <div className="flex items-center gap-1.5">
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />
      <button
        type="button" onClick={onTemplate}
        className="btn-ghost text-xs text-slate-600 hover:bg-slate-100"
        title="Download a blank template with the expected columns"
      >
        <FileSpreadsheet className="h-4 w-4" /><span className="hidden sm:inline">Template</span>
      </button>
      <button
        type="button" onClick={() => fileRef.current?.click()} disabled={busy === 'import'}
        className="btn-ghost text-xs text-brand-700 hover:bg-brand-50 disabled:opacity-50"
        title={`Import ${config.entityLabel} from Excel`}
      >
        {busy === 'import' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        <span className="hidden sm:inline">Import</span>
      </button>
      <button
        type="button" onClick={onExport} disabled={busy === 'export'}
        className="btn-ghost text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        title={`Export all ${config.entityLabel} to Excel`}
      >
        {busy === 'export' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        <span className="hidden sm:inline">Export</span>
      </button>

      {/* Error toast */}
      {error && (
        <Modal onClose={() => setError(null)} title="Couldn't process the file" tone="danger">
          <p className="text-sm text-slate-600">{error}</p>
        </Modal>
      )}

      {/* Import results */}
      {result && (
        <Modal onClose={() => setResult(null)} title={`${config.entityLabel} import`} tone="ok">
          <div className="flex flex-wrap gap-3 text-sm">
            <Stat label="Added" value={result.created} tone="ok" />
            <Stat label="Updated" value={result.updated} tone="info" />
            <Stat label="Skipped" value={result.skipped} tone="muted" />
            <Stat label="Errors" value={result.errors.length} tone={result.errors.length ? 'danger' : 'muted'} />
          </div>
          {result.errors.length > 0 && (
            <div className="mt-3 max-h-60 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50">
              <table className="w-full text-xs">
                <thead className="bg-amber-100/60 text-amber-800">
                  <tr><th className="px-2 py-1 text-left">Row</th><th className="px-2 py-1 text-left">Name</th><th className="px-2 py-1 text-left">Problem</th></tr>
                </thead>
                <tbody>
                  {result.errors.map((er, i) => (
                    <tr key={i} className="border-t border-amber-200/60">
                      <td className="px-2 py-1 tabular-nums text-slate-600">{er.row}</td>
                      <td className="px-2 py-1 text-slate-700">{er.name ?? '—'}</td>
                      <td className="px-2 py-1 text-amber-800">{er.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
};

const Stat = ({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'info' | 'muted' | 'danger' }) => {
  const c = tone === 'ok' ? 'text-emerald-700 bg-emerald-50' : tone === 'info' ? 'text-blue-700 bg-blue-50'
    : tone === 'danger' ? 'text-red-700 bg-red-50' : 'text-slate-600 bg-slate-50';
  return (
    <span className={`inline-flex items-baseline gap-1 rounded-lg px-2.5 py-1 font-medium ${c}`}>
      <span className="text-lg font-bold tabular-nums">{value}</span>{label}
    </span>
  );
};

const Modal = ({ title, tone, children, onClose }: {
  title: string; tone: 'ok' | 'danger'; children: React.ReactNode; onClose: () => void;
}) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
    <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
          {tone === 'ok' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-red-600" />}
          {title}
        </h3>
        <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-4 w-4" /></button>
      </div>
      {children}
      <div className="mt-4 flex justify-end">
        <button onClick={onClose} className="btn-primary">Done</button>
      </div>
    </div>
  </div>
);
