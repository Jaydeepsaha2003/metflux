// E-mailable artifacts for an outstanding statement: the Excel export and the
// HTML email body. Shares the StatementInput shape with agingImage.ts (which
// renders the PNG + the full-detail PDF).
import * as XLSX from 'xlsx';
import type { StatementInput } from '@/lib/agingImage';

const money = (n: number) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rupee = (n: number) => '₹ ' + money(n);
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** Excel (.xlsx) statement — every bill, same shape as the sample export. */
export const buildStatementXlsxBlob = (i: StatementInput): Blob => {
  const dueLabel = titleCase(i.overdueLabel ?? 'Due');
  const aoa: (string | number)[][] = [
    ['CUSTOMER OUTSTANDING STATEMENT'],
    [i.companyName],
    [i.asOnLabel],
    [`Customer: ${i.partyName}`],
    [`Payment Term: ${i.paymentTerm}`],
    [`Total Outstanding: ${money(i.total)}`],
    [`${dueLabel}: ${money(i.overdue ?? 0)}`],
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

/** Responsive email body — summary only (Total / Due / Payment Term), closing
 *  and footer. The full bill list travels as the PDF + Excel attachments. One
 *  colour theme (brand green + slate). */
export const buildStatementHtml = (i: StatementInput): string => {
  const tile = (label: string, value: string, green = false) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin-bottom:10px">
        <tr><td style="background:#f3faf6;border:1px solid #d6f2e2;border-radius:10px;padding:13px 16px">
          <div style="font-size:11px;letter-spacing:.05em;color:#15803d;text-transform:uppercase">${esc(label)}</div>
          <div style="font-size:20px;font-weight:600;color:${green ? '#15803d' : '#0f172a'};margin-top:3px">${esc(value)}</div>
        </td></tr>
      </table>`;

  const contact = [
    i.companyEmail ? `Email: <a href="mailto:${esc(i.companyEmail)}" style="color:#16a34a;text-decoration:none">${esc(i.companyEmail)}</a>` : '',
    i.companyPhone ? esc(i.companyPhone) : '',
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${esc(i.title)}</title>
<style>
  body{margin:0;padding:0;background:#eef1f5;-webkit-text-size-adjust:100%;}
  .container{max-width:600px;margin:0 auto;}
  @media only screen and (max-width:600px){ .wrap{padding:18px !important;} .head{padding:18px !important;} }
</style>
</head>
<body>
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">Outstanding statement for ${esc(i.partyName)} — ${rupee(i.total)}.</div>
  <div class="container" style="font-family:'Poppins',Arial,Helvetica,sans-serif;color:#0f172a;padding:16px 12px">
    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
      <div style="height:5px;background:#16a34a"></div>
      <div class="head" style="padding:22px 24px 6px">
        <div style="font-size:11px;letter-spacing:.12em;color:#16a34a;font-weight:600">OUTSTANDING STATEMENT</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px"><tr>
          <td style="font-size:20px;font-weight:600;color:#0f172a">${esc(i.companyName)}</td>
          <td style="text-align:right;font-size:12px;color:#64748b;white-space:nowrap;vertical-align:top">${esc(i.asOnLabel)}</td>
        </tr></table>
      </div>
      <div class="wrap" style="padding:14px 24px 22px">
        <p style="margin:0 0 4px;font-size:15px">Dear <strong>${esc(i.partyName)}</strong>,</p>
        <p style="margin:0 0 18px;font-size:13px;color:#475569;line-height:1.6">Please find below a summary of the amounts outstanding against your account as per our records.</p>

        ${tile(i.totalLabel, rupee(i.total), true)}
        ${tile(i.overdueLabel ?? 'Due', rupee(i.overdue ?? 0), true)}
        ${tile('Payment Term', i.paymentTerm, false)}

        <p style="margin:18px 0 4px;font-size:13px;color:#475569;line-height:1.6">${esc(i.closing1)}</p>
        <p style="margin:0;font-size:13px;color:#475569;line-height:1.6">${esc(i.closing2)}</p>
      </div>
      <div style="background:#f6fdf9;border-top:1px solid #d6f2e2;padding:16px 24px">
        <div style="font-size:13px;color:#15803d;font-weight:600">${esc(i.teamLabel)}</div>
        <div style="font-size:13px;color:#0f172a;margin-top:2px">${esc(i.companyName)}</div>
        ${contact ? `<div style="font-size:12px;color:#64748b;margin-top:3px">${contact}</div>` : ''}
        <div style="font-size:11px;color:#94a3b8;margin-top:8px">The full statement is attached as a PDF and an Excel file. This is a system-generated email — please do not reply directly.</div>
      </div>
    </div>
  </div>
</body></html>`;
};

/** Blob → bare base64 (no data: prefix) for JSON transport. */
export const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)); };
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(blob);
  });
