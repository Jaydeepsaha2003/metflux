// Styled, PO-grouped Excel export (Calibri, banded header, Excel row outline).
// Uses `xlsx-js-style` (a SheetJS fork) because the plain `xlsx` community build
// cannot write fonts/fills/borders. Each group becomes a bold summary row with
// its detail rows nested one outline level below, so Excel shows +/- controls to
// group / ungroup by PO.
import * as XLSX from 'xlsx-js-style';

export type Cell = string | number | null | undefined;
export type XlsxGroup = { summary: Cell[]; rows: Cell[][] };

const CALIBRI = 'Calibri';

export const downloadGroupedXlsx = (opts: {
  filename: string;
  sheetName: string;
  headers: string[];
  groups: XlsxGroup[];
  /** Header fill colour, hex without '#'. Defaults to slate-800. */
  headerHex?: string;
}) => {
  const { filename, sheetName, headers, groups } = opts;
  const headerFill = (opts.headerHex ?? '1F2937').replace('#', '').toUpperCase();

  // Build the sheet as an array-of-arrays, remembering each row's kind so we can
  // style + set outline levels afterwards.
  type Kind = 'header' | 'summary' | 'detail';
  const aoa: Cell[][] = [headers];
  const kinds: Kind[] = ['header'];
  for (const g of groups) {
    aoa.push(g.summary);
    kinds.push('summary');
    for (const r of g.rows) { aoa.push(r); kinds.push('detail'); }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

  const thin = { style: 'thin', color: { rgb: 'D9D9D9' } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };

  for (let R = range.s.r; R <= range.e.r; R++) {
    const kind = kinds[R];
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr] || (ws[addr] = { t: 's', v: '' });
      const numeric = typeof cell.v === 'number';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const style: any = {
        font: { name: CALIBRI, sz: 10 },
        alignment: { vertical: 'center', horizontal: numeric ? 'right' : 'left' },
        border,
      };
      if (kind === 'header') {
        style.font = { name: CALIBRI, sz: 10, bold: true, color: { rgb: 'FFFFFF' } };
        style.fill = { fgColor: { rgb: headerFill } };
        style.alignment = { vertical: 'center', horizontal: 'center', wrapText: true };
      } else if (kind === 'summary') {
        style.font = { name: CALIBRI, sz: 10, bold: true, color: { rgb: '1F2937' } };
        style.fill = { fgColor: { rgb: 'EEF2FF' } };
      }
      cell.s = style;
    }
  }

  // Detail rows sit one outline level below their PO summary row; `above` puts
  // the (parent) summary row on top of the collapsible block.
  ws['!rows'] = kinds.map((k) => (k === 'detail' ? { level: 1 } : {}));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ws as any)['!outline'] = { above: true };

  // Auto-ish column widths from the longest cell in each column (capped).
  ws['!cols'] = headers.map((h, C) => {
    let w = String(h).length;
    for (let R = 1; R <= range.e.r; R++) {
      const v = ws[XLSX.utils.encode_cell({ r: R, c: C })]?.v;
      if (v != null) w = Math.max(w, String(v).length);
    }
    return { wch: Math.min(Math.max(w + 2, 8), 42) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
};
