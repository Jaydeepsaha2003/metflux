// Daily in-process reminders — no external cron, no extra deps. A single
// interval wakes up periodically, works out the wall-clock time in REMINDER_TZ,
// and fires each job once per day:
//
//   • Production summary  — every day at REMINDER_PROD_HOUR (default 18:00 / 6 PM):
//     nudge company admins to review the day's output.
//   • Invoice due sweep   — every day at REMINDER_DUE_HOUR (default 09:00):
//     tell admins how many sales / purchase invoices fall due that day.
//
// A ReminderRun guard row (unique per job+day) makes each job fire exactly once,
// surviving restarts and two domain clones that share one database.
import { q, qOne, newId } from './db.js';
import { env } from './env.js';
import { notifyCompanyAdmins } from './push.js';

const TICK_MS = 5 * 60 * 1000; // check every 5 minutes

// Wall-clock parts (date + hour) in the configured timezone.
const localParts = () => {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.REMINDER_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => p.find((x) => x.type === t)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
};

const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

// Try to reserve a job for today; returns true only for the process that wins.
const claim = async (runKey) => {
  try {
    await q('INSERT INTO `ReminderRun` (`id`, `runKey`) VALUES (?, ?)', [newId(), runKey]);
    return true;
  } catch (e) {
    if (e?.code === 'ER_DUP_ENTRY') return false; // already run today
    throw e;
  }
};

const activeCompanies = async () => {
  try {
    return await q('SELECT `id`, `name` FROM `Company` WHERE `isActive` = 1');
  } catch {
    try { return await q('SELECT `id`, `name` FROM `Company`'); } catch { return []; }
  }
};

// ── Job: production summary reminder ──
const runProductionReminder = async (localDate) => {
  if (!(await claim(`prod:${localDate}`))) return;
  const companies = await activeCompanies();
  for (const c of companies) {
    await notifyCompanyAdmins(c.id, {
      type: 'PRODUCTION',
      title: 'Production summary reminder',
      body: `Review today's production output for ${c.name}.`,
      url: '/s/admin/production/summary',
      tag: 'prod-reminder',
    }).catch(() => {});
  }
  console.log(`[reminders] production reminder sent (${companies.length} companies)`);
};

// ── Job: invoices due today ──
const runInvoiceDueReminder = async (localDate) => {
  if (!(await claim(`invdue:${localDate}`))) return;
  const companies = await activeCompanies();
  for (const c of companies) {
    let sales = { n: 0, amt: 0 };
    let purch = { n: 0, amt: 0 };
    let overdue = { n: 0, amt: 0 };
    let worst = [];
    try {
      const r = await qOne(
        `SELECT COUNT(*) AS n, COALESCE(SUM(\`amount\` - \`paidAmount\`), 0) AS amt
           FROM \`SalesInvoice\`
          WHERE \`companyId\` = ? AND \`status\` <> 'PAID'
            AND \`dueDate\` IS NOT NULL AND DATE(\`dueDate\`) = ?`,
        [c.id, localDate]
      );
      sales = { n: Number(r?.n ?? 0), amt: Number(r?.amt ?? 0) };
      // Anything already past its due date. Matching only DATE(dueDate)=today
      // meant a bill was mentioned once, on its due date, and never again —
      // so the invoices that most need chasing were the silent ones.
      const o = await qOne(
        `SELECT COUNT(*) AS n, COALESCE(SUM(\`amount\` - \`paidAmount\`), 0) AS amt
           FROM \`SalesInvoice\`
          WHERE \`companyId\` = ? AND \`status\` <> 'PAID'
            AND \`dueDate\` IS NOT NULL AND DATE(\`dueDate\`) < ?`,
        [c.id, localDate]
      );
      overdue = { n: Number(o?.n ?? 0), amt: Number(o?.amt ?? 0) };
      // Name the worst debtors — an aggregate can't be acted on.
      worst = await q(
        `SELECT \`customerName\` nm, COALESCE(SUM(\`amount\` - \`paidAmount\`), 0) amt,
                MAX(DATEDIFF(?, \`dueDate\`)) days
           FROM \`SalesInvoice\`
          WHERE \`companyId\` = ? AND \`status\` <> 'PAID'
            AND \`dueDate\` IS NOT NULL AND DATE(\`dueDate\`) < ?
          GROUP BY \`customerName\` ORDER BY amt DESC LIMIT 3`,
        [localDate, c.id, localDate]
      );
    } catch { /* table may be absent */ }
    try {
      const r = await qOne(
        `SELECT COUNT(*) AS n, COALESCE(SUM(\`amount\` - \`paidAmount\`), 0) AS amt
           FROM \`PurchaseInvoice\`
          WHERE \`companyId\` = ? AND \`status\` <> 'PAID'
            AND \`dueDate\` IS NOT NULL AND DATE(\`dueDate\`) = ?`,
        [c.id, localDate]
      );
      purch = { n: Number(r?.n ?? 0), amt: Number(r?.amt ?? 0) };
    } catch { /* dueDate/table may be absent */ }

    if (sales.n + purch.n + overdue.n === 0) continue;
    const parts = [];
    if (overdue.n) parts.push(`${overdue.n} OVERDUE (${inr(overdue.amt)})`);
    if (sales.n) parts.push(`${sales.n} due today (${inr(sales.amt)})`);
    if (purch.n) parts.push(`${purch.n} purchase (${inr(purch.amt)}) to pay`);
    // Who to chase, longest-overdue amount first.
    if (worst.length) {
      parts.push(worst.map((w) => `${w.nm} ${inr(Number(w.amt))} (${Number(w.days)}d)`).join(', '));
    }
    await notifyCompanyAdmins(c.id, {
      type: 'DUE',
      // Overdue is the more urgent fact, so it leads.
      title: overdue.n ? `${overdue.n} invoice${overdue.n === 1 ? '' : 's'} overdue — ${inr(overdue.amt)}` : 'Invoices due today',
      body: parts.join(' · '),
      url: overdue.n ? '/s/admin/sales-invoices?due=overdue'
        : sales.n ? '/s/admin/sales-invoices?due=today' : '/s/admin/accounts/creditor-aging',
      tag: 'invoice-due',
    }).catch(() => {});
  }
  console.log('[reminders] invoice-due sweep done');
};

const tick = async () => {
  try {
    const { date, hour } = localParts();
    // Fire at or after the target hour (so a restart later in the day still
    // delivers), but only once per day thanks to the claim guard.
    if (hour >= env.REMINDER_DUE_HOUR) await runInvoiceDueReminder(date);
    if (hour >= env.REMINDER_PROD_HOUR) await runProductionReminder(date);
  } catch (err) {
    console.error('[reminders] tick failed:', err?.message ?? err);
  }
};

export const startReminders = () => {
  if (!env.REMINDERS_ENABLED) {
    console.log('[reminders] disabled (REMINDERS_ENABLED=false)');
    return;
  }
  console.log(`[reminders] enabled — TZ=${env.REMINDER_TZ}, prod ${env.REMINDER_PROD_HOUR}:00, due ${env.REMINDER_DUE_HOUR}:00`);
  // First check shortly after boot, then every TICK_MS.
  setTimeout(tick, 30 * 1000).unref();
  setInterval(tick, TICK_MS).unref();
};
