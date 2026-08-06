// Lorry Receipt (transport consignment) shared types + freight calculation.
export type PaymentMode = 'PAID' | 'TO-PAY' | 'TBB';

export type LorryReceipt = {
  id: string;
  lrNo: string;
  lrDate: string;
  consignorName: string; consignorAddress: string | null; consignorGstin: string | null; consignorMobile: string | null;
  consigneeName: string; consigneeAddress: string | null; consigneeGstin: string | null; consigneeMobile: string | null;
  fromLoc: string | null; toLoc: string | null;
  packages: number; packMethod: string | null; particular: string | null;
  actualWt: number; chargedWt: number; rate: number;
  stCh: number; riskFovPct: number; riskFovAmount: number; hamali: number; otherCh: number; ddCh: number; totalValue: number;
  invNo: string | null; invDate: string | null; ewayBillNo: string | null;
  modeOfDispatch: string | null; paymentMode: PaymentMode; valueDeclare: number;
  vehNo: string | null; dispatchDate: string | null; amountRec: number; remark: string | null;
  createdAt: string;
};

export type LrParty = { id: string; name: string; address: string | null; mobile: string | null; gstin: string | null };

/** Freight = charged-weight × rate + fixed heads + risk (a % of declared value). */
export const computeFreight = (d: {
  chargedWt?: number; rate?: number; stCh?: number; hamali?: number; otherCh?: number; ddCh?: number;
  valueDeclare?: number; riskFovPct?: number;
}) => {
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const base = r2(Number(d.chargedWt || 0) * Number(d.rate || 0));
  const riskFovAmount = r2(Number(d.valueDeclare || 0) * Number(d.riskFovPct || 0) / 100);
  const totalValue = r2(base + Number(d.stCh || 0) + Number(d.hamali || 0) + Number(d.otherCh || 0) + Number(d.ddCh || 0) + riskFovAmount);
  return { base, riskFovAmount, totalValue };
};

export const PAY_MODES: PaymentMode[] = ['TO-PAY', 'PAID', 'TBB'];
export const inrLR = (n: number) => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
