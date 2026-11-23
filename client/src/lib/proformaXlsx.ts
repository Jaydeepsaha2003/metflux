// The Proforma Invoice as an Excel sheet, laid out like the export workbook it
// reproduces: letterhead and logo, buyer and consignee blocks, shipment grid, item
// table, totals and amount in words, terms of sale, bank details, terms & conditions,
// declaration and signature — on A4 portrait, fitted to one page wide, with the page
// break the original has before "Terms of sale".
//
// ExcelJS rather than the SheetJS build the other exports use: the logo and the
// print setup (paper, fit-to-width, margins, page break, footer) are what make this
// a sheet people print, and SheetJS can write neither.
//
// Values, not formulas: the app has already done the arithmetic, and a sheet that is
// sent to a buyer should not change when somebody types in it.
import { INCOTERMS, PAYMENT_TERMS, PI_CURRENCIES, DECLARATION } from './proformaLists';
import { calcPi, amountWords, fmt2, lineAmount, lineNetWt, type PiForm } from './proforma';

export type PiSettings = {
  address: string; phone: string; email: string; gstin: string; pan: string; iec: string; lutArn: string; adCode: string; rcmc: string;
  beneficiary: string; bankName: string; bankBranch: string; accountNo: string; ifsc: string; swift: string; intermediaryBank: string;
  signatory: string; terms: { title: string; text: string; print: boolean }[];
  lists?: Partial<Record<string, string[]>>;
  tcFormatNo?: string; tcWorks?: string; tcTestMethod?: string; tcCertification?: string; tcTestedBy?: string; tcApprovedBy?: string;
};
export type PiLogo = { base64: string; w: number; h: number };

const GREEN = 'FF178640', GREEN2 = 'FF1DA750', INK = 'FF0F172A', GREY = 'FF475569', TINT = 'FFEDFAF2', TOTAL = 'FFE2E8F0';
const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
const WIDTHS = [5, 24, 18, 10, 7, 6, 10, 11, 13];
const thin = { style: 'thin' as const, color: { argb: 'FFB6C0CC' } };
const box = { top: thin, left: thin, bottom: thin, right: thin };

const dmy = (iso: string) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
const upper = (s: string) => (s ?? '').toUpperCase();

/** Rows a wrapped text needs in a merged span of about `chars` characters. */
const linesFor = (text: string, chars: number) =>
  Math.max(1, text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / chars)), 0));

export const buildProformaWorkbook = async (
  pi: PiForm, s: PiSettings, company: { name: string }, logo?: PiLogo | null,
) => {
  // ExcelJS is CommonJS: depending on the bundler its API is the module itself or its default.
  const mod = await import('exceljs');
  const ExcelJS = ((mod as unknown as { default?: typeof mod }).default ?? mod);
  const wb = new ExcelJS.Workbook();
  wb.creator = company.name;
  const ws = wb.addWorksheet('Proforma Invoice', { views: [{ showGridLines: false }] });
  COLS.forEach((c, i) => { ws.getColumn(c).width = WIDTHS[i]; });

  const calc = calcPi(pi);
  const cur = PI_CURRENCIES.find((c) => c.code === pi.currency);
  let r = 0;
  const height = (row: number, h: number) => { ws.getRow(row).height = h; };

  /** Write `value` into the span c1..c2 of row `row` (merged when it spans more than one column). */
  const put = (row: number, c1: string, c2: string, value: unknown, o: {
    size?: number; bold?: boolean; color?: string; fill?: string; h?: 'left' | 'center' | 'right'; v?: 'top' | 'middle';
    wrap?: boolean; border?: boolean; fmt?: string; top?: boolean; leftThick?: boolean; row2?: number;
  } = {}) => {
    const end = o.row2 ?? row;
    if (c1 !== c2 || end !== row) ws.mergeCells(`${c1}${row}:${c2}${end}`);
    const cell = ws.getCell(`${c1}${row}`);
    cell.value = value as never;
    cell.font = { name: 'Arial', size: o.size ?? 8.5, bold: o.bold, color: { argb: o.color ?? INK } };
    cell.alignment = { horizontal: o.h, vertical: o.v ?? 'middle', wrapText: o.wrap };
    if (o.fmt) cell.numFmt = o.fmt;
    // Fill and border on every cell of the span, or Excel draws only the first one's.
    const from = COLS.indexOf(c1), to = COLS.indexOf(c2);
    for (let rr = row; rr <= end; rr += 1) for (let i = from; i <= to; i += 1) {
      const t = ws.getCell(`${COLS[i]}${rr}`);
      if (o.fill) t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
      if (o.border) t.border = box;
      if (o.top) t.border = { top: thin };
      if (o.leftThick && i === from) t.border = { left: { style: 'thick', color: { argb: GREEN } } };
    }
  };
  const banner = (row: number, text: string, c1 = 'A', c2 = 'I') =>
    put(row, c1, c2, text, { size: 8.5, bold: true, color: 'FFFFFFFF', fill: GREEN });
  const label = (row: number, c1: string, c2: string, text: string, size = 8) =>
    put(row, c1, c2, text, { size, bold: true, color: GREEN });

  // ── letterhead ──
  height(1, 6);
  put(2, 'A', 'F', company.name, { size: 17, bold: true, color: GREEN, h: 'left' }); height(2, 24);
  const letter: string[] = [
    s.address,
    `Tel: ${s.phone}   |   Email: ${s.email}`,
    `GSTIN: ${s.gstin}   |   PAN: ${s.pan}`,
    `IEC: ${s.iec}   |   LUT ARN: ${s.lutArn}${s.rcmc ? `   |   RCMC: ${s.rcmc}` : ''}`,
  ];
  letter.forEach((t, i) => { put(3 + i, 'A', 'F', t, { size: 8, color: GREY, h: 'left' }); height(3 + i, 12); });
  height(7, 12);
  if (logo) {
    const k = Math.min(1, 150 / logo.w, 92 / logo.h);
    const w = Math.round(logo.w * k), h = Math.round(logo.h * k);
    const id = wb.addImage({ base64: logo.base64, extension: 'png' });
    // Right-aligned inside columns H and I. ExcelJS's fractional anchors only reach a few
    // pixels, so the offset is given natively, in EMU (9525 per pixel), from column H.
    const colH = 82, colI = 96;                       // their widths in pixels
    const off = Math.max(0, colH + colI - w - 6);
    ws.addImage(id, {
      tl: { nativeCol: off >= colH ? 8 : 7, nativeColOff: (off >= colH ? off - colH : off) * 9525, nativeRow: 1, nativeRowOff: 12000 } as never,
      ext: { width: w, height: h },
    });
  }
  put(8, 'F', 'I', 'PROFORMA INVOICE', { size: 12, bold: true, color: 'FFFFFFFF', fill: GREEN, h: 'center' }); height(8, 19.95);
  height(9, 4.05);

  // ── buyer + invoice particulars ──
  label(11, 'A', 'D', 'BUYER (BILL TO)');
  const buyerLines = [
    pi.buyerName, pi.buyerAddr1, pi.buyerAddr2, upper(pi.buyerCountry),
    `Tel: ${pi.buyerPhone}${pi.buyerEmail ? `   Email: ${pi.buyerEmail}` : ''}`,
    [pi.buyerContact && `Attn: ${pi.buyerContact}`, pi.buyerTaxId && `Tax / Reg. No.: ${pi.buyerTaxId}`].filter(Boolean).join('   |   '),
  ];
  const meta: [string, unknown, string?][] = [
    ['PI No.', pi.piNumber], ['PI Date', dmy(pi.piDate)], ['Valid Until', dmy(pi.validUntil)],
    ['Buyer PO / Ref.', `${pi.poRef}${pi.poDate ? ` dt. ${dmy(pi.poDate)}` : ''}`],
    ['Our Quotation Ref.', pi.quotationRef], ['Currency', `${pi.currency} — ${cur?.name ?? ''}`],
  ];
  buyerLines.forEach((t, i) => {
    const row = 12 + i; height(row, 13.05);
    put(row, 'A', 'D', t, { size: i === 0 ? 10 : 8.5, bold: i === 0 });
    put(row, 'E', 'G', meta[i][0], { size: 8.5, bold: true, color: GREY, h: 'left' });
    put(row, 'H', 'I', meta[i][1], { size: 8.5, bold: true, h: 'left' });
  });

  // ── consignee + notify ──
  const same = pi.consigneeSame === 'Yes';
  label(19, 'A', 'D', 'CONSIGNEE (SHIP TO)'); label(19, 'E', 'I', 'NOTIFY PARTY');
  const cons = same
    ? [pi.buyerName, pi.buyerAddr1, pi.buyerAddr2, upper(pi.buyerCountry), `Tel: ${pi.buyerPhone}`]
    : [pi.consName, pi.consAddr1, pi.consAddr2, upper(pi.consCountry), `Tel: ${pi.consPhone}`];
  cons.forEach((t, i) => { height(20 + i, 13.05); put(20 + i, 'A', 'D', t, { size: 8.5, bold: i === 0 }); });
  put(20, 'E', 'I', pi.notifyParty, { size: 8.5, wrap: true, v: 'top', row2: 24 });

  // ── shipment & commercial details ──
  banner(26, 'SHIPMENT & COMMERCIAL DETAILS'); height(26, 15);
  const grid: [string, string, string, string][] = [
    ['Country of Origin', pi.originCountry, 'Country of Final Destination', pi.destCountry],
    ['Port of Loading', pi.portLoading, 'Port of Discharge', pi.portDischarge],
    ['Pre-carriage by', pi.precarriage, 'Final Place of Delivery', pi.placeDelivery],
    ['Mode of Transport', pi.transportMode, 'Container', pi.container],
    ['Partial Shipment', pi.partialShipment, 'Transshipment', pi.transshipment],
    ['Incoterms® 2020', `${pi.incoterm} ${pi.incotermPlace}`, 'Shipment / Lead Time', pi.leadTime],
  ];
  grid.forEach(([a, b, c, d], i) => {
    const row = 27 + i; height(row, 13.95);
    put(row, 'A', 'B', a, { size: 7.5, bold: true, color: GREY, border: true });
    put(row, 'C', 'D', b, { bold: true, border: true });
    put(row, 'E', 'G', c, { size: 7.5, bold: true, color: GREY, border: true });
    put(row, 'H', 'I', d, { bold: true, border: true });
  });

  // ── items ──
  r = 34;
  const money = `${pi.currency}`;
  const head: [string, string, string, string?][] = [
    ['A', 'A', 'S.N', 'center'], ['B', 'C', 'Description of Goods', 'left'], ['D', 'D', 'HSN Code', 'center'], ['E', 'E', 'Qty', 'right'],
    ['F', 'F', 'Unit', 'center'], ['G', 'G', 'Net Wt (kg)', 'right'], ['H', 'H', `Unit Price (${money})`, 'right'], ['I', 'I', `Amount (${money})`, 'right'],
  ];
  head.forEach(([c1, c2, t, h]) => put(r, c1, c2, t, { size: 8, bold: true, color: 'FFFFFFFF', fill: GREEN2, h: h as 'left', wrap: true }));
  height(r, 22.05);
  const lines = pi.items.filter((i) => i.desc.trim());
  lines.forEach((it, i) => {
    r += 1;
    const text = it.desc + (it.grade ? `\nGrade: ${it.grade}` : '');
    height(r, Math.max(22.95, linesFor(text, 50) * 11.5 + 2));
    const b = { border: true, v: 'top' as const, size: 8.5 };
    put(r, 'A', 'A', i + 1, { ...b, h: 'center' });
    put(r, 'B', 'C', text, { ...b, bold: true, wrap: true });
    put(r, 'D', 'D', it.hsn, { ...b, h: 'center' });
    put(r, 'E', 'E', it.qty, { ...b, h: 'right', fmt: '#,##0' });
    put(r, 'F', 'F', it.unit, { ...b, h: 'center' });
    put(r, 'G', 'G', lineNetWt(it), { ...b, h: 'right', fmt: '#,##0.00' });
    put(r, 'H', 'H', it.price, { ...b, h: 'right', fmt: '#,##0.00' });
    put(r, 'I', 'I', lineAmount(it), { ...b, h: 'right', bold: true, fmt: '#,##0.00' });
  });
  r += 1; height(r, 16.05);
  put(r, 'A', 'D', 'Total', { bold: true, fill: TOTAL, h: 'right' });
  put(r, 'E', 'E', calc.qty, { bold: true, fill: TOTAL, h: 'right', fmt: '#,##0' });
  put(r, 'F', 'F', lines[0]?.unit ?? '', { bold: true, fill: TOTAL, h: 'center' });
  put(r, 'G', 'G', calc.netWt, { bold: true, fill: TOTAL, h: 'right', fmt: '#,##0.00' });
  put(r, 'H', 'H', '', { fill: TOTAL });
  put(r, 'I', 'I', calc.goods, { bold: true, fill: TOTAL, h: 'right', fmt: '#,##0.00' });

  // ── words, charges, packing ──
  const top = r + 1;
  put(top, 'A', 'D', 'AMOUNT IN WORDS', { size: 7.5, bold: true, color: GREY });
  put(top + 1, 'A', 'F', amountWords(calc.grand, pi.currency), { size: 9, bold: true, wrap: true, v: 'top', row2: top + 2 });
  const sums: [string, number][] = [
    ['Goods Value', calc.goods], [`Export Packing @ ${(pi.packingPct * 100).toFixed(1)}%`, calc.packing], ['Freight', calc.freight],
    ['Insurance', calc.insurance], [pi.otherLabel || 'Other charges', calc.other], ['Discount', calc.discount],
  ];
  sums.forEach(([t, v], i) => {
    put(top + i, 'G', 'H', t, { color: GREY, h: 'left' });
    put(top + i, 'I', 'I', v, { h: 'right', fmt: '#,##0.00;-#,##0.00;"-"' });
  });
  const grandRow = top + 6;
  put(grandRow, 'G', 'H', 'GRAND TOTAL', { size: 10, bold: true, color: 'FFFFFFFF', fill: GREEN });
  put(grandRow, 'I', 'I', `${pi.currency} ${fmt2(calc.grand)}`, { size: 10, bold: true, color: 'FFFFFFFF', fill: GREEN, h: 'right' });
  height(grandRow, 19.95);
  put(top + 3, 'A', 'F', 'PACKING DETAILS', { size: 7.5, bold: true, color: GREY });
  put(top + 4, 'A', 'F', `Packages: ${pi.packages} ${pi.packageType}   |   Net Wt: ${fmt2(calc.netWt)} kg   |   Gross Wt: ${fmt2(pi.grossWeight || 0)} kg${pi.volume ? `   |   ${pi.volume} CBM` : ''}`, { size: 8, wrap: true });
  put(top + 5, 'A', 'F', pi.marks ? `Shipping Marks: ${pi.marks}` : '', { size: 8, wrap: true });
  put(grandRow, 'A', 'F', calc.advPct > 0 ? `Advance payable now (${Math.round(calc.advPct * 100)}%): ${pi.currency} ${fmt2(calc.advance)}` : '', { size: 8.5, bold: true, color: GREEN });
  r = grandRow;

  // ── terms of sale (starts the second printed page, as in the original) ──
  r += 2;
  const pageBreakAfter = r - 1;
  banner(r, 'TERMS OF SALE'); height(r, 15);
  const inc = INCOTERMS.find((i) => i.code === pi.incoterm);
  const pay = PAYMENT_TERMS.find((p) => p.name === pi.paymentTerms);
  const docs = ([
    [pi.docInvoice, 'Commercial Invoice'], [pi.docPacking, 'Packing List'], [pi.docBl, 'Bill of Lading / AWB'],
    [pi.docCoo, 'Certificate of Origin'], [pi.docAifta, 'Preferential CoO (AIFTA Form AI)'], [pi.docTest, 'Test Certificate'],
    [pi.docIspm, 'ISPM-15 Certificate'], [pi.docInsurance, 'Insurance Certificate'],
  ] as [string, string][]).filter(([y]) => y === 'Yes').map(([, n]) => `${n}; `).join('');
  const sale: [string, string][] = [
    ['Payment Terms', pay?.text ?? pi.paymentTerms],
    ['Delivery Terms', `${pi.incoterm} (${inc?.name ?? ''}) — ${pi.incotermPlace}, as per Incoterms® 2020.`],
    ['Price Basis', pi.priceBasis], ['Bank Charges', pi.bankCharges], ['Inspection', pi.inspection],
    ['Documents', docs], ['GST / Export', pi.exportType],
  ];
  sale.forEach(([k, v]) => {
    r += 1; height(r, Math.max(13.95, linesFor(v, 70) * 11.5 + 3));
    put(r, 'A', 'B', k, { bold: true, border: true, v: 'top' });
    put(r, 'C', 'I', v, { border: true, v: 'top', wrap: true });
  });

  // ── bank ──
  r += 2; banner(r, 'BANK DETAILS FOR REMITTANCE'); height(r, 15);
  const bank: [string, string, string, string][] = [
    ['Beneficiary', s.beneficiary, 'Bank', s.bankName],
    ['Account No.', s.accountNo, 'SWIFT / BIC', s.swift],
    ['Branch', s.bankBranch, 'IFSC', s.ifsc],
    ['AD Code', s.adCode, 'Intermediary Bank', s.intermediaryBank],
  ];
  bank.forEach(([a, b, c, d]) => {
    r += 1; height(r, Math.max(13.95, linesFor(b, 34) * 11.5 + 3, linesFor(d, 36) * 11.5 + 3));
    put(r, 'A', 'B', a, { size: 7.5, bold: true, color: GREY, border: true });
    put(r, 'C', 'D', b, { bold: true, border: true, wrap: true });
    put(r, 'E', 'F', c, { size: 7.5, bold: true, color: GREY, border: true });
    put(r, 'G', 'I', d, { bold: true, border: true, wrap: true });
  });
  r += 1; height(r, 12);
  put(r, 'A', 'I', "Please quote the PI number in the remittance details. All bank charges as per 'Bank Charges' above.", { size: 7.5, color: GREY });

  // ── terms & conditions ──
  r += 2; banner(r, 'TERMS & CONDITIONS'); height(r, 15);
  s.terms.filter((t) => t.print && t.title.trim()).forEach((t, i) => {
    r += 1;
    const text = `${t.title}: ${t.text}`;
    height(r, Math.max(15, linesFor(text, 118) * 10.5 + 4));
    put(r, 'A', 'A', `${i + 1}.`, { size: 8, bold: true, fill: TINT, h: 'center', v: 'top', leftThick: true });
    put(r, 'B', 'I', text, { size: 8, fill: TINT, wrap: true, v: 'top' });
  });

  // ── declaration + signature ──
  r += 2; put(r, 'A', 'I', 'DECLARATION', { size: 7.5, bold: true, color: GREY, h: 'left' });
  r += 1; height(r, 26); put(r, 'A', 'I', DECLARATION, { size: 8, wrap: true, v: 'top' });
  r += 2; label(r, 'A', 'D', 'ACCEPTED BY BUYER', 8.5);
  put(r, 'F', 'I', `For ${company.name}`, { bold: true, h: 'right' });
  r += 1; height(r, 42);
  r += 1; put(r, 'A', 'D', 'Signature, name & company seal', { size: 8, color: GREY, top: true });
  put(r, 'F', 'I', s.signatory ? `${s.signatory} — Authorised Signatory` : 'Authorised Signatory', { bold: true, h: 'right', top: true });
  r += 1; put(r, 'A', 'D', 'Date:', { size: 8, color: GREY, h: 'left' });
  put(r, 'F', 'I', 'E. & O.E.', { size: 8, color: GREY, h: 'right' });

  // ── printing: A4 portrait, one page wide, centred, footer with page numbers ──
  ws.pageSetup = {
    paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
    printArea: `A1:I${r}`,
    margins: { left: 0.35, right: 0.35, top: 0.35, bottom: 0.5, header: 0.2, footer: 0.25 },
  };
  ws.headerFooter.oddFooter = `&L&"Arial"&7Proforma Invoice — ${company.name.replace(/&/g, '&&')}&R&"Arial"&7Page &P of &N`;
  ws.getRow(pageBreakAfter).addPageBreak();

  return wb;
};

/** Browser entry: fetch nothing, just build and save. The logo (any format the browser
 *  can read) is re-encoded as PNG, the one ExcelJS accepts besides JPEG. */
export const downloadProformaXlsx = async (
  pi: PiForm, s: PiSettings, company: { name: string; logoUrl?: string | null },
) => {
  let logo: PiLogo | null = null;
  if (company.logoUrl) {
    try {
      const { dataUrlToPng } = await import('./image');
      const p = await dataUrlToPng(company.logoUrl, 400);
      logo = { base64: p.dataUrl.replace(/^data:image\/png;base64,/, ''), w: p.w, h: p.h };
    } catch { /* an unreadable logo must not stop the sheet */ }
  }
  const wb = await buildProformaWorkbook(pi, s, company, logo);
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `Proforma-Invoice-${pi.piNumber.replace(/[\\/:*?"<>|]/g, '-') || 'draft'}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
};
