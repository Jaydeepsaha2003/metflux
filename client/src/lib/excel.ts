// Tiny wrapper around `xlsx` to keep page code clean.
// Each row is an object whose keys become the header row.
//
// `xlsx` is ~400 KB and is only ever needed the moment someone clicks Export
// or picks a file to import. Importing it at the top of this module made it a
// hard dependency of every page that exports anything — around twenty of them
// — so that weight had to download before the page could render at all. Loaded
// on demand instead, and cached after the first call.
type SheetRows = Record<string, string | number | null | undefined>[];

let xlsxPromise: Promise<typeof import('xlsx')> | null = null;
const loadXlsx = () => (xlsxPromise ??= import('xlsx'));

export const downloadXlsx = async (
  filename: string,
  sheetName: string,
  rows: SheetRows,
  extraSheets: { name: string; rows: SheetRows }[] = [],
) => {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName.slice(0, 31)); // Excel sheet name max 31 chars
  for (const s of extraSheets) {
    if (!s.rows.length) continue;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
};

/** YYYY-MM-DD using local time — safe for filenames. */
export const todayStamp = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Read the first sheet of an uploaded .xlsx/.csv into row objects keyed by the
 *  header row. Every value comes back as a trimmed string. Use for clean header
 *  tables (the bulk import templates). */
export const readXlsx = async (file: File): Promise<Record<string, string>[]> => {
  const XLSX = await loadXlsx();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false });
  return rows.map((r) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) out[String(k).trim()] = String(v ?? '').trim();
    return out;
  });
};

/** Read the first sheet as a raw matrix (array of rows of cell strings). Use
 *  when the file has banner rows before the real header (e.g. Tally exports)
 *  and the server needs to locate the header itself. */
export const readXlsxMatrix = async (file: File): Promise<string[][]> => {
  const XLSX = await loadXlsx();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: false, blankrows: false });
  return rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : []));
};
