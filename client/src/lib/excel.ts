// Tiny wrapper around `xlsx` to keep page code clean.
// Each row is an object whose keys become the header row.
import * as XLSX from 'xlsx';

export const downloadXlsx = (
  filename: string,
  sheetName: string,
  rows: Record<string, string | number | null | undefined>[],
) => {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)); // Excel sheet name max 31 chars
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
};

/** YYYY-MM-DD using local time — safe for filenames. */
export const todayStamp = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
