// Lorry Receipt (LR / transport consignment) create & edit form.
// One page serves both `/lr/new` (create) and `/lr/:id/edit` (edit) — the
// presence of a route :id switches it into edit mode (prefill via GET) vs
// create mode (prefill the next LR number). Consignor/consignee are backed by
// a small party master: picking a saved party fills its address/GST/mobile, but
// every field stays editable so a brand-new party can be typed and is upserted
// on save. Mirrors the QuotationNewPage conventions (section cards, header,
// SearchableSelect, submit mutation).
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Truck, Save, Loader2, Calculator, User2, MapPin, Package, IndianRupee, FileText } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { SearchableSelect } from '@/components/SearchableSelect';
import { type LorryReceipt, type LrParty, type PaymentMode, computeFreight, PAY_MODES, inrLR } from '@/lib/lr';

const todayISO = () => new Date().toISOString().slice(0, 10);
const dateStr = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : '');

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
  const [amountRec, setAmountRec] = useState(0);
  const [remark, setRemark] = useState('');

  const [error, setError] = useState('');

  /* ----- party master (consignor + consignee autocomplete) ----- */
  const { data: partiesResp } = useQuery({
    queryKey: ['lorry-receipts', 'parties'],
    queryFn: () => api<{ items: LrParty[] }>('/lorry-receipts/parties'),
  });
  const parties = partiesResp?.items ?? [];
  const partyOptions = useMemo(() => parties.map((p) => ({ value: p.name, label: p.name })), [parties]);

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
    setAmountRec(existing.amountRec ?? 0);
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
        amountRec: Number(amountRec) || 0,
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

  const label = 'mb-1 block text-xs font-medium text-slate-600';
  const heading = 'mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900';
  const cardCls = 'rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5';

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* ============ HEADER ============ */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <Truck className="h-5 w-5 text-brand-600" /> {isEdit ? 'Edit Lorry Receipt' : 'New Lorry Receipt'}
        </h1>
        <Link to="/lr" className="btn-ghost self-start text-slate-600 sm:self-auto">Back</Link>
      </div>

      {/* ============ HEADER CARD ============ */}
      <section className={cardCls}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className={label}>LR No.</span>
            <input className="input" value={lrNo} onChange={(e) => setLrNo(e.target.value)} placeholder="LR/0001" />
          </label>
          <label className="block">
            <span className={label}>LR Date</span>
            <input type="date" className="input" value={lrDate} onChange={(e) => setLrDate(e.target.value)} />
          </label>
          <div className="block">
            <span className={label}>Payment Mode</span>
            <div className="inline-flex w-full rounded-lg bg-slate-100 p-0.5 text-sm">
              {PAY_MODES.map((pm) => (
                <button key={pm} type="button" onClick={() => setPaymentMode(pm)}
                  className={cn('flex-1 rounded-md px-2 py-1.5 font-medium transition',
                    paymentMode === pm ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
                  {pm}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className={label}>Mode of Dispatch</span>
            <input className="input" value={modeOfDispatch} onChange={(e) => setModeOfDispatch(e.target.value)} placeholder="BY ROAD" />
          </label>
        </div>
      </section>

      {/* ============ CONSIGNOR / CONSIGNEE ============ */}
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        {/* Consignor */}
        <section className={cardCls}>
          <h2 className={heading}><User2 className="h-4 w-4 text-brand-600" /> Consignor <span className="font-normal text-slate-400">(from)</span></h2>
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
        </section>

        {/* Consignee */}
        <section className={cardCls}>
          <h2 className={heading}><User2 className="h-4 w-4 text-brand-600" /> Consignee <span className="font-normal text-slate-400">(to)</span></h2>
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
        </section>
      </div>

      {/* ============ ROUTE ============ */}
      <section className={cardCls}>
        <h2 className={heading}><MapPin className="h-4 w-4 text-brand-600" /> Route</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={label}>From</span>
            <input className="input" value={fromLoc} onChange={(e) => setFromLoc(e.target.value)} placeholder="Origin city" />
          </label>
          <label className="block">
            <span className={label}>To</span>
            <input className="input" value={toLoc} onChange={(e) => setToLoc(e.target.value)} placeholder="Destination city" />
          </label>
        </div>
      </section>

      {/* ============ GOODS ============ */}
      <section className={cardCls}>
        <h2 className={heading}><Package className="h-4 w-4 text-brand-600" /> Goods</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className={label}>Packages</span>
            <input type="number" min={0} className="input" value={packages || ''} onChange={(e) => setPackages(parseInt(e.target.value, 10) || 0)} />
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
            <input type="number" min={0} className="input" value={actualWt || ''} onChange={(e) => setActualWt(parseFloat(e.target.value) || 0)} />
          </label>
          <label className="block">
            <span className={label}>Charged Wt (kg)</span>
            <input type="number" min={0} className="input" value={chargedWt || ''} onChange={(e) => setChargedWt(parseFloat(e.target.value) || 0)} />
          </label>
          <label className="block">
            <span className={label}>Rate (₹ / kg)</span>
            <input type="number" min={0} className="input" value={rate || ''} onChange={(e) => setRate(parseFloat(e.target.value) || 0)} />
          </label>
        </div>
      </section>

      {/* ============ CHARGES + LIVE FREIGHT ============ */}
      <section className={cardCls}>
        <h2 className={heading}><Calculator className="h-4 w-4 text-brand-600" /> Charges &amp; Freight</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block">
            <span className={label}>Statistical Ch. (₹)</span>
            <input type="number" min={0} className="input" value={stCh || ''} onChange={(e) => setStCh(parseFloat(e.target.value) || 0)} />
          </label>
          <label className="block">
            <span className={label}>Hamali (₹)</span>
            <input type="number" min={0} className="input" value={hamali || ''} onChange={(e) => setHamali(parseFloat(e.target.value) || 0)} />
          </label>
          <label className="block">
            <span className={label}>Other Ch. (₹)</span>
            <input type="number" min={0} className="input" value={otherCh || ''} onChange={(e) => setOtherCh(parseFloat(e.target.value) || 0)} />
          </label>
          <label className="block">
            <span className={label}>DD Ch. (₹)</span>
            <input type="number" min={0} className="input" value={ddCh || ''} onChange={(e) => setDdCh(parseFloat(e.target.value) || 0)} />
          </label>
          <label className="block">
            <span className={label}>Value Declared (₹)</span>
            <input type="number" min={0} className="input" value={valueDeclare || ''} onChange={(e) => setValueDeclare(parseFloat(e.target.value) || 0)} />
          </label>
          <label className="block">
            <span className={label}>Risk / FOV (%)</span>
            <input type="number" min={0} className="input" value={riskFovPct || ''} onChange={(e) => setRiskFovPct(parseFloat(e.target.value) || 0)} />
          </label>
        </div>

        {/* Live freight summary */}
        <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Base (wt × rate)</span>
                <span className="font-medium tabular-nums text-slate-800">₹{inrLR(freight.base)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Risk / FOV</span>
                <span className="font-medium tabular-nums text-slate-800">₹{inrLR(freight.riskFovAmount)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Other heads</span>
                <span className="font-medium tabular-nums text-slate-800">
                  ₹{inrLR((Number(stCh) || 0) + (Number(hamali) || 0) + (Number(otherCh) || 0) + (Number(ddCh) || 0))}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 shadow-sm ring-1 ring-brand-200">
              <IndianRupee className="h-5 w-5 text-brand-600" />
              <div className="text-right">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Total</div>
                <div className="text-xl font-bold tabular-nums text-brand-700">₹{inrLR(freight.totalValue)}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ DOCS ============ */}
      <section className={cardCls}>
        <h2 className={heading}><FileText className="h-4 w-4 text-brand-600" /> Documents &amp; Dispatch</h2>
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
          <label className="block">
            <span className={label}>Amount Received (₹)</span>
            <input type="number" min={0} className="input" value={amountRec || ''} onChange={(e) => setAmountRec(parseFloat(e.target.value) || 0)} />
          </label>
          <label className="block sm:col-span-2 lg:col-span-2">
            <span className={label}>Remark</span>
            <textarea className="input" rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
          </label>
        </div>
      </section>

      {/* ============ SUBMIT ============ */}
      <section className={cn(cardCls, 'space-y-3')}>
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Link to="/lr" className="btn-ghost w-full text-slate-600 sm:w-auto">Cancel</Link>
          <button type="button" onClick={submit} disabled={saveMut.isPending} className="btn-primary w-full disabled:opacity-60 sm:w-auto">
            {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isEdit ? 'Save Changes' : 'Save Lorry Receipt'}
          </button>
        </div>
      </section>
    </div>
  );
};

export default LorryReceiptNewPage;
