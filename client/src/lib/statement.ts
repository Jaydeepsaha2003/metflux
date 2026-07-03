// Build the e-mailable artifacts for an outstanding statement: an Excel file
// (matching the sample export) and an HTML email body. Shares the StatementInput
// shape with the PNG renderer in agingImage.ts.
import * as XLSX from 'xlsx';
import { api } from '@/lib/api';
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

/** Responsive, email-safe HTML body mirroring the statement. Full document with a
 *  viewport meta + media queries so it reads well on phones: cards stack, the
 *  date columns collapse, and padding tightens on narrow screens. */
export const buildStatementHtml = (i: StatementInput, imageUrl?: string): string => {
  const rows = i.bills.map((b, idx) => `
    <tr style="background:${idx % 2 ? '#f8fafc' : '#ffffff'}">
      <td class="cell" style="padding:9px 10px;border-bottom:1px solid #eef2f7;font-size:13px;color:#0f172a">${esc(b.no)}</td>
      <td class="cell hide-sm" style="padding:9px 10px;border-bottom:1px solid #eef2f7;font-size:13px;color:#475569">${esc(b.date)}</td>
      <td class="cell hide-sm" style="padding:9px 10px;border-bottom:1px solid #eef2f7;font-size:13px;color:#475569">${esc(b.due)}</td>
      <td class="cell" style="padding:9px 10px;border-bottom:1px solid #eef2f7;font-size:13px;color:${b.level === 'bad' ? '#dc2626' : b.level === 'warn' ? '#d97706' : '#16a34a'};text-align:center;white-space:nowrap">${esc(b.badge)}</td>
      <td class="cell" style="padding:9px 10px;border-bottom:1px solid #eef2f7;font-size:13px;color:#0f172a;text-align:right;font-weight:600;white-space:nowrap">${rupee(b.amount)}</td>
    </tr>`).join('');

  // Each stat is a full-width row inside its own single-cell table so it stacks
  // natively on every client (no fragile multi-column email layout).
  const stat = (label: string, value: string, color: string, bg: string, border: string) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin-bottom:8px">
      <tr><td style="border:1px solid ${border};background:${bg};border-radius:10px;padding:12px 16px">
        <span style="font-size:11px;letter-spacing:.04em;color:#64748b;text-transform:uppercase">${esc(label)}</span>
        <div style="font-size:19px;font-weight:700;color:${color};margin-top:3px">${esc(value)}</div>
      </td></tr>
    </table>`;

  const detailBlock = `
      ${stat('Payment Term', i.paymentTerm, '#0f172a', '#f8fafc', '#e5e7eb')}
      ${stat(i.totalLabel, rupee(i.total), '#15803d', '#ecfdf3', '#a6f4c5')}
      ${stat(i.overdueLabel ?? 'Past Due', rupee(i.overdue ?? 0), '#b45309', '#fffbeb', '#fde68a')}

      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:14px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <thead><tr style="background:#f1f5f9">
          <th class="cell" style="padding:9px 10px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase">${esc(i.columns[0])}</th>
          <th class="cell hide-sm" style="padding:9px 10px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase">${esc(i.columns[1])}</th>
          <th class="cell hide-sm" style="padding:9px 10px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase">${esc(i.columns[2])}</th>
          <th class="cell" style="padding:9px 10px;text-align:center;font-size:11px;color:#64748b;text-transform:uppercase">${esc(i.columns[3])}</th>
          <th class="cell" style="padding:9px 10px;text-align:right;font-size:11px;color:#64748b;text-transform:uppercase">${esc(i.columns[4])}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="background:#f8fafc">
          <td class="cell" style="padding:9px 10px;text-align:right;font-size:13px;font-weight:700;color:#0f172a">TOTAL</td>
          <td class="cell hide-sm"></td><td class="cell hide-sm"></td><td class="cell"></td>
          <td class="cell" style="padding:9px 10px;text-align:right;font-size:14px;font-weight:700;color:#15803d;white-space:nowrap">${rupee(i.total)}</td>
        </tr></tfoot>
      </table>
      ${i.extraCount && i.extraCount > 0 ? `<p style="margin:8px 0 0;font-size:11px;color:#94a3b8">…and ${i.extraCount} more bill(s) not shown here — see the attached Excel.</p>` : ''}`;

  // When we have a hosted image, the statement PNG *is* the body (with a short
  // text summary above it for accessibility / when images are blocked).
  const imageBlock = `
      <p style="margin:0 0 14px;font-size:13px;color:#334155">
        <strong>${esc(i.totalLabel)}:</strong> ${rupee(i.total)} &nbsp;•&nbsp;
        <strong>${esc(i.overdueLabel ?? 'Past Due')}:</strong> ${rupee(i.overdue ?? 0)} &nbsp;•&nbsp;
        <strong>Payment Term:</strong> ${esc(i.paymentTerm)}
      </p>
      <img src="${esc(imageUrl ?? '')}" alt="Outstanding statement" width="100%" style="display:block;width:100%;max-width:100%;height:auto;border:1px solid #e5e7eb;border-radius:10px" />`;

  const middle = imageUrl ? imageBlock : detailBlock;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${esc(i.title)}</title>
<style>
  body{margin:0;padding:0;background:#eef1f5;-webkit-text-size-adjust:100%;}
  .container{max-width:640px;margin:0 auto;}
  @media only screen and (max-width:600px){
    .wrap{padding:16px !important;}
    .head{padding:18px 16px !important;}
    .hide-sm{display:none !important;}
    .cell{padding:9px 8px !important;}
    .h-name{font-size:18px !important;}
  }
</style>
</head>
<body>
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">Outstanding statement for ${esc(i.partyName)} — ${rupee(i.total)}.</div>
  <div class="container" style="font-family:'Poppins',Arial,Helvetica,sans-serif;color:#0f172a;padding:16px 12px">
    <div class="head" style="background:#1e293b;border-radius:12px 12px 0 0;padding:20px 24px">
      <div class="h-name" style="font-size:20px;font-weight:700;color:#ffffff">${esc(i.companyName)}</div>
      <div style="font-size:13px;color:#cbd5e1;margin-top:2px">${esc(i.title)} &nbsp;•&nbsp; ${esc(i.asOnLabel)}</div>
    </div>
    <div class="wrap" style="background:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:22px 24px">
      <p style="margin:0 0 4px;font-size:15px">Dear <strong>${esc(i.partyName)}</strong>,</p>
      <p style="margin:0 0 16px;font-size:13px;color:#475569">Please find below the outstanding summary as per our records.</p>

      ${middle}

      <p style="margin:16px 0 4px;font-size:13px;color:#475569">${esc(i.closing1)}</p>
      <p style="margin:0 0 16px;font-size:13px;color:#475569">${esc(i.closing2)}</p>
      <div style="border-top:1px solid #e5e7eb;padding-top:12px">
        <div style="font-size:12px;font-weight:700;color:#15803d">${esc(i.teamLabel)}</div>
        <div style="font-size:12px;color:#475569">${esc(i.companyName)}</div>
        ${i.companyEmail ? `<div style="font-size:12px;color:#94a3b8">Email: <a href="mailto:${esc(i.companyEmail)}" style="color:#16a34a">${esc(i.companyEmail)}</a></div>` : ''}
        <div style="font-size:11px;color:#94a3b8;margin-top:6px">The statement image and Excel are attached. This is a system-generated email.</div>
      </div>
    </div>
  </div>
</body></html>`;
};

/** Upload a PNG and get back a public URL (7-day) to embed in the email body. */
export const uploadStatementImage = async (blob: Blob, filename: string): Promise<string> => {
  const fd = new FormData();
  fd.append('file', new File([blob], `${filename}.png`, { type: 'image/png' }));
  const res = await api<{ url: string }>('/share/image', { method: 'POST', body: fd });
  return res.url;
};

/** Blob → bare base64 (no data: prefix) for JSON transport. */
export const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(blob);
  });
