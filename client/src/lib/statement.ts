// Build the e-mailable artifacts for an outstanding statement: an Excel file
// (matching the sample export) and an HTML email body. Shares the StatementInput
// shape with the PNG renderer in agingImage.ts.
import * as XLSX from 'xlsx';
import type { StatementInput } from '@/lib/agingImage';

const money = (n: number) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rupee = (n: number) => '₹ ' + money(n);
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Excel (.xlsx) statement — same shape as the sample export. */
export const buildStatementXlsxBlob = (i: StatementInput): Blob => {
  const aoa: (string | number)[][] = [
    ['CUSTOMER OUTSTANDING STATEMENT'],
    [i.companyName],
    [i.asOnLabel],
    [`Customer: ${i.partyName}`],
    [`Payment Term: ${i.paymentTerm}`],
    [`Total Outstanding: ${money(i.total)}`],
    [`Past Due: ${money(i.overdue ?? 0)}`],
    [],
    [i.columns[0], i.columns[1], i.columns[2], i.columns[3], i.columns[4]],
    ...i.bills.map((b) => [b.no, b.date, b.due, b.overdueDays, money(b.amount)]),
    ['TOTAL', '', '', '', money(i.total)],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 13 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Outstanding');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

/** Email-safe HTML body mirroring the statement (inline styles, tables). */
export const buildStatementHtml = (i: StatementInput): string => {
  const rows = i.bills.map((b, idx) => `
    <tr style="background:${idx % 2 ? '#f8fafc' : '#ffffff'}">
      <td style="padding:8px 10px;border-bottom:1px solid #eef2f7;font-size:13px;color:#0f172a">${esc(b.no)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eef2f7;font-size:13px;color:#475569">${esc(b.date)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eef2f7;font-size:13px;color:#475569">${esc(b.due)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eef2f7;font-size:13px;color:${b.level === 'bad' ? '#dc2626' : b.level === 'warn' ? '#d97706' : '#16a34a'};text-align:center">${esc(b.badge)}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #eef2f7;font-size:13px;color:#0f172a;text-align:right;font-weight:600">${rupee(b.amount)}</td>
    </tr>`).join('');

  const card = (label: string, value: string, color: string, bg: string, border: string) => `
    <td width="33%" style="padding:6px">
      <div style="border:1px solid ${border};background:${bg};border-radius:10px;padding:12px 14px">
        <div style="font-size:11px;letter-spacing:.04em;color:#64748b;text-transform:uppercase">${esc(label)}</div>
        <div style="font-size:18px;font-weight:700;color:${color};margin-top:4px">${esc(value)}</div>
      </div>
    </td>`;

  return `
  <div style="max-width:680px;margin:0 auto;font-family:'Poppins',Arial,Helvetica,sans-serif;color:#0f172a">
    <div style="background:#1e293b;border-radius:12px 12px 0 0;padding:20px 24px">
      <div style="font-size:20px;font-weight:700;color:#ffffff">${esc(i.companyName)}</div>
      <div style="font-size:13px;color:#cbd5e1;margin-top:2px">${esc(i.title)} &nbsp;•&nbsp; ${esc(i.asOnLabel)}</div>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:20px 24px">
      <p style="margin:0 0 4px;font-size:15px">Dear <strong>${esc(i.partyName)}</strong>,</p>
      <p style="margin:0 0 16px;font-size:13px;color:#475569">Please find below the outstanding summary as per our records.</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate"><tr>
        ${card('Payment Term', i.paymentTerm, '#0f172a', '#f8fafc', '#e5e7eb')}
        ${card(i.totalLabel, rupee(i.total), '#15803d', '#ecfdf3', '#a6f4c5')}
        ${card(i.overdueLabel ?? 'Past Due', rupee(i.overdue ?? 0), '#b45309', '#fffbeb', '#fde68a')}
      </tr></table>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:18px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <thead><tr style="background:#f1f5f9">
          <th style="padding:9px 10px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase">${esc(i.columns[0])}</th>
          <th style="padding:9px 10px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase">${esc(i.columns[1])}</th>
          <th style="padding:9px 10px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase">${esc(i.columns[2])}</th>
          <th style="padding:9px 10px;text-align:center;font-size:11px;color:#64748b;text-transform:uppercase">${esc(i.columns[3])}</th>
          <th style="padding:9px 10px;text-align:right;font-size:11px;color:#64748b;text-transform:uppercase">${esc(i.columns[4])}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="background:#f8fafc">
          <td colspan="4" style="padding:9px 10px;text-align:right;font-size:13px;font-weight:700;color:#0f172a">TOTAL</td>
          <td style="padding:9px 10px;text-align:right;font-size:14px;font-weight:700;color:#15803d">${rupee(i.total)}</td>
        </tr></tfoot>
      </table>
      ${i.extraCount && i.extraCount > 0 ? `<p style="margin:8px 0 0;font-size:11px;color:#94a3b8">…and ${i.extraCount} more bill(s) not shown here — see the attached Excel.</p>` : ''}
      <p style="margin:16px 0 4px;font-size:13px;color:#475569">${esc(i.closing1)}</p>
      <p style="margin:0 0 16px;font-size:13px;color:#475569">${esc(i.closing2)}</p>
      <div style="border-top:1px solid #e5e7eb;padding-top:12px">
        <div style="font-size:12px;font-weight:700;color:#15803d">${esc(i.teamLabel)}</div>
        <div style="font-size:12px;color:#475569">${esc(i.companyName)}</div>
        ${i.companyEmail ? `<div style="font-size:12px;color:#94a3b8">Email: <a href="mailto:${esc(i.companyEmail)}" style="color:#16a34a">${esc(i.companyEmail)}</a></div>` : ''}
        <div style="font-size:11px;color:#94a3b8;margin-top:4px">The statement image and Excel are attached. This is a system-generated email.</div>
      </div>
    </div>
  </div>`;
};

/** Blob → bare base64 (no data: prefix) for JSON transport. */
export const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(blob);
  });
