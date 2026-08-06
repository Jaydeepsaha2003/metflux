// Shared parser/importer for a historical Lorry Receipt "Record-Book"
// spreadsheet (e.g. "LR FINAL - BALAJI LOGISTICS.xlsx") — reads the
// Record-Book / CONSIGNOR / CONSIGNEE sheets, creates one LorryReceipt per row
// and upserts the consignor/consignee party master. Idempotent — an LR whose
// (company, lrNo) already exists is skipped, so re-running (e.g. on every
// deploy) is safe. Used by both the interactive CLI script and the
// auto-run-on-migrate wrapper.
import XLSX from 'xlsx';
import { q, qOne, insert, newId } from './db.js';
import { normName } from './invoicing.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => { const n = Number(String(v ?? '').replace(/[,%₹\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const str = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s; };

// Parse "19-May-25", "5/19/25", "19-05-2025", or an Excel serial → JS Date | null.
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const parseDate = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || /^\d{4,5}$/.test(String(v).trim())) {
    const n = Number(v); if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  }
  const s = String(v).trim();
  let m = /^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{2,4})$/.exec(s); // 19-May-25
  if (m) { let y = +m[3]; if (y < 100) y += 2000; const mo = MON[m[2].slice(0, 3).toLowerCase()]; if (mo != null) return new Date(Date.UTC(y, mo, +m[1])); }
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(s); // 5/19/25 (M/D/Y) or 19-05-2025 (D-M-Y)
  if (m) { let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000; let mo, d; if (a > 12) { d = a; mo = b - 1; } else { mo = a - 1; d = b; } return new Date(Date.UTC(y, mo, d)); }
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d;
};

const payMode = (v) => {
  const s = String(v ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (s.includes('PAID')) return 'PAID';
  if (s === 'TBB') return 'TBB';
  return 'TO-PAY';
};

/** Resolve a company by id, or by a case-insensitive substring of its name. */
export const resolveCompany = async (idOrNameFragment) => {
  const companies = await q('SELECT `id`,`name` FROM `Company`');
  const company = companies.find((c) => c.id === idOrNameFragment)
    || companies.find((c) => idOrNameFragment && c.name.toUpperCase().includes(String(idOrNameFragment).toUpperCase()));
  return { company, companies };
};

/**
 * Import a Record-Book .xlsx file into one company. Idempotent per (company, lrNo).
 * @returns {Promise<{imported:number, skipped:number, errors:number, errorMessages:string[]}>}
 */
export const importRecordBookFile = async (filePath, companyId, { dry = false } = {}) => {
  const wb = XLSX.readFile(filePath);
  const cid = companyId;
  // Newly-imported LRs are attributed to the company's current default
  // transporter (so the print letterhead shows the transporter, not the
  // company) — falls back to null (→ company letterhead) if none is set yet.
  const defaultTransporter = await qOne('SELECT `id` FROM `LrTransporter` WHERE `companyId` = ? AND `isDefault` = 1 LIMIT 1', [cid]).catch(() => null);
  const transporterId = defaultTransporter?.id ?? null;

  // Party masters (address / mobile / gstin) keyed by normalized name.
  const masters = new Map();
  for (const sheet of ['CONSIGNOR', 'CONSIGNEE']) {
    const ws = wb.Sheets[sheet]; if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    for (const r of rows) {
      const name = String(r[1] ?? '').trim(); if (!name || name.toUpperCase() === 'NAME') continue;
      const nk = normName(name); if (!nk || masters.has(nk)) continue;
      masters.set(nk, { name, address: str(r[2]), mobile: str(r[3]), gstin: str(r[5]) });
    }
  }

  const ws = wb.Sheets['Record-Book'];
  if (!ws) throw new Error('No "Record-Book" sheet found in the workbook');
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  // Header is the row whose 2nd cell reads "LR No"; data starts after it.
  const hdrIdx = rows.findIndex((r) => String(r[1] ?? '').trim().toLowerCase() === 'lr no');
  const dataRows = hdrIdx >= 0 ? rows.slice(hdrIdx + 1) : rows.slice(5);

  const partyUpsertCache = new Set();
  const upsertParty = async (name) => {
    if (!name) return;
    const nk = normName(name); if (!nk || partyUpsertCache.has(nk)) return;
    partyUpsertCache.add(nk);
    const m = masters.get(nk) || { name, address: null, mobile: null, gstin: null };
    const exists = await qOne('SELECT `id` FROM `LrParty` WHERE `companyId`=? AND `name`=?', [cid, name]);
    if (exists || dry) return;
    await insert('LrParty', { companyId: cid, name, address: m.address, mobile: m.mobile, gstin: m.gstin });
  };

  let imported = 0, skipped = 0, errors = 0;
  const errorMessages = [];
  const samples = [];
  for (const r of dataRows) {
    const lrNo = String(r[1] ?? '').trim();
    const lrDate = parseDate(r[2]);
    if (!lrNo || !lrDate) continue; // blank / non-data row
    try {
      const dup = await qOne('SELECT `id` FROM `LorryReceipt` WHERE `companyId`=? AND `lrNo`=?', [cid, lrNo]);
      if (dup) { skipped++; continue; }

      const consignorName = String(r[3] ?? '').trim() || 'UNKNOWN';
      const consigneeName = String(r[4] ?? '').trim() || 'UNKNOWN';
      const cog = masters.get(normName(consignorName)) || {};
      const cee = masters.get(normName(consigneeName)) || {};

      const chargedWt = num(r[11]), rate = num(r[12]);
      const stCh = num(r[13]), riskFovPct = num(r[14]), hamali = num(r[15]), otherCh = num(r[16]), ddCh = num(r[17]);
      const valueDeclare = num(r[24]);
      const riskFovAmount = round2(valueDeclare * riskFovPct / 100);
      const totalValue = round2(chargedWt * rate + stCh + hamali + otherCh + ddCh + riskFovAmount);

      if (dry) { imported++; if (samples.length < 3) samples.push(`${lrNo} · ${consignorName} → ${consigneeName} · ₹${totalValue}`); continue; }

      await upsertParty(consignorName);
      await upsertParty(consigneeName);
      await insert('LorryReceipt', {
        id: newId(), companyId: cid, lrNo, lrDate,
        transporterId,
        publicToken: newId().replace(/-/g, ''), // so the printed QR / e-copy link works
        consignorName, consignorAddress: cog.address ?? null, consignorGstin: cog.gstin ?? null, consignorMobile: cog.mobile ?? null,
        consigneeName, consigneeAddress: cee.address ?? null, consigneeGstin: cee.gstin ?? null, consigneeMobile: cee.mobile ?? null,
        fromLoc: str(r[5]), toLoc: str(r[6]),
        packages: Math.round(num(r[7])), packMethod: str(r[8]), particular: str(r[9]),
        actualWt: num(r[10]), chargedWt, rate,
        stCh, riskFovPct, riskFovAmount, hamali, otherCh, ddCh, totalValue,
        invNo: str(r[19]), invDate: parseDate(r[20]), ewayBillNo: str(r[21]),
        modeOfDispatch: str(r[22]) || 'BY ROAD', paymentMode: payMode(r[23]), valueDeclare,
        vehNo: str(r[26]), dispatchDate: parseDate(r[27]), amountRec: num(r[28]), remark: str(r[29]),
      });
      imported++;
    } catch (e) {
      errors++;
      if (errorMessages.length < 5) errorMessages.push(`${lrNo}: ${e.message}`);
    }
  }

  return { imported, skipped, errors, errorMessages, samples };
};

/**
 * Attach a company's current default transporter to any of its Lorry Receipts
 * that don't have one yet (transporterId IS NULL) — so older imports (or any
 * LR created before a default transporter existed) show the transporter
 * letterhead instead of falling back to the company name. No-op if the
 * company has no default transporter set. Safe to run repeatedly.
 * @returns {Promise<number>} rows updated
 */
export const backfillDefaultTransporter = async (companyId) => {
  const def = await qOne('SELECT `id` FROM `LrTransporter` WHERE `companyId` = ? AND `isDefault` = 1 LIMIT 1', [companyId]);
  if (!def) return 0;
  const result = await q('UPDATE `LorryReceipt` SET `transporterId` = ? WHERE `companyId` = ? AND `transporterId` IS NULL', [def.id, companyId]);
  return result?.affectedRows ?? 0;
};
