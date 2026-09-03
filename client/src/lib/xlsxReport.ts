// Formatted, multi-level report export.
//
// downloadGroupedXlsx (xlsxGrouped.ts) handles a flat two-level "group +
// details" sheet. A report like Production by Employee has three levels
// (employee -> day -> size) and needs real number formats, a title block, a
// frozen header and a grand total, so it gets its own writer rather than
// growing the other one a dozen options.
//
// Uses `xlsx-js-style` — the plain `xlsx` community build cannot write fonts,
// fills or borders.
import * as XLSX from 'xlsx-js-style';

export type Cell = string | number | null | undefined;

export type ReportCol = {
  header: string;
  /** Character width. Falls back to a measurement of the column's contents. */
  width?: number;
  /** Excel number format, e.g. '#,##0.000'. Applied to numeric cells only. */
  numFmt?: string;
  align?: 'left' | 'center' | 'right';
};

/** group = top level (bold, tinted), sub = middle, detail = leaf, total = footer. */
export type ReportRowKind = 'group' | 'sub' | 'detail' | 'total';
export type ReportRow = { kind: ReportRowKind; cells: Cell[] };

const FONT = 'Calibri';
const GREY = 'D9D9D9';

// Outline depth per row kind — Excel renders +/- controls from these, so the
// sheet collapses to employees, then to days, exactly like the page does.
const LEVEL: Record<ReportRowKind, number> = { group: 0, sub: 1, detail: 2, total: 0 };

export const downloadReportXlsx = (opts: {
  filename: string;
  sheetName: string;
  title: string;
  subtitle?: string;
  columns: ReportCol[];
  rows: ReportRow[];
  /** Header fill + title colour, hex without '#'. Defaults to slate-800. */
  accentHex?: string;
}) => {
  const { filename, sheetName, title, subtitle, columns, rows } = opts;
  const accent = (opts.accentHex ?? '1F2937').replace('#', '').toUpperCase();
  const nCols = columns.length;

  // Title, optional subtitle, spacer, header, then the data.
  const TITLE_R = 0;
  const SUB_R = subtitle ? 1 : -1;
  const HEAD_R = subtitle ? 3 : 2;
  const FIRST_DATA_R = HEAD_R + 1;

  const aoa: Cell[][] = [];
  aoa[TITLE_R] = [title, ...Array(Math.max(0, nCols - 1)).fill('')];
  if (subtitle) aoa[SUB_R] = [subtitle, ...Array(Math.max(0, nCols - 1)).fill('')];
  aoa[HEAD_R - 1] = Array(nCols).fill('');
  aoa[HEAD_R] = columns.map((c) => c.header);
  for (const r of rows) {
    const padded = Array.from({ length: nCols }, (_, i) => r.cells[i] ?? '');
    aoa.push(padded);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const lastR = HEAD_R + rows.length;
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastR, c: nCols - 1 } });

  const thin = { style: 'thin', color: { rgb: GREY } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  const at = (r: number, c: number) => {
    const a = XLSX.utils.encode_cell({ r, c });
    return ws[a] || (ws[a] = { t: 's', v: '' });
  };

  // ---- title block -----------------------------------------------------
  ws['!merges'] = [
    { s: { r: TITLE_R, c: 0 }, e: { r: TITLE_R, c: nCols - 1 } },
    ...(subtitle ? [{ s: { r: SUB_R, c: 0 }, e: { r: SUB_R, c: nCols - 1 } }] : []),
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (at(TITLE_R, 0) as any).s = {
    font: { name: FONT, sz: 15, bold: true, color: { rgb: accent } },
    alignment: { vertical: 'center', horizontal: 'left' },
  };
  if (subtitle) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (at(SUB_R, 0) as any).s = {
      font: { name: FONT, sz: 10, color: { rgb: '6B7280' } },
      alignment: { vertical: 'center', horizontal: 'left' },
    };
  }

  // ---- header ----------------------------------------------------------
  for (let c = 0; c < nCols; c++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (at(HEAD_R, c) as any).s = {
      font: { name: FONT, sz: 10, bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: accent } },
      alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
      border,
    };
  }

  // ---- body ------------------------------------------------------------
  rows.forEach((row, i) => {
    const R = FIRST_DATA_R + i;
    for (let c = 0; c < nCols; c++) {
      const cell = at(R, c);
      const col = columns[c];
      const numeric = typeof cell.v === 'number';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const style: any = {
        font: { name: FONT, sz: 10 },
        alignment: {
          vertical: 'center',
          horizontal: col.align ?? (numeric ? 'right' : 'left'),
        },
        border,
      };
      if (row.kind === 'group') {
        style.font = { name: FONT, sz: 10.5, bold: true, color: { rgb: '111827' } };
        style.fill = { fgColor: { rgb: 'E8EDFB' } };
      } else if (row.kind === 'sub') {
        style.font = { name: FONT, sz: 10, bold: true, color: { rgb: '374151' } };
        style.fill = { fgColor: { rgb: 'F3F4F6' } };
      } else if (row.kind === 'total') {
        style.font = { name: FONT, sz: 11, bold: true, color: { rgb: 'FFFFFF' } };
        style.fill = { fgColor: { rgb: accent } };
      } else if (i % 2 === 1) {
        style.fill = { fgColor: { rgb: 'FAFAFA' } };   // subtle banding on details
      }
      if (numeric && col.numFmt) style.numFmt = col.numFmt;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (cell as any).s = style;
    }
  });

  // ---- sheet chrome ----------------------------------------------------
  ws['!rows'] = [
    { hpt: 22 },                                  // title
    ...(subtitle ? [{ hpt: 15 }] : []),
    { hpt: 6 },                                   // spacer
    { hpt: 26 },                                  // header
    ...rows.map((r) => ({ hpt: 16, level: LEVEL[r.kind] })),
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ws as any)['!outline'] = { above: true };

  ws['!cols'] = columns.map((col, c) => {
    if (col.width) return { wch: col.width };
    let w = String(col.header).length;
    for (let R = FIRST_DATA_R; R <= lastR; R++) {
      const v = ws[XLSX.utils.encode_cell({ r: R, c })]?.v;
      if (v != null) w = Math.max(w, String(v).length);
    }
    return { wch: Math.min(Math.max(w + 2, 9), 46) };
  });

  // No freeze pane: xlsx-js-style 1.2.0 parses <pane> but never writes it, so
  // setting '!freeze'/'!panes' here produces nothing (verified against the
  // generated file). The autofilter below gives the header dropdowns instead;
  // the outline levels are what keep a long sheet navigable.
  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range({ s: { r: HEAD_R, c: 0 }, e: { r: lastR, c: nCols - 1 } }),
  };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
};
