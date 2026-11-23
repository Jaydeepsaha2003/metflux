// The pick-lists and default wording of the proforma invoice, taken from the export
// workbook this feature reproduces (its "Lists" and "Exporter & Bank" sheets). They
// are suggestions, not constraints: every field that uses one also accepts free text,
// as the workbook's own drop-downs did ("Pick or type your own").

/** Payment terms: the label, the wording that prints on the PI, and the advance share. */
export const PAYMENT_TERMS: { name: string; text: string; adv: number }[] = [
  {
    "name": "100% advance by T/T",
    "text": "100% advance by Telegraphic Transfer (T/T) before dispatch.",
    "adv": 1
  },
  {
    "name": "40% advance, 60% before dispatch",
    "text": "40% advance by T/T along with the Purchase Order; the balance 60% payable on intimation of material readiness, prior to dispatch.",
    "adv": 0.4
  },
  {
    "name": "50% advance, 50% before dispatch",
    "text": "50% advance by T/T along with the Purchase Order; the balance 50% payable on intimation of material readiness, prior to dispatch.",
    "adv": 0.5
  },
  {
    "name": "30% advance, 70% against copy of B/L",
    "text": "30% advance by T/T along with the Purchase Order; the balance 70% by T/T against scanned copy of the Bill of Lading.",
    "adv": 0.3
  },
  {
    "name": "100% against copy of B/L",
    "text": "100% by T/T against scanned copy of the Bill of Lading / Airway Bill.",
    "adv": 0
  },
  {
    "name": "LC at sight",
    "text": "By Irrevocable Letter of Credit payable at sight, opened through a bank acceptable to the seller.",
    "adv": 0
  },
  {
    "name": "LC 30 days usance",
    "text": "By Irrevocable Letter of Credit, payable 30 days from Bill of Lading date.",
    "adv": 0
  },
  {
    "name": "LC 60 days usance",
    "text": "By Irrevocable Letter of Credit, payable 60 days from Bill of Lading date.",
    "adv": 0
  },
  {
    "name": "LC 90 days usance",
    "text": "By Irrevocable Letter of Credit, payable 90 days from Bill of Lading date.",
    "adv": 0
  },
  {
    "name": "D/P at sight (Documents against Payment)",
    "text": "Documents against Payment (D/P) at sight through bank collection.",
    "adv": 0
  },
  {
    "name": "D/A 30 days (Documents against Acceptance)",
    "text": "Documents against Acceptance (D/A), payable 30 days from Bill of Lading date.",
    "adv": 0
  },
  {
    "name": "D/A 60 days (Documents against Acceptance)",
    "text": "Documents against Acceptance (D/A), payable 60 days from Bill of Lading date.",
    "adv": 0
  },
  {
    "name": "CAD (Cash against Documents)",
    "text": "Cash against Documents (CAD) through bank collection.",
    "adv": 0
  },
  {
    "name": "Open account 30 days",
    "text": "Open account – 100% payable by T/T within 30 days from Bill of Lading date.",
    "adv": 0
  },
  {
    "name": "Open account 60 days",
    "text": "Open account – 100% payable by T/T within 60 days from Bill of Lading date.",
    "adv": 0
  }
];

export const INCOTERMS: { code: string; name: string }[] = [
  {
    "code": "EXW",
    "name": "Ex Works"
  },
  {
    "code": "FCA",
    "name": "Free Carrier"
  },
  {
    "code": "FAS",
    "name": "Free Alongside Ship"
  },
  {
    "code": "FOB",
    "name": "Free On Board"
  },
  {
    "code": "CFR",
    "name": "Cost and Freight"
  },
  {
    "code": "CIF",
    "name": "Cost, Insurance and Freight"
  },
  {
    "code": "CPT",
    "name": "Carriage Paid To"
  },
  {
    "code": "CIP",
    "name": "Carriage and Insurance Paid To"
  },
  {
    "code": "DAP",
    "name": "Delivered At Place"
  },
  {
    "code": "DPU",
    "name": "Delivered at Place Unloaded"
  },
  {
    "code": "DDP",
    "name": "Delivered Duty Paid"
  }
];

/** Minor-unit name and the number-to-words style (Indian = lakh/crore) per currency. */
export const PI_CURRENCIES: { code: string; name: string; minor: string | null; style: 'Indian' | 'International' }[] = [
  {
    "code": "USD",
    "name": "US Dollar",
    "minor": "Cents",
    "style": "International"
  },
  {
    "code": "EUR",
    "name": "Euro",
    "minor": "Cents",
    "style": "International"
  },
  {
    "code": "GBP",
    "name": "British Pound",
    "minor": "Pence",
    "style": "International"
  },
  {
    "code": "INR",
    "name": "Indian Rupee",
    "minor": "Paise",
    "style": "Indian"
  },
  {
    "code": "AED",
    "name": "UAE Dirham",
    "minor": "Fils",
    "style": "International"
  },
  {
    "code": "SAR",
    "name": "Saudi Riyal",
    "minor": "Halalas",
    "style": "International"
  },
  {
    "code": "MYR",
    "name": "Malaysian Ringgit",
    "minor": "Sen",
    "style": "International"
  },
  {
    "code": "SGD",
    "name": "Singapore Dollar",
    "minor": "Cents",
    "style": "International"
  },
  {
    "code": "CNY",
    "name": "Chinese Yuan",
    "minor": "Fen",
    "style": "International"
  },
  {
    "code": "JPY",
    "name": "Japanese Yen",
    "minor": null,
    "style": "International"
  },
  {
    "code": "AUD",
    "name": "Australian Dollar",
    "minor": "Cents",
    "style": "International"
  },
  {
    "code": "CAD",
    "name": "Canadian Dollar",
    "minor": "Cents",
    "style": "International"
  },
  {
    "code": "THB",
    "name": "Thai Baht",
    "minor": "Satang",
    "style": "International"
  },
  {
    "code": "BDT",
    "name": "Bangladeshi Taka",
    "minor": "Poisha",
    "style": "Indian"
  },
  {
    "code": "NPR",
    "name": "Nepalese Rupee",
    "minor": "Paisa",
    "style": "Indian"
  },
  {
    "code": "LKR",
    "name": "Sri Lankan Rupee",
    "minor": "Cents",
    "style": "International"
  }
];

export const TRANSPORT_MODES: string[] = [
  "Sea – LCL (part container)",
  "Sea – FCL (full container)",
  "Air freight",
  "Courier",
  "Road",
  "Rail",
  "Multimodal"
];
export const PRECARRIAGE: string[] = [
  "Road",
  "Rail",
  "Not applicable"
];
export const PORTS_OF_LOADING: string[] = [
  "Nhava Sheva (JNPT), India",
  "Mundra Port, India",
  "Chennai Port, India",
  "Kolkata Port, India",
  "Visakhapatnam Port, India",
  "Kandla Port, India",
  "ICD Tughlakabad, New Delhi, India",
  "ICD Patparganj, Delhi, India",
  "ICD Garhi Harsaru, Gurugram, India",
  "ICD Sonipat, Haryana, India",
  "IGI Air Cargo, New Delhi, India",
  "Ex-Works Kundli, Haryana, India"
];
export const CONTAINERS: string[] = [
  "LCL (part container)",
  "20' GP",
  "40' GP",
  "40' HC",
  "Not applicable"
];
export const ALLOWED: string[] = [
  "Allowed",
  "Not allowed"
];
export const UNITS: string[] = [
  "Pcs",
  "Nos",
  "Kg",
  "MT",
  "Set",
  "Mtr"
];
export const PRICE_BASIS: string[] = [
  "Firm and fixed for this order",
  "Subject to CRGO raw material price variation at time of order",
  "Valid only up to the validity date of this PI"
];
export const BANK_CHARGES: string[] = [
  "Bank charges outside India to buyer's account; inside India to seller's account",
  "All bank charges to buyer's account",
  "Each party bears its own bank charges"
];
export const INSPECTION: string[] = [
  "Seller's in-house inspection with test report",
  "Buyer's inspection at seller's works before dispatch",
  "Third-party inspection (SGS/BV/TUV) – cost to buyer"
];
export const EXPORT_TYPES: string[] = [
  "Supply meant for export under LUT without payment of IGST",
  "Supply meant for export on payment of IGST"
];
export const PACKAGE_TYPES: string[] = [
  "Wooden crates (ISPM-15)",
  "Wooden pallets (ISPM-15)",
  "Corrugated cartons on pallets",
  "Steel boxes"
];

/** Terms & conditions a company starts from; editable per company in PI settings. */
export const DEFAULT_TERMS: { title: string; text: string; print: boolean }[] = [
  {
    "title": "Payment",
    "text": "Payment shall be made in the invoice currency to the bank account stated in this proforma invoice, as per the payment terms above. Production and dispatch are scheduled only after the advance is received in our account.",
    "print": true
  },
  {
    "title": "Delivery, Risk & Title",
    "text": "Delivery shall be as per the Incoterms® 2020 rule stated above. Risk passes to the buyer as defined by that rule; title to the goods passes only on receipt of full payment.",
    "print": true
  },
  {
    "title": "Freight & Logistics",
    "text": "Unless included in the price above, freight shall be charged extra at actuals. Shipment can be arranged on prepaid or freight-collect basis as per the buyer's instructions.",
    "print": true
  },
  {
    "title": "Transit Insurance",
    "text": "Transit insurance shall be arranged and borne by the buyer, unless the Incoterm is CIF/CIP or insurance is specifically shown above.",
    "print": true
  },
  {
    "title": "Export Packaging",
    "text": "Goods shall be packed in ISPM-15 compliant, export-worthy wooden crates/pallets suitable for international transport. Packaging charges, if any, are shown separately above.",
    "print": true
  },
  {
    "title": "Taxes & Duties",
    "text": "Prices exclude all import duties, taxes, levies and charges in the country of destination, which shall be borne by the buyer.",
    "print": true
  },
  {
    "title": "Validity",
    "text": "This proforma invoice is valid up to the date stated above. Orders confirmed later are subject to re-confirmation of price and delivery.",
    "print": true
  },
  {
    "title": "Delivery Schedule",
    "text": "The delivery period commences from receipt of the confirmed Purchase Order, the advance payment (where applicable) and final technical approval of drawings.",
    "print": true
  },
  {
    "title": "Inspection & Testing",
    "text": "Goods are inspected and tested at our works before dispatch and supplied with our test report. Any third-party inspection shall be at the buyer's cost.",
    "print": true
  },
  {
    "title": "Claims",
    "text": "Any claim for shortage or quality must be notified in writing within 30 days of arrival at the destination port, with photographs and test reports. No claim is accepted after the goods are processed or used. Our liability is limited to replacement or credit of the value of defective goods.",
    "print": true
  },
  {
    "title": "Cancellation",
    "text": "Confirmed orders cannot be cancelled once production has started. In such case, costs incurred will be adjusted against the advance received.",
    "print": true
  },
  {
    "title": "Late Payment",
    "text": "If payment is delayed beyond the agreed terms, the seller may hold shipment or documents and charge interest at 1.5% per month on the overdue amount.",
    "print": true
  },
  {
    "title": "Drawings & Confidentiality",
    "text": "All drawings, specifications and technical data shared by the seller remain its property and shall not be copied or disclosed to any third party without written consent.",
    "print": true
  },
  {
    "title": "Force Majeure",
    "text": "The seller shall not be liable for any delay or failure in performance arising from circumstances beyond its reasonable control, including natural calamities, epidemics, government restrictions, strikes, port congestion or transportation disruptions.",
    "print": true
  },
  {
    "title": "Governing Law & Disputes",
    "text": "This contract is governed by the laws of India. Disputes shall first be settled amicably, failing which by arbitration under the Arbitration and Conciliation Act, 1996, seated at New Delhi, India, in English.",
    "print": true
  },
  {
    "title": "Acceptance",
    "text": "Please sign and return a copy of this proforma invoice, or issue a Purchase Order referring to it, as acceptance of these terms.",
    "print": true
  }
];

export const DECLARATION =
  'We declare that this proforma invoice shows the actual price of the goods described and that all particulars are true and correct. This is a proforma invoice and not a tax invoice; the final commercial invoice will be issued at the time of shipment.';

/** The drop-downs a company can edit in Settings → Proforma / Export, as on the workbook's
 *  Lists sheet. Currency, Incoterm and Payment terms stay fixed: the amount in words, the
 *  printed Incoterm wording and the advance % are looked up from their entries. */
export const EDITABLE_LISTS = [
  { key: 'portLoading', label: 'Port of loading', defaults: PORTS_OF_LOADING },
  { key: 'transportMode', label: 'Mode of transport', defaults: TRANSPORT_MODES },
  { key: 'precarriage', label: 'Pre-carriage by', defaults: PRECARRIAGE },
  { key: 'container', label: 'Container', defaults: CONTAINERS },
  { key: 'allowed', label: 'Partial shipment / Transshipment', defaults: ALLOWED },
  { key: 'priceBasis', label: 'Price basis', defaults: PRICE_BASIS },
  { key: 'bankCharges', label: 'Bank charges', defaults: BANK_CHARGES },
  { key: 'inspection', label: 'Inspection', defaults: INSPECTION },
  { key: 'exportType', label: 'Export type (GST)', defaults: EXPORT_TYPES },
  { key: 'packageType', label: 'Package type', defaults: PACKAGE_TYPES },
  { key: 'units', label: 'Item unit', defaults: UNITS },
] as const;
export type ListKey = (typeof EDITABLE_LISTS)[number]['key'];

/** Form field → the editable list that feeds its drop-down. */
export const LIST_FOR_FIELD: Partial<Record<string, ListKey>> = {
  portLoading: 'portLoading', transportMode: 'transportMode', precarriage: 'precarriage', container: 'container',
  partialShipment: 'allowed', transshipment: 'allowed', priceBasis: 'priceBasis', bankCharges: 'bankCharges',
  inspection: 'inspection', exportType: 'exportType', packageType: 'packageType',
};

/** The company's own list if it saved one, else the standard list. */
export const listOptions = (lists: Partial<Record<ListKey, string[]>> | undefined, key: ListKey): readonly string[] =>
  lists?.[key]?.length ? lists[key]! : EDITABLE_LISTS.find((l) => l.key === key)!.defaults;


/** Export test certificate wording, from the workbook's Settings sheet (editable in Settings). */
export const TC_TEST_METHOD =
  'Dimensions measured with a calibrated digital vernier caliper (least count 0.01 mm). Excitation current measured at the applied voltage and frequency across the stated number of turns.';
export const TC_CERTIFICATION =
  'This is to certify that the cores listed above have been tested as per the specified grade and dimensions, and all test parameters are found within permissible limits. The material is accepted and released for dispatch.';
