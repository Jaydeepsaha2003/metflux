// Adds ONE sample Lorry Receipt (LR No. "SAMPLE-001") to a company so you can
// try the printed LR / QR e-copy without waiting for a real consignment.
// Idempotent — running it again does nothing if SAMPLE-001 already exists for
// that company. Delete the row from the LR Record Book whenever you're done.
//
// Usage:
//   node scripts/seed-lr-sample.js --company "<companyId or name>"
import 'dotenv/config';
import { pool, q, qOne, insert, newId } from '../lib/db.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const COMPANY = arg('company');
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const main = async () => {
  const companies = await q('SELECT `id`,`name`,`address`,`gstNumber`,`phone` FROM `Company`');
  const company = companies.find((c) => c.id === COMPANY)
    || companies.find((c) => COMPANY && c.name.toUpperCase().includes(String(COMPANY).toUpperCase()));
  if (!company) {
    console.log('Pass --company with one of these ids/names:');
    companies.forEach((c) => console.log(`  ${c.id}  ${c.name}`));
    throw new Error('Company not resolved');
  }

  const dup = await qOne('SELECT `id` FROM `LorryReceipt` WHERE `companyId` = ? AND `lrNo` = ?', [company.id, 'SAMPLE-001']);
  if (dup) { console.log(`SAMPLE-001 already exists for ${company.name} — nothing to do. Delete it from the LR Record Book to reseed.`); return; }

  const chargedWt = 500, rate = 1.5, stCh = 100, hamali = 50, otherCh = 0, ddCh = 0, riskFovPct = 0.1, valueDeclare = 85000;
  const riskFovAmount = round2(valueDeclare * riskFovPct / 100);
  const totalValue = round2(chargedWt * rate + stCh + hamali + otherCh + ddCh + riskFovAmount);
  const today = new Date();
  const dispatchDate = new Date(today.getTime() - 86400000); // yesterday, so it reads naturally

  const row = await insert('LorryReceipt', {
    id: newId(), companyId: company.id, lrNo: 'SAMPLE-001', lrDate: today,
    transporterId: null, // falls back to the default transporter / company letterhead
    publicToken: newId().replace(/-/g, ''), // so the printed QR / e-copy link works immediately
    consignorName: company.name,
    consignorAddress: company.address ?? 'Plot No. 1, Industrial Area',
    consignorGstin: company.gstNumber ?? null,
    consignorMobile: company.phone ?? null,
    consigneeName: 'SAMPLE CONSIGNEE PVT LTD',
    consigneeAddress: 'B-17, Sector-83, Noida, U.P - 201305',
    consigneeGstin: '09AAAAA0000A1Z5',
    consigneeMobile: '+91 90000 00000',
    fromLoc: 'KUNDLI', toLoc: 'NOIDA',
    packages: 15, packMethod: 'BOXES', particular: 'SAMPLE GOODS — FOR TESTING PRINT ONLY',
    actualWt: 314, chargedWt, rate,
    stCh, riskFovPct, riskFovAmount, hamali, otherCh, ddCh, totalValue,
    invNo: 'SAMPLE/INV/0001', invDate: today, ewayBillNo: '000000000000',
    modeOfDispatch: 'BY ROAD', paymentMode: 'TO-PAY', valueDeclare,
    vehNo: 'DL01AB1234', dispatchDate, amountRec: 0,
    remark: 'Sample record for testing the printed LR / QR e-copy — safe to delete.',
  });

  console.log(`Created sample LR "${row.lrNo}" for ${company.name}.`);
  console.log(`Open it in the app: LR Record Book -> SAMPLE-001 -> Print.`);
  console.log(`Delete it from the Record Book once you're done testing.`);
};

main().catch((e) => { console.error('[seed] failed:', e.message); process.exitCode = 1; }).finally(() => pool.end());
