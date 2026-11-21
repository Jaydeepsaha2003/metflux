// Proforma invoice: the shape of the form, its defaults, its arithmetic and its
// wording. Mirrors the export workbook this feature reproduces — the same fields in
// the same sections, the same "Required" flags, and the same totals — so the sheet
// the app prints and the sheet people were filling in by hand agree to the cent.
import {
  ALLOWED, BANK_CHARGES, CONTAINERS, EXPORT_TYPES, INSPECTION, PACKAGE_TYPES, PAYMENT_TERMS,
  PI_CURRENCIES, PORTS_OF_LOADING, PRECARRIAGE, PRICE_BASIS, TRANSPORT_MODES, INCOTERMS,
} from './proformaLists';

export type PiItem = {
  desc: string; grade: string; hsn: string; qty: number; unit: string; netWtUnit: number; price: number;
};

/** One flat record: the register columns and the free-form fields side by side, so
 *  the form and the sheet read from one place. The server splits it on save. */
export type PiForm = {
  piNumber: string; piDate: string; validUntil: string; currency: string;
  poRef: string; poDate: string; quotationRef: string;
  buyerName: string; buyerAddr1: string; buyerAddr2: string; buyerCountry: string;
  buyerContact: string; buyerPhone: string; buyerEmail: string; buyerTaxId: string;
  consigneeSame: string; consName: string; consAddr1: string; consAddr2: string;
  consCountry: string; consPhone: string; notifyParty: string;
  originCountry: string; destCountry: string; portLoading: string; portDischarge: string;
  placeDelivery: string; transportMode: string; precarriage: string; container: string;
  partialShipment: string; transshipment: string; leadTime: string;
  incoterm: string; incotermPlace: string; paymentTerms: string; priceBasis: string;
  bankCharges: string; inspection: string; exportType: string;
  /** A fraction (0.05 = 5%), as the sheet stores it. */
  packingPct: number; freight: number; insurance: number; otherLabel: string; otherAmount: number; discount: number;
  packages: number; packageType: string; grossWeight: number; volume: string; marks: string;
  docInvoice: string; docPacking: string; docBl: string; docCoo: string; docAifta: string;
  docTest: string; docIspm: string; docInsurance: string;
  items: PiItem[];
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const plusDays = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export const blankItem = (): PiItem => ({ desc: '', grade: '', hsn: '', qty: 0, unit: 'Pcs', netWtUnit: 0, price: 0 });

export const blankPi = (): PiForm => ({
  piNumber: '', piDate: todayISO(), validUntil: plusDays(todayISO(), 30), currency: 'USD',
  poRef: '', poDate: '', quotationRef: '',
  buyerName: '', buyerAddr1: '', buyerAddr2: '', buyerCountry: '', buyerContact: '', buyerPhone: '', buyerEmail: '', buyerTaxId: '',
  consigneeSame: 'Yes', consName: '', consAddr1: '', consAddr2: '', consCountry: '', consPhone: '', notifyParty: 'Same as consignee',
  originCountry: 'India', destCountry: '', portLoading: '', portDischarge: '', placeDelivery: '',
  transportMode: '', precarriage: 'Road', container: 'Not applicable', partialShipment: 'Allowed', transshipment: 'Allowed', leadTime: '',
  incoterm: '', incotermPlace: '', paymentTerms: '', priceBasis: PRICE_BASIS[0] ?? '', bankCharges: BANK_CHARGES[1] ?? '',
  inspection: INSPECTION[0] ?? '', exportType: EXPORT_TYPES[0] ?? '',
  packingPct: 0, freight: 0, insurance: 0, otherLabel: 'Other charges', otherAmount: 0, discount: 0,
  packages: 0, packageType: PACKAGE_TYPES[0] ?? '', grossWeight: 0, volume: '', marks: '',
  docInvoice: 'Yes', docPacking: 'Yes', docBl: 'No', docCoo: 'No', docAifta: 'No', docTest: 'Yes', docIspm: 'No', docInsurance: 'No',
  items: [blankItem()],
});

/* ── the form, as data ─────────────────────────────────────────────────────
   Section by section as the workbook's Input sheet lists them, with its Required /
   Optional flag and its note, so the page is one loop over this and a field cannot
   be on the sheet and missing from the form. */
export type FieldKind = 'text' | 'date' | 'number' | 'yesno' | 'list' | 'percent' | 'area';
export type Field = {
  key: keyof PiForm; label: string; kind?: FieldKind; required?: boolean; options?: string[]; note?: string;
  /** Hidden unless the consignee differs from the buyer. */
  consignee?: boolean;
};
export const SECTIONS: { title: string; fields: Field[] }[] = [
  { title: 'Proforma invoice details', fields: [
    { key: 'piNumber', label: 'PI number', required: true, note: 'A running series, e.g. MEI/PI/001/2026-27. Filled in for you.' },
    { key: 'piDate', label: 'PI date', kind: 'date', required: true },
    { key: 'validUntil', label: 'Valid until', kind: 'date', required: true, note: 'Typically 15–30 days.' },
    { key: 'poRef', label: "Buyer's PO / enquiry ref.", note: 'Fill once the buyer sends a PO.' },
    { key: 'poDate', label: 'PO / enquiry date', kind: 'date' },
    { key: 'quotationRef', label: 'Our quotation ref.' },
    { key: 'currency', label: 'Currency', kind: 'list', required: true, options: PI_CURRENCIES.map((c) => c.code), note: 'Changes the headings and the amount in words.' },
  ] },
  { title: 'Buyer (bill to)', fields: [
    { key: 'buyerName', label: 'Buyer name', required: true },
    { key: 'buyerAddr1', label: 'Address line 1', required: true },
    { key: 'buyerAddr2', label: 'Address line 2 / city / postcode' },
    { key: 'buyerCountry', label: 'Country', required: true },
    { key: 'buyerContact', label: 'Contact person' },
    { key: 'buyerPhone', label: 'Phone', required: true },
    { key: 'buyerEmail', label: 'Email', note: 'Recommended.' },
    { key: 'buyerTaxId', label: 'Buyer tax ID / company reg. no.', note: 'e.g. Malaysian SSM / SST no. Often needed for import clearance.' },
  ] },
  { title: 'Consignee (ship to)', fields: [
    { key: 'consigneeSame', label: 'Consignee same as buyer?', kind: 'yesno', required: true, note: 'If No, fill the consignee fields below.' },
    { key: 'consName', label: 'Consignee name', consignee: true },
    { key: 'consAddr1', label: 'Address line 1', consignee: true },
    { key: 'consAddr2', label: 'Address line 2 / city / postcode', consignee: true },
    { key: 'consCountry', label: 'Country', consignee: true },
    { key: 'consPhone', label: 'Phone', consignee: true },
    { key: 'notifyParty', label: 'Notify party', note: 'Usually the buyer or their customs agent.' },
  ] },
  { title: 'Shipment', fields: [
    { key: 'originCountry', label: 'Country of origin of goods', required: true },
    { key: 'destCountry', label: 'Country of final destination', required: true },
    { key: 'portLoading', label: 'Port of loading', kind: 'list', required: true, options: PORTS_OF_LOADING, note: 'Pick or type your own.' },
    { key: 'portDischarge', label: 'Port of discharge', required: true },
    { key: 'placeDelivery', label: 'Final place of delivery' },
    { key: 'transportMode', label: 'Mode of transport', kind: 'list', required: true, options: TRANSPORT_MODES },
    { key: 'precarriage', label: 'Pre-carriage by', kind: 'list', options: PRECARRIAGE, note: 'Factory to port.' },
    { key: 'container', label: 'Container', kind: 'list', options: CONTAINERS },
    { key: 'partialShipment', label: 'Partial shipment', kind: 'list', required: true, options: ALLOWED },
    { key: 'transshipment', label: 'Transshipment', kind: 'list', required: true, options: ALLOWED },
    { key: 'leadTime', label: 'Shipment / lead time', required: true, note: 'e.g. 4 weeks from receipt of advance.' },
  ] },
  { title: 'Commercial terms', fields: [
    { key: 'incoterm', label: 'Incoterm (2020)', kind: 'list', required: true, options: INCOTERMS.map((i) => i.code), note: 'Who pays freight/insurance and where risk passes.' },
    { key: 'incotermPlace', label: 'Incoterm named place', required: true, note: 'e.g. FOB Chennai Port / CIF Pasir Gudang.' },
    { key: 'paymentTerms', label: 'Payment terms', kind: 'list', required: true, options: PAYMENT_TERMS.map((p) => p.name), note: 'The full wording prints on the PI.' },
    { key: 'priceBasis', label: 'Price basis', kind: 'list', required: true, options: PRICE_BASIS },
    { key: 'bankCharges', label: 'Bank charges', kind: 'list', required: true, options: BANK_CHARGES },
    { key: 'inspection', label: 'Inspection', kind: 'list', required: true, options: INSPECTION },
    { key: 'exportType', label: 'Export type (GST)', kind: 'list', required: true, options: EXPORT_TYPES, note: 'Under LUT = no IGST charged.' },
  ] },
  { title: 'Charges (in invoice currency)', fields: [
    { key: 'packingPct', label: 'Export packing (% of goods value)', kind: 'percent', note: 'Put 0 if included in the price.' },
    { key: 'freight', label: 'Freight', kind: 'number', note: 'Fill for CFR/CIF/CPT/CIP/DAP etc.' },
    { key: 'insurance', label: 'Insurance', kind: 'number', note: 'Fill for CIF/CIP.' },
    { key: 'otherLabel', label: 'Other charges — label' },
    { key: 'otherAmount', label: 'Other charges — amount', kind: 'number' },
    { key: 'discount', label: 'Discount', kind: 'number', note: 'Enter as a positive number.' },
  ] },
  { title: 'Packing details', fields: [
    { key: 'packages', label: 'No. of packages', kind: 'number', required: true, note: 'Can be approximate on a PI.' },
    { key: 'packageType', label: 'Package type', kind: 'list', required: true, options: PACKAGE_TYPES },
    { key: 'grossWeight', label: 'Gross weight (kg)', kind: 'number', required: true, note: 'Net weight is totalled from the item table.' },
    { key: 'volume', label: 'Volume (CBM)' },
    { key: 'marks', label: 'Shipping marks' },
  ] },
  { title: 'Documents to be provided', fields: [
    { key: 'docInvoice', label: 'Commercial invoice', kind: 'yesno', required: true },
    { key: 'docPacking', label: 'Packing list', kind: 'yesno', required: true },
    { key: 'docBl', label: 'Bill of lading / airway bill', kind: 'yesno', required: true },
    { key: 'docCoo', label: 'Certificate of origin (non-preferential)', kind: 'yesno' },
    { key: 'docAifta', label: 'Preferential certificate of origin — AIFTA Form AI', kind: 'yesno', note: "For ASEAN buyers (e.g. Malaysia) — can lower the buyer's import duty." },
    { key: 'docTest', label: 'Test certificate / test report', kind: 'yesno' },
    { key: 'docIspm', label: 'ISPM-15 fumigation / heat-treatment certificate', kind: 'yesno' },
    { key: 'docInsurance', label: 'Insurance certificate', kind: 'yesno', note: 'Needed for CIF/CIP.' },
  ] },
];

const isBlank = (v: unknown) => v === '' || v == null || (typeof v === 'number' && !Number.isFinite(v));
/** A required field that is still empty. Numbers count as filled once above zero, as the
 *  sheet's COUNTIFS did, except where zero is a real answer (none of the required ones). */
export const isMissing = (pi: PiForm, f: Field) =>
  !!f.required && (isBlank(pi[f.key]) || (f.kind === 'number' && !Number(pi[f.key])));

export const missingFields = (pi: PiForm): Field[] => SECTIONS.flatMap((s) => s.fields).filter((f) => isMissing(pi, f));
export const missingRequired = (pi: PiForm): string[] => missingFields(pi).map((f) => f.label);

/* ── arithmetic: the sheet's "Calculated totals" ─────────────────────────── */
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const calcPi = (pi: PiForm) => {
  const lines = pi.items.filter((i) => i.desc.trim());
  const goods = r2(lines.reduce((s, i) => s + r2(i.qty * i.price), 0));
  const packing = r2(goods * (pi.packingPct || 0));
  const discount = -Math.abs(pi.discount || 0);
  const grand = r2(goods + packing + (pi.freight || 0) + (pi.insurance || 0) + (pi.otherAmount || 0) + discount);
  const advPct = PAYMENT_TERMS.find((p) => p.name === pi.paymentTerms)?.adv ?? 0;
  return {
    goods, packing, freight: pi.freight || 0, insurance: pi.insurance || 0, other: pi.otherAmount || 0, discount,
    grand, advPct, advance: r2(grand * advPct),
    qty: lines.reduce((s, i) => s + i.qty, 0),
    netWt: r2(lines.reduce((s, i) => s + r2(i.qty * i.netWtUnit), 0)),
  };
};

export const lineAmount = (i: PiItem) => r2(i.qty * i.price);
export const lineNetWt = (i: PiItem) => r2(i.qty * i.netWtUnit);

/* ── amount in words, in the sheet's wording: "USD One Hundred … Only" ───── */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen',
  'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const below1000 = (n: number) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : '', below100(n % 100)].filter(Boolean).join(' ');

const intWords = (n: number, indian: boolean): string => {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const add = (q: number, label: string) => { if (q) parts.push(`${below1000(q)}${label ? ` ${label}` : ''}`); };
  if (indian) {
    add(Math.floor(n / 1e7), 'Crore'); add(Math.floor((n % 1e7) / 1e5), 'Lakh');
    add(Math.floor((n % 1e5) / 1e3), 'Thousand'); add(n % 1000, '');
  } else {
    add(Math.floor(n / 1e9), 'Billion'); add(Math.floor((n % 1e9) / 1e6), 'Million');
    add(Math.floor((n % 1e6) / 1e3), 'Thousand'); add(n % 1000, '');
  }
  return parts.join(' ');
};

export const amountWords = (amount: number, code: string): string => {
  const abs = Math.abs(r2(amount));
  const whole = Math.floor(abs);
  const cents = Math.round((abs - whole) * 100);
  const cur = PI_CURRENCIES.find((c) => c.code === code);
  const minor = cur?.minor ? ` and ${cur.minor} ${below100(cents)}` : '';
  return `${code} ${intWords(whole, cur?.style === 'Indian')}${cents > 0 && cur?.minor ? minor : ''} Only`;
};

/** "12,345.60" — the sheet's #,##0.00 */
export const fmt2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Split a form into the register columns and the JSON the server stores. */
export const toPayload = (pi: PiForm) => {
  const { piNumber, piDate, validUntil, currency, ...data } = pi;
  return {
    piNumber: piNumber.trim() || undefined, piDate, validUntil: validUntil || null, currency,
    data: { ...data, items: pi.items.filter((i) => i.desc.trim()) },
  };
};

/** The reverse, tolerant of an older or damaged record. */
export const fromRecord = (r: { piNumber: string; piDate: string; validUntil: string | null; currency: string; data: Partial<PiForm> }): PiForm => ({
  ...blankPi(), ...r.data, piNumber: r.piNumber, piDate: r.piDate, validUntil: r.validUntil ?? '', currency: r.currency,
  items: r.data?.items?.length ? r.data.items : [blankItem()],
});
