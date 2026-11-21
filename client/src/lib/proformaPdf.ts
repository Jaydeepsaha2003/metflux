// The Proforma Invoice as a vector PDF: the same content and the same order as the
// Excel sheet (lib/proformaXlsx.ts) — letterhead and logo, buyer / consignee / notify,
// shipment grid, items, totals and amount in words, terms of sale, bank details,
// numbered terms & conditions, declaration, signature — in the company's brand colour,
// on A4 portrait, through pdfmake like the Packing List and Quotation.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { brandShadeHex } from '@/lib/brandColor';
import { loadPdfMake } from '@/lib/reportPdf';
import { INCOTERMS, PAYMENT_TERMS, PI_CURRENCIES, DECLARATION } from './proformaLists';
import { amountWords, calcPi, fmt2, lineAmount, lineNetWt, type PiForm } from './proforma';
import type { PiSettings, PiLogo } from './proformaXlsx';

const INK = '#0f172a', GREY = '#475569', LIGHT = '#cbd5e1', WHITE = '#ffffff';
const dmy = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

export const buildProformaPdfDoc = (
  pi: PiForm, s: PiSettings, company: { name: string }, brand: string | null, logo?: PiLogo | null,
) => {
  const dark = brandShadeHex(brand, 700);
  const mid = brandShadeHex(brand, 600);
  const tint = brandShadeHex(brand, 50);
  const calc = calcPi(pi);
  const cur = PI_CURRENCIES.find((c) => c.code === pi.currency);
  const lines = pi.items.filter((i) => i.desc.trim());

  const label = (t: string) => ({ text: t, fontSize: 7.5, bold: true, color: dark, margin: [0, 0, 0, 2] });
  const banner = (t: string) => ({
    table: { widths: ['*'], body: [[{ text: t, color: WHITE, bold: true, fontSize: 8.5, fillColor: dark, margin: [6, 3, 6, 3] }]] },
    layout: 'noBorders', margin: [0, 8, 0, 0],
  });
  const grid = { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => LIGHT, vLineColor: () => LIGHT, paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 2.5, paddingBottom: () => 2.5 };
  const k = (t: string) => ({ text: t, fontSize: 7.5, bold: true, color: GREY });
  const v = (t: string) => ({ text: t || '', fontSize: 8.5, bold: true });

  // ── letterhead ──
  const head: any = {
    columns: [
      { width: '*', stack: [
        { text: company.name, fontSize: 17, bold: true, color: dark },
        { text: s.address, fontSize: 8, color: GREY, margin: [0, 2, 0, 0] },
        { text: `Tel: ${s.phone}   |   Email: ${s.email}`, fontSize: 8, color: GREY },
        { text: `GSTIN: ${s.gstin}   |   PAN: ${s.pan}`, fontSize: 8, color: GREY },
        { text: `IEC: ${s.iec}   |   LUT ARN: ${s.lutArn}${s.rcmc ? `   |   RCMC: ${s.rcmc}` : ''}`, fontSize: 8, color: GREY },
      ] },
      { width: 190, stack: [
        ...(logo ? [{ image: `data:image/png;base64,${logo.base64}`, fit: [130, 62], alignment: 'right', margin: [0, 0, 0, 6] }] : []),
        { table: { widths: ['*'], body: [[{ text: 'PROFORMA INVOICE', color: WHITE, bold: true, fontSize: 12, alignment: 'center', fillColor: dark, margin: [0, 5, 0, 5] }]] }, layout: 'noBorders' },
      ] },
    ],
    columnGap: 12,
  };

  // ── buyer, particulars ──
  const buyer = [pi.buyerName, pi.buyerAddr1, pi.buyerAddr2, (pi.buyerCountry || '').toUpperCase(),
    `Tel: ${pi.buyerPhone}${pi.buyerEmail ? `   Email: ${pi.buyerEmail}` : ''}`,
    [pi.buyerContact && `Attn: ${pi.buyerContact}`, pi.buyerTaxId && `Tax / Reg. No.: ${pi.buyerTaxId}`].filter(Boolean).join('   |   ')].filter(Boolean);
  const meta: [string, string][] = [
    ['PI No.', pi.piNumber], ['PI Date', dmy(pi.piDate)], ['Valid Until', dmy(pi.validUntil)],
    ['Buyer PO / Ref.', `${pi.poRef}${pi.poDate ? ` dt. ${dmy(pi.poDate)}` : ''}`],
    ['Our Quotation Ref.', pi.quotationRef], ['Currency', `${pi.currency} — ${cur?.name ?? ''}`],
  ];
  const same = pi.consigneeSame === 'Yes';
  const cons = (same ? [pi.buyerName, pi.buyerAddr1, pi.buyerAddr2, (pi.buyerCountry || '').toUpperCase(), `Tel: ${pi.buyerPhone}`]
    : [pi.consName, pi.consAddr1, pi.consAddr2, (pi.consCountry || '').toUpperCase(), `Tel: ${pi.consPhone}`]).filter((x) => x && !/^Tel: $/.test(x));

  const shipRows: [string, string, string, string][] = [
    ['Country of Origin', pi.originCountry, 'Country of Final Destination', pi.destCountry],
    ['Port of Loading', pi.portLoading, 'Port of Discharge', pi.portDischarge],
    ['Pre-carriage by', pi.precarriage, 'Final Place of Delivery', pi.placeDelivery],
    ['Mode of Transport', pi.transportMode, 'Container', pi.container],
    ['Partial Shipment', pi.partialShipment, 'Transshipment', pi.transshipment],
    ['Incoterms® 2020', `${pi.incoterm} ${pi.incotermPlace}`, 'Shipment / Lead Time', pi.leadTime],
  ];

  // ── items ──
  const th = (t: string, a: string = 'center') => ({ text: t, bold: true, fontSize: 7.5, color: WHITE, fillColor: mid, alignment: a, margin: [0, 3, 0, 3] });
  const itemRows = lines.map((it, i) => [
    { text: String(i + 1), alignment: 'center', fontSize: 8.5 },
    { stack: [{ text: it.desc, bold: true, fontSize: 8.5 }, ...(it.grade ? [{ text: `Grade: ${it.grade}`, fontSize: 8, color: GREY }] : [])] },
    { text: it.hsn, alignment: 'center', fontSize: 8.5 },
    { text: it.qty.toLocaleString('en-US'), alignment: 'right', fontSize: 8.5 },
    { text: it.unit, alignment: 'center', fontSize: 8.5 },
    { text: fmt2(lineNetWt(it)), alignment: 'right', fontSize: 8.5 },
    { text: fmt2(it.price), alignment: 'right', fontSize: 8.5 },
    { text: fmt2(lineAmount(it)), alignment: 'right', fontSize: 8.5, bold: true },
  ]);
  const tot = (t: any, a = 'right') => ({ ...(typeof t === 'string' ? { text: t } : t), bold: true, fontSize: 8.5, fillColor: '#e2e8f0', alignment: a });
  const items = {
    table: {
      headerRows: 1, dontBreakRows: true, widths: [20, '*', 50, 32, 26, 46, 48, 56],
      body: [
        [th('S.N'), th('Description of Goods', 'left'), th('HSN Code'), th('Qty', 'right'), th('Unit'), th('Net Wt (kg)', 'right'), th(`Unit Price (${pi.currency})`, 'right'), th(`Amount (${pi.currency})`, 'right')],
        ...itemRows,
        [{ ...tot('Total', 'right'), colSpan: 3 }, {}, {}, tot(calc.qty.toLocaleString('en-US')), tot(lines[0]?.unit ?? '', 'center'), tot(fmt2(calc.netWt)), tot(''), tot(fmt2(calc.goods))],
      ],
    },
    layout: { ...grid, paddingTop: () => 3, paddingBottom: () => 3 }, margin: [0, 8, 0, 0],
  };

  // ── words, charges ──
  const sums: [string, number][] = [
    ['Goods Value', calc.goods], [`Export Packing @ ${(pi.packingPct * 100).toFixed(1)}%`, calc.packing], ['Freight', calc.freight],
    ['Insurance', calc.insurance], [pi.otherLabel || 'Other charges', calc.other], ['Discount', calc.discount],
  ];
  const packingLine = `Packages: ${pi.packages} ${pi.packageType}   |   Net Wt: ${fmt2(calc.netWt)} kg   |   Gross Wt: ${fmt2(pi.grossWeight || 0)} kg${pi.volume ? `   |   ${pi.volume} CBM` : ''}`;
  const totals: any = {
    columns: [
      { width: '*', stack: [
        { text: 'AMOUNT IN WORDS', fontSize: 7.5, bold: true, color: GREY },
        { text: amountWords(calc.grand, pi.currency), fontSize: 9, bold: true, margin: [0, 2, 0, 8] },
        { text: 'PACKING DETAILS', fontSize: 7.5, bold: true, color: GREY },
        { text: packingLine, fontSize: 8, margin: [0, 2, 0, 0] },
        ...(pi.marks ? [{ text: `Shipping Marks: ${pi.marks}`, fontSize: 8, margin: [0, 2, 0, 0] }] : []),
        ...(calc.advPct > 0 ? [{ text: `Advance payable now (${Math.round(calc.advPct * 100)}%): ${pi.currency} ${fmt2(calc.advance)}`, fontSize: 8.5, bold: true, color: dark, margin: [0, 8, 0, 0] }] : []),
      ] },
      { width: 215, table: { widths: ['*', 'auto'], body: [
        ...sums.map(([t, n]) => [{ text: t, fontSize: 8.5, color: GREY }, { text: n ? fmt2(n) : '-', fontSize: 8.5, alignment: 'right' }]),
        [{ text: 'GRAND TOTAL', bold: true, fontSize: 10, color: WHITE, fillColor: dark, margin: [0, 3, 0, 3] },
          { text: `${pi.currency} ${fmt2(calc.grand)}`, bold: true, fontSize: 10, color: WHITE, fillColor: dark, alignment: 'right', margin: [0, 3, 0, 3] }],
      ] }, layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingTop: () => 2, paddingBottom: () => 2, paddingLeft: () => 6, paddingRight: () => 6 } },
    ],
    columnGap: 14, margin: [0, 8, 0, 0],
  };

  // ── terms of sale ──
  const inc = INCOTERMS.find((i) => i.code === pi.incoterm);
  const pay = PAYMENT_TERMS.find((p) => p.name === pi.paymentTerms);
  const docs = ([[pi.docInvoice, 'Commercial Invoice'], [pi.docPacking, 'Packing List'], [pi.docBl, 'Bill of Lading / AWB'],
    [pi.docCoo, 'Certificate of Origin'], [pi.docAifta, 'Preferential CoO (AIFTA Form AI)'], [pi.docTest, 'Test Certificate'],
    [pi.docIspm, 'ISPM-15 Certificate'], [pi.docInsurance, 'Insurance Certificate']] as [string, string][])
    .filter(([y]) => y === 'Yes').map(([, n]) => `${n}; `).join('');
  const sale: [string, string][] = [
    ['Payment Terms', pay?.text ?? pi.paymentTerms],
    ['Delivery Terms', `${pi.incoterm} (${inc?.name ?? ''}) — ${pi.incotermPlace}, as per Incoterms® 2020.`],
    ['Price Basis', pi.priceBasis], ['Bank Charges', pi.bankCharges], ['Inspection', pi.inspection], ['Documents', docs], ['GST / Export', pi.exportType],
  ];
  const bank: [string, string, string, string][] = [
    ['Beneficiary', s.beneficiary, 'Bank', s.bankName], ['Account No.', s.accountNo, 'SWIFT / BIC', s.swift],
    ['Branch', s.bankBranch, 'IFSC', s.ifsc], ['AD Code', s.adCode, 'Intermediary Bank', s.intermediaryBank],
  ];
  const terms = s.terms.filter((t) => t.print && t.title.trim());

  const content: any[] = [
    head,
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 539, y2: 0, lineWidth: 1.4, lineColor: dark }], margin: [0, 8, 0, 8] },
    { columns: [
      { width: '*', stack: [label('BUYER (BILL TO)'), ...buyer.map((t, i) => ({ text: t, fontSize: i === 0 ? 10 : 8.5, bold: i === 0 }))] },
      { width: 215, table: { widths: [78, '*'], body: meta.map(([a, b]) => [k(a), v(b)]) }, layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingTop: () => 1.5, paddingBottom: () => 1.5, paddingLeft: () => 0 } },
    ], columnGap: 14 },
    { columns: [
      { width: '*', stack: [label('CONSIGNEE (SHIP TO)'), ...cons.map((t, i) => ({ text: t, fontSize: 8.5, bold: i === 0 }))] },
      { width: 215, stack: [label('NOTIFY PARTY'), { text: pi.notifyParty, fontSize: 8.5 }] },
    ], columnGap: 14, margin: [0, 10, 0, 0] },
    banner('SHIPMENT & COMMERCIAL DETAILS'),
    { table: { widths: [82, '*', 100, '*'], body: shipRows.map(([a, b, c, d]) => [k(a), v(b), k(c), v(d)]) }, layout: grid },
    items,
    totals,
    { stack: [banner('TERMS OF SALE'), { table: { widths: [92, '*'], body: sale.map(([a, b]) => [{ text: a, bold: true, fontSize: 8.5 }, { text: b, fontSize: 8.5 }]) }, layout: grid }], unbreakable: true },
    { stack: [banner('BANK DETAILS FOR REMITTANCE'),
      { table: { widths: [64, '*', 76, '*'], body: bank.map(([a, b, c, d]) => [k(a), v(b), k(c), v(d)]) }, layout: grid },
      { text: "Please quote the PI number in the remittance details. All bank charges as per 'Bank Charges' above.", fontSize: 7.5, color: GREY, margin: [0, 3, 0, 0] }], unbreakable: true },
    banner('TERMS & CONDITIONS'),
    { table: { widths: [20, '*'], body: terms.map((t, i) => [
      { text: `${i + 1}.`, bold: true, fontSize: 7.5, alignment: 'center', fillColor: tint },
      { text: [{ text: `${t.title}: `, bold: true }, t.text], fontSize: 7.5, fillColor: tint }]) },
      layout: { hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 2 : 0), vLineColor: () => dark, paddingTop: () => 1.5, paddingBottom: () => 1.5 } },
    { stack: [
      { text: 'DECLARATION', fontSize: 7.5, bold: true, color: GREY, margin: [0, 8, 0, 2] },
      { text: DECLARATION, fontSize: 7.5 },
      { columns: [
        { width: '*', stack: [{ text: 'ACCEPTED BY BUYER', fontSize: 8.5, bold: true, color: dark }, { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.5, lineColor: GREY }], margin: [0, 34, 0, 2] },
          { text: 'Signature, name & company seal', fontSize: 8, color: GREY }, { text: 'Date:', fontSize: 8, color: GREY, margin: [0, 6, 0, 0] }] },
        { width: 210, stack: [{ text: `For ${company.name}`, fontSize: 8.5, bold: true, alignment: 'right' }, { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 210, y2: 0, lineWidth: 0.5, lineColor: GREY }], margin: [0, 34, 0, 2] },
          { text: s.signatory ? `${s.signatory} — Authorised Signatory` : 'Authorised Signatory', fontSize: 8.5, bold: true, alignment: 'right' }, { text: 'E. & O.E.', fontSize: 8, color: GREY, alignment: 'right', margin: [0, 6, 0, 0] }] },
      ], columnGap: 20, margin: [0, 10, 0, 0] },
    ], unbreakable: true },
  ];

  return {
    pageSize: 'A4', pageMargins: [28, 24, 28, 36], defaultStyle: { font: 'Montserrat', fontSize: 8.5, color: INK }, content,
    footer: (page: number, total: number) => ({
      columns: [{ text: `Proforma Invoice — ${company.name}`, fontSize: 7, color: GREY, margin: [28, 0, 0, 0] },
        { text: `Page ${page} of ${total}`, fontSize: 7, color: GREY, alignment: 'right', margin: [0, 0, 28, 0] }],
    }),
  };
};

export const downloadProformaPdf = async (
  pi: PiForm, s: PiSettings, company: { name: string; logoUrl?: string | null }, brand: string | null,
) => {
  let logo: PiLogo | null = null;
  if (company.logoUrl) {
    try {
      const { dataUrlToPng } = await import('./image');
      const p = await dataUrlToPng(company.logoUrl, 400);
      logo = { base64: p.dataUrl.replace(/^data:image\/png;base64,/, ''), w: p.w, h: p.h };
    } catch { /* an unreadable logo must not stop the PDF */ }
  }
  const pdfMake = await loadPdfMake();
  pdfMake.createPdf(buildProformaPdfDoc(pi, s, company, brand, logo)).download(`Proforma-Invoice-${pi.piNumber.replace(/[\\/:*?"<>|]/g, '-') || 'draft'}.pdf`);
};
