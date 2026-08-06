// Lorry Receipt (LR / transport consignment) create & edit form.
// One page serves both `/lr/new` (create) and `/lr/:id/edit` (edit) — the
// presence of a route :id switches it into edit mode (prefill via GET) vs
// create mode (prefill the next LR number). Consignor/consignee are backed by
// a small party master: picking a saved party fills its address/GST/mobile, but
// every field stays editable so a brand-new party can be typed and is upserted
// on save. Mirrors the QuotationNewPage conventions (section cards, header,
// SearchableSelect, submit mutation).
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Truck, Save, Loader2, User2, MapPin, Package, IndianRupee, FileText,
  ArrowLeft, Building2, Coins, Route as RouteIcon,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SearchableSelect } from '@/components/SearchableSelect';
import {
  type LorryReceipt, type LrParty, type LrTransporter, type PaymentMode,
  computeFreight, PAY_MODES, inrLR,
} from '@/lib/lr';

const todayISO = () => new Date().toISOString().slice(0, 10);
const dateStr = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : '');

/* ----- section card (coloured left accent bar + icon chip per section) ----- */
type Accent = 'brand' | 'indigo' | 'teal' | 'amber' | 'emerald' | 'slate';
const ACCENTS: Record<Accent, { bar: string; chip: string }> = {
  brand: { bar: 'bg-brand-500', chip: 'bg-brand-100 text-brand-700' },
  indigo: { bar: 'bg-indigo-500', chip: 'bg-indigo-100 text-indigo-700' },
  teal: { bar: 'bg-teal-500', chip: 'bg-teal-100 text-teal-700' },
  amber: { bar: 'bg-amber-500', chip: 'bg-amber-100 text-amber-700' },
  emerald: { bar: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-700' },
  slate: { bar: 'bg-slate-500', chip: 'bg-slate-200 text-slate-700' },
};

const SectionCard = ({
  accent, icon: Icon, title, subtitle, children,
}: {
  accent: Accent;
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) => (
  <section className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <span className={cn('absolute inset-y-0 left-0 w-1', ACCENTS[accent].bar)} aria-hidden />
    <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 pl-5">
      <span className={cn('grid h-7 w-7 place-items-center rounded-lg', ACCENTS[accent].chip)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="leading-tight">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        {subtitle ? <div className="text-[11px] text-slate-400">{subtitle}</div> : null}
      </div>
    </div>
    <div className="p-4 pl-5 sm:p-5 sm:pl-6">{children}</div>
  </section>
);

export const LorryReceiptNewPage = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id: editId } = useParams<{ id?: string }>();
  const isEdit = !!editId;

  /* ----- header ----- */
  const [lrNo, setLrNo] = useState('');
  const [lrDate, setLrDate] = useState(todayISO());
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('TO-PAY');
  const [modeOfDispatch, setModeOfDispatch] = useState('BY ROAD');
  const [transporterId, setTransporterId] = useState('');

  /* ----- consignor ----- */
  const [consignorName, setConsignorName] = useState('');
  const [consignorAddress, setConsignorAddress] = useState('');
  const [consignorGstin, setConsignorGstin] = useState('');
  const [consignorMobile, setConsignorMobile] = useState('');

  /* ----- consignee ----- */
  const [consigneeName, setConsigneeName] = useState('');
  const [consigneeAddress, setConsigneeAddress] = useState('');
  const [consigneeGstin, setConsigneeGstin] = useState('');
  const [consigneeMobile, setConsigneeMobile] = useState('');

  /* ----- route ----- */
  const [fromLoc, setFromLoc] = useState('');
  const [toLoc, setToLoc] = useState('');

  /* ----- goods ----- */
  const [packages, setPackages] = useState(0);
  const [packMethod, setPackMethod] = useState('BOXES');
  const [particular, setParticular] = useState('');
  const [actualWt, setActualWt] = useState(0);
  const [chargedWt, setChargedWt] = useState(0);
  const [rate, setRate] = useState(0);

  /* ----- charges ----- */
  const [stCh, setStCh] = useState(0);
  const [hamali, setHamali] = useState(0);
  const [otherCh, setOtherCh] = useState(0);
  const [ddCh, setDdCh] = useState(0);
  const [valueDeclare, setValueDeclare] = useState(0);
  const [riskFovPct, setRiskFovPct] = useState(0);

  /* ----- docs ----- */
  const [invNo, setInvNo] = useState('');
  const [invDate, setInvDate] = useState('');
  const [ewayBillNo, setEwayBillNo] = useState('');
  const [vehNo, setVehNo] = useState('');
  const [dispatchDate, setDispatchDate] = useState('');
  const [remark, setRemark] = useState('');

  const [error, setError] = useState('');

  /* ----- party master (consignor + consignee autocomplete) ----- */
  const { data: partiesResp } = useQuery({
    queryKey: ['lorry-receipts', 'parties'],
    queryFn: () => api<{ items: LrParty[] }>('/lorry-receipts/parties'),
  });
  const parties = partiesResp?.items ?? [];
  const partyOptions = useMemo(() => parties.map((p) => ({ value: p.name, label: p.name })), [parties]);

  /* ----- transporter master (header selector) ----- */
  const { data: transportersResp } = useQuery({
    queryKey: ['lr-transporters'],
    queryFn: () => api<{ items: LrTransporter[] }>('/lorry-receipts/transporters'),
  });
  const transporters = transportersResp?.items ?? [];
  // Create mode: default to the transporter flagged isDefault, once loaded.
  useEffect(() => {
    if (isEdit || transporterId) return;
    const def = transporters.find((t) => t.isDefault);
    if (def) setTransporterId(def.id);
  }, [isEdit, transporterId, transporters]);

  const pickConsignor = (name: string) => {
    setConsignorName(name);
    const p = parties.find((x) => x.name === name);
    if (p) {
      setConsignorAddress(p.address ?? '');
      setConsignorGstin(p.gstin ?? '');
      setConsignorMobile(p.mobile ?? '');
    }
  };
  const pickConsignee = (name: string) => {
    setConsigneeName(name);
    const p = parties.find((x) => x.name === name);
    if (p) {
      setConsigneeAddress(p.address ?? '');
      setConsigneeGstin(p.gstin ?? '');
      setConsigneeMobile(p.mobile ?? '');
    }
  };

  /* ----- create mode: prefill the next LR number ----- */
  const { data: nextNo } = useQuery({
    queryKey: ['lorry-receipts', 'next-number'],
    queryFn: () => api<{ lrNo: string }>('/lorry-receipts/next-number'),
    enabled: !isEdit,
  });
  useEffect(() => {
    if (isEdit || !nextNo?.lrNo) return;
    setLrNo((cur) => (cur === '' ? nextNo.lrNo : cur));
  }, [isEdit, nextNo?.lrNo]);

  /* ----- edit mode: load the existing LR once and prefill ----- */
  const { data: existing } = useQuery({
    queryKey: ['lorry-receipts', editId],
    queryFn: () => api<LorryReceipt>(`/lorry-receipts/${editId}`),
    enabled: isEdit,
  });
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (!existing || prefilled) return;
    setLrNo(existing.lrNo ?? '');
    setLrDate(dateStr(existing.lrDate) || todayISO());
    setPaymentMode(existing.paymentMode ?? 'TO-PAY');
    setModeOfDispatch(existing.modeOfDispatch ?? 'BY ROAD');
    setTransporterId(existing.transporterId ?? '');
    setConsignorName(existing.consignorName ?? '');
    setConsignorAddress(existing.consignorAddress ?? '');
    setConsignorGstin(existing.consignorGstin ?? '');
    setConsignorMobile(existing.consignorMobile ?? '');
    setConsigneeName(existing.consigneeName ?? '');
    setConsigneeAddress(existing.consigneeAddress ?? '');
    setConsigneeGstin(existing.consigneeGstin ?? '');
    setConsigneeMobile(existing.consigneeMobile ?? '');
    setFromLoc(existing.fromLoc ?? '');
    setToLoc(existing.toLoc ?? '');
    setPackages(existing.packages ?? 0);
    setPackMethod(existing.packMethod ?? '');
    setParticular(existing.particular ?? '');
    setActualWt(existing.actualWt ?? 0);
    setChargedWt(existing.chargedWt ?? 0);
    setRate(existing.rate ?? 0);
    setStCh(existing.stCh ?? 0);
    setHamali(existing.hamali ?? 0);
    setOtherCh(existing.otherCh ?? 0);
    setDdCh(existing.ddCh ?? 0);
    setValueDeclare(existing.valueDeclare ?? 0);
    setRiskFovPct(existing.riskFovPct ?? 0);
    setInvNo(existing.invNo ?? '');
    setInvDate(dateStr(existing.invDate));
    setEwayBillNo(existing.ewayBillNo ?? '');
    setVehNo(existing.vehNo ?? '');
    setDispatchDate(dateStr(existing.dispatchDate));
    setRemark(existing.remark ?? '');
    setPrefilled(true);
  }, [existing, prefilled]);

  /* ----- live freight summary ----- */
  const freight = useMemo(
    () => computeFreight({ chargedWt, rate, stCh, hamali, otherCh, ddCh, valueDeclare, riskFovPct }),
    [chargedWt, rate, stCh, hamali, otherCh, ddCh, valueDeclare, riskFovPct]
  );

  /* ----- submit ----- */
  const saveMut = useMutation({
    mutationFn: async () => {
      // Upsert both parties into the master first (ignore errors — the LR save
      // is what matters; a failed party upsert must not block the receipt).
      await api('/lorry-receipts/parties', {
        method: 'POST',
        body: JSON.stringify({ name: consignorName.trim(), address: consignorAddress.trim(), mobile: consignorMobile.trim(), gstin: consignorGstin.trim() }),
      }).catch(() => {});
      await api('/lorry-receipts/parties', {
        method: 'POST',
        body: JSON.stringify({ name: consigneeName.trim(), address: consigneeAddress.trim(), mobile: consigneeMobile.trim(), gstin: consigneeGstin.trim() }),
      }).catch(() => {});

      const payload = {
        lrNo: lrNo.trim(),
        lrDate: lrDate || null,
        paymentMode,
        modeOfDispatch: modeOfDispatch.trim() || null,
        transporterId: transporterId || null,
        consignorName: consignorName.trim(),
        consignorAddress: consignorAddress.trim() || null,
        consignorGstin: consignorGstin.trim() || null,
        consignorMobile: consignorMobile.trim() || null,
        consigneeName: consigneeName.trim(),
        consigneeAddress: consigneeAddress.trim() || null,
        consigneeGstin: consigneeGstin.trim() || null,
        consigneeMobile: consigneeMobile.trim() || null,
        fromLoc: fromLoc.trim() || null,
        toLoc: toLoc.trim() || null,
        packages: Number(packages) || 0,
        packMethod: packMethod.trim() || null,
        particular: particular.trim() || null,
        actualWt: Number(actualWt) || 0,
        chargedWt: Number(chargedWt) || 0,
        rate: Number(rate) || 0,
        stCh: Number(stCh) || 0,
        hamali: Number(hamali) || 0,
        otherCh: Number(otherCh) || 0,
        ddCh: Number(ddCh) || 0,
        valueDeclare: Number(valueDeclare) || 0,
        riskFovPct: Number(riskFovPct) || 0,
        invNo: invNo.trim() || null,
        invDate: invDate || null,
        ewayBillNo: ewayBillNo.trim() || null,
        vehNo: vehNo.trim() || null,
        dispatchDate: dispatchDate || null,
        amountRec: 0,
        remark: remark.trim() || null,
      };
      return api<LorryReceipt>(isEdit ? `/lorry-receipts/${editId}` : '/lorry-receipts', {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['lorry-receipts'] });
      navigate(`/lr/${isEdit ? editId : res.id}/print`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed to save LR'),
  });

  const submit = () => {
    setError('');
    if (!lrNo.trim()) return setError('Enter an LR number.');
    if (!consignorName.trim()) return setError('Enter the consignor name.');
    if (!consigneeName.trim()) return setError('Enter the consignee name.');
    saveMut.mutate();
  };

  const label = 'mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500';
  const totalStr = `₹${inrLR(freight.totalValue)}`;

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* ============ GRADIENT HERO HEADER BAND ============ */}
      <div className="rounded-2xl bg-gradient-to-r from-brand-600 via-brand-600 to-brand-700 px-5 py-4 text-white shadow-md">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          {/* Left: identity */}
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <Truck className="h-6 w-6" />
            </span>
            <div>
              <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
                {isEdit ? 'Edit Lorry Receipt' : 'New Lorry Receipt'}
              </h1>
              <p className="text-sm text-white/70">
                {isEdit ? 'Update this transport consignment note.' : 'Create a transport consignment note.'}
              </p>
              <Link
                to="/lr"
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1 text-xs font-medium text-white ring-1 ring-white/25 transition hover:bg-white/25"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back to Lorry Receipts
              </Link>
            </div>
          </div>

          {/* Right: live total + payment mode pills */}
          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            <div className="text-right">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Total Freight</div>
              <div className="text-2xl font-extrabold tabular-nums">{totalStr}</div>
            </div>
            <div className="inline-flex rounded-xl bg-white/15 p-0.5 ring-1 ring-white/25">
              {PAY_MODES.map((pm) => (
                <button
                  key={pm}
                  type="button"
                  onClick={() => setPaymentMode(pm)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-sm font-semibold transition',
                    paymentMode === pm ? 'bg-white text-brand-700 shadow-sm' : 'text-white/80 hover:text-white'
                  )}
                >
                  {pm}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ============ HEADER / TRANSPORTER CARD ============ */}
      <SectionCard accent="brand" icon={Building2} title="Consignment Header" subtitle="LR number, date, transporter & dispatch">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className={label}>LR No.</span>
            <input className="input" value={lrNo} onChange={(e) => setLrNo(e.target.value)} placeholder="LR/0001" />
          </label>
          <label className="block">
            <span className={label}>LR Date</span>
            <input type="date" className="input" value={lrDate} onChange={(e) => setLrDate(e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>Transporter</span>
            <select className="input" value={transporterId} onChange={(e) => setTransporterId(e.target.value)}>
              <option value="">— Select transporter —</option>
              {transporters.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={label}>Mode of Dispatch</span>
            <input className="input" value={modeOfDispatch} onChange={(e) => setModeOfDispatch(e.target.value)} placeholder="BY ROAD" />
          </label>
        </div>
      </SectionCard>

      {/* ============ CONSIGNOR / CONSIGNEE ============ */}
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        {/* Consignor */}
        <SectionCard accent="brand" icon={User2} title="Consignor" subtitle="From / sender">
          <div className="space-y-3">
            <label className="block">
              <span className={label}>Pick saved party</span>
              <SearchableSelect
                value={parties.some((p) => p.name === consignorName) ? consignorName : ''}
                onChange={pickConsignor}
                options={partyOptions}
                placeholder="Search parties…"
              />
            </label>
            <label className="block">
              <span className={label}>Name</span>
              <input className="input" value={consignorName} onChange={(e) => setConsignorName(e.target.value)} placeholder="Consignor name (or type a new one)" />
            </label>
            <label className="block">
              <span className={label}>Address</span>
              <textarea className="input" rows={2} value={consignorAddress} onChange={(e) => setConsignorAddress(e.target.value)} />
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={label}>GSTIN</span>
                <input className="input" value={consignorGstin} onChange={(e) => setConsignorGstin(e.target.value)} placeholder="24XXXXXXXXXXXZ5" />
              </label>
              <label className="block">
                <span className={label}>Mobile</span>
                <input className="input" value={consignorMobile} onChange={(e) => setConsignorMobile(e.target.value)} placeholder="98XXXXXXXX" />
              </label>
            </div>
          </div>
        </SectionCard>

        {/* Consignee */}
        <SectionCard accent="indigo" icon={User2} title="Consignee" subtitle="To / receiver">
          <div className="space-y-3">
            <label className="block">
              <span className={label}>Pick saved party</span>
              <SearchableSelect
                value={parties.some((p) => p.name === consigneeName) ? consigneeName : ''}
                onChange={pickConsignee}
                options={partyOptions}
                placeholder="Search parties…"
              />
            </label>
            <label className="block">
              <span className={label}>Name</span>
              <input className="input" value={consigneeName} onChange={(e) => setConsigneeName(e.target.value)} placeholder="Consignee name (or type a new one)" />
            </label>
            <label className="block">
              <span className={label}>Address</span>
              <textarea className="input" rows={2} value={consigneeAddress} onChange={(e) => setConsigneeAddress(e.target.value)} />
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={label}>GSTIN</span>
                <input className="input" value={consigneeGstin} onChange={(e) => setConsigneeGstin(e.target.value)} placeholder="24XXXXXXXXXXXZ5" />
              </label>
              <label className="block">
                <span className={label}>Mobile</span>
                <input className="input" value={consigneeMobile} onChange={(e) => setConsigneeMobile(e.target.value)} placeholder="98XXXXXXXX" />
              </label>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* ============ ROUTE ============ */}
      <SectionCard accent="teal" icon={RouteIcon} title="Route">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={label}>From</span>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-teal-500" />
              <input className="input pl-9" value={fromLoc} onChange={(e) => setFromLoc(e.target.value)} placeholder="Origin city" />
            </div>
          </label>
          <label className="block">
            <span className={label}>To</span>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-teal-500" />
              <input className="input pl-9" value={toLoc} onChange={(e) => setToLoc(e.target.value)} placeholder="Destination city" />
            </div>
          </label>
        </div>
      </SectionCard>

      {/* ============ GOODS ============ */}
      <SectionCard accent="amber" icon={Package} title="Goods">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className={label}>Packages</span>
            <input type="number" min={0} className="input text-right tabular-nums" value={packages || ''} onChange={(e) => setPackages(parseInt(e.target.value, 10) || 0)} />
          </label>
          <label className="block">
            <span className={label}>Pack Method</span>
            <input className="input" value={packMethod} onChange={(e) => setPackMethod(e.target.value)} placeholder="BOXES" />
          </label>
          <label className="block sm:col-span-2">
            <span className={label}>Particular</span>
            <input className="input" value={particular} onChange={(e) => setParticular(e.target.value)} placeholder="Description of goods" />
          </label>
          <label className="block">
            <span className={label}>Actual Wt (kg)</span>
            <input type="number" min={0} className="input text-right tabular-nums" value={actualWt || ''} onChange={(e) => setActualWt(parseFloat(e.target.value) || 0)} />
          </label>
          <label className="block">
            <span className={label}>Charged Wt (kg)</span>
            <input type="number" min={0} className="input text-right tabular-nums" value={chargedWt || ''} onChange={(e) => setChargedWt(parseFloat(e.target.value) || 0)} />
          </label>
          <label className="block">
            <span className={label}>Rate (₹ / kg)</span>
            <input type="number" min={0} className="input text-right tabular-nums" value={rate || ''} onChange={(e) => setRate(parseFloat(e.target.value) || 0)} />
          </label>
        </div>
      </SectionCard>

      {/* ============ CHARGES + LIVE FREIGHT ============ */}
      <SectionCard accent="emerald" icon={Coins} title="Charges & Freight" subtitle="Live total recomputes as you type">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block">
            <span className={label}>Statistical Ch. (₹)</span>
            <input type="number" min={0} className="input text-right tabular-nums" value={stCh || ''} onChange={(e) => setStCh(parseFloat(e.target.value) || 0)} />
          </label>
          <label className="block">
            <span className={label}>Hamali (₹)</span>
            <input type="number" min={0} className="input text-right tabular-nums" value={hamali || ''} onChange={(e) => setHamali(parseFloat(e.target.value) || 0)} />
          </label>
          <label className="block">
            <span className={label}>Other Ch. (₹)</span>
            <input type="number" min={0} className="input text-right tabular-nums" value={otherCh || ''} onChange={(e) => setOtherCh(parseFloat(e.target.value) || 0)} />
          </label>
          <label className="block">
            <span className={label}>DD Ch. (₹)</span>
            <input type="number" min={0} className="input text-right tabular-nums" value={ddCh || ''} onChange={(e) => setDdCh(parseFloat(e.target.value) || 0)} />
          </label>
          <label className="block">
            <span className={label}>Goods Declared Value (₹)</span>
            <input type="number" min={0} className="input text-right tabular-nums" value={valueDeclare || ''} onChange={(e) => setValueDeclare(parseFloat(e.target.value) || 0)} />
          </label>
          <label className="block">
            <span className={label}>Risk / FOV (%)</span>
            <input type="number" min={0} className="input text-right tabular-nums" value={riskFovPct || ''} onChange={(e) => setRiskFovPct(parseFloat(e.target.value) || 0)} />
          </label>
        </div>

        {/* Live freight breakdown */}
        <div className="mt-4 overflow-hidden rounded-xl border border-emerald-100 bg-emerald-50/40">
          <dl className="divide-y divide-emerald-100/70 text-sm">
            <div className="flex items-center justify-between px-4 py-2">
              <dt className="text-slate-600">Freight <span className="text-slate-400">(charged wt × rate)</span></dt>
              <dd className="font-medium tabular-nums text-slate-800">₹{inrLR(freight.base)}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-2">
              <dt className="text-slate-600">Statistical charge</dt>
              <dd className="font-medium tabular-nums text-slate-800">₹{inrLR(stCh)}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-2">
              <dt className="text-slate-600">Hamali</dt>
              <dd className="font-medium tabular-nums text-slate-800">₹{inrLR(hamali)}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-2">
              <dt className="text-slate-600">Other charge</dt>
              <dd className="font-medium tabular-nums text-slate-800">₹{inrLR(otherCh)}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-2">
              <dt className="text-slate-600">D/D charge</dt>
              <dd className="font-medium tabular-nums text-slate-800">₹{inrLR(ddCh)}</dd>
            </div>
            <div className="flex items-center justify-between px-4 py-2">
              <dt className="text-slate-600">Risk / FOV</dt>
              <dd className="font-medium tabular-nums text-slate-800">₹{inrLR(freight.riskFovAmount)}</dd>
            </div>
          </dl>
          {/* Big brand-tinted total */}
          <div className="flex items-center justify-between border-t border-emerald-200 bg-brand-50 px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-brand-700">
              <IndianRupee className="h-4 w-4" /> Total Freight
            </span>
            <span className="text-2xl font-extrabold tabular-nums text-brand-700">{totalStr}</span>
          </div>
        </div>
      </SectionCard>

      {/* ============ DOCS ============ */}
      <SectionCard accent="slate" icon={FileText} title="Documents & Dispatch">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className={label}>Invoice No.</span>
            <input className="input" value={invNo} onChange={(e) => setInvNo(e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>Invoice Date</span>
            <input type="date" className="input" value={invDate} onChange={(e) => setInvDate(e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>E-Way Bill No.</span>
            <input className="input" value={ewayBillNo} onChange={(e) => setEwayBillNo(e.target.value)} />
          </label>
          <label className="block">
            <span className={label}>Vehicle No.</span>
            <input className="input" value={vehNo} onChange={(e) => setVehNo(e.target.value)} placeholder="GJ-06-XX-0000" />
          </label>
          <label className="block">
            <span className={label}>Dispatch Date</span>
            <input type="date" className="input" value={dispatchDate} onChange={(e) => setDispatchDate(e.target.value)} />
          </label>
          <label className="block sm:col-span-2 lg:col-span-3">
            <span className={label}>Remark</span>
            <textarea className="input" rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
          </label>
        </div>
      </SectionCard>

      {/* ============ STICKY SUBMIT BAR ============ */}
      <div className="sticky bottom-0 z-10 -mx-1 rounded-t-2xl border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_-6px_rgba(0,0,0,0.15)] backdrop-blur">
        {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total Freight</span>
            <span className="text-xl font-extrabold tabular-nums text-brand-700">{totalStr}</span>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            <Link to="/lr" className="btn-ghost w-full text-slate-600 sm:w-auto">Cancel</Link>
            <button type="button" onClick={submit} disabled={saveMut.isPending} className="btn-primary w-full disabled:opacity-60 sm:w-auto">
              {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isEdit ? 'Save Changes' : 'Save Lorry Receipt'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LorryReceiptNewPage;
