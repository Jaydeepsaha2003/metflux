// Render a party's aging as a shareable "statement" — drawn directly on a canvas
// so it uses the app's loaded web fonts (Poppins for text, Calibri Bold → Poppins
// Bold for figures). Dark card themed in the Metflux brand green. Exported as a
// PNG (WhatsApp / inline) or a PDF (email attachment).
import html2pdf from 'html2pdf.js';

const inr = (n: number) => '₹ ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TXT = (px: number, weight = 400) => `${weight} ${px}px "Poppins", ui-sans-serif, sans-serif`;
const NUM = (px: number) => `700 ${px}px "Calibri", "Poppins", ui-sans-serif, sans-serif`;

const C = {
  outer: '#0d0e11', card: '#1a1c20', border: 'rgba(255,255,255,0.07)',
  white: '#ffffff', sub: '#9aa0ab', body: '#b6bcc6', dim: '#6b7180',
  brand: '#32d583', brandDim: '#6ce9a6',
  brandBg: 'rgba(34,197,94,0.12)', brandBorder: 'rgba(34,197,94,0.38)',
  panel: 'rgba(255,255,255,0.035)', panelBorder: 'rgba(255,255,255,0.09)',
  rowBg: 'rgba(255,255,255,0.025)', headBg: 'rgba(255,255,255,0.05)',
};
const LEVEL: Record<string, { fg: string; bg: string }> = {
  ok:   { fg: '#4ade80', bg: 'rgba(34,197,94,0.16)' },
  warn: { fg: '#fbbf24', bg: 'rgba(245,158,11,0.16)' },
  bad:  { fg: '#f87171', bg: 'rgba(239,68,68,0.16)' },
};

export type StatementBill = {
  no: string; date: string; due: string;
  badge: string; level: 'ok' | 'warn' | 'bad';
  overdueDays: number;        // numeric age/overdue (for the Excel column)
  amount: number;
};
export type StatementInput = {
  companyName: string;
  companyEmail?: string | null;
  companyPhone?: string | null;
  title: string;              // "Outstanding Statement" / "Payable Statement"
  asOnLabel: string;          // "As on 29-Jun-2026"
  partyName: string;
  paymentTerm: string;        // "Advance" / "30 Days" / "As agreed"
  totalLabel: string;         // "TOTAL OUTSTANDING"
  total: number;
  overdue?: number;           // amount past the payment term (shown as "Past Due")
  overdueLabel?: string;      // "PAST DUE"
  columns: [string, string, string, string, string];
  bills: StatementBill[];
  closing1: string;
  closing2: string;
  teamLabel: string;          // "Accounts Receivable Team"
  extraCount?: number;        // "…and N more" note
};

let fontsReady: Promise<void> | null = null;
const ensureFonts = () => {
  if (fontsReady) return fontsReady;
  fontsReady = (async () => {
    try {
      const f = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (!f) return;
      await Promise.all(['400 14px Poppins', '500 13px Poppins', '600 16px Poppins', '700 22px Poppins'].map((s) => f.load(s)));
      await f.ready;
    } catch { /* fall back to system fonts */ }
  })();
  return fontsReady;
};

const rr = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  const fn = (ctx as CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect;
  if (typeof fn === 'function') fn.call(ctx, x, y, w, h, r);
  else ctx.rect(x, y, w, h);
};

const renderStatementCanvas = async (i: StatementInput, maxRows = i.bills.length): Promise<HTMLCanvasElement> => {
  await ensureFonts();

  const scale = 2, W = 760, frame = 14, pad = 30;
  const innerX = frame + pad, innerW = W - 2 * innerX;
  const bills = i.bills.slice(0, maxRows);
  const n = bills.length;
  const extra = i.bills.length - n;

  const HDR = 60, INTRO = 66, CARDS = 112, SECT = 34, THEAD = 34, ROW = 40, TGAP = 16, CLOSE = 82, FOOT = 104;
  const H = frame + pad + HDR + INTRO + CARDS + SECT + THEAD + n * ROW + TGAP + CLOSE + FOOT + pad;

  const canvas = document.createElement('canvas');
  canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unsupported');
  ctx.scale(scale, scale);
  ctx.textBaseline = 'alphabetic';
  const right = (s: string, x: number, y: number) => { ctx.textAlign = 'right'; ctx.fillText(s, x, y); ctx.textAlign = 'left'; };
  const center = (s: string, x: number, y: number) => { ctx.textAlign = 'center'; ctx.fillText(s, x, y); ctx.textAlign = 'left'; };

  // Frame + card
  ctx.fillStyle = C.outer; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.card; rr(ctx, frame, frame, W - 2 * frame, H - 2 * frame, 16); ctx.fill();
  ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.stroke();

  let y = frame + pad;

  // Header
  ctx.fillStyle = C.white; ctx.font = TXT(22, 700); ctx.fillText(i.companyName, innerX, y + 24);
  ctx.fillStyle = C.sub; ctx.font = TXT(12.5, 400); ctx.fillText(`${i.title}  •  ${i.asOnLabel}`, innerX, y + 46);
  y += HDR;

  // Intro
  ctx.font = TXT(14.5, 400); ctx.fillStyle = C.body;
  ctx.fillText('Dear ', innerX, y + 20);
  const dearW = ctx.measureText('Dear ').width;
  ctx.font = TXT(14.5, 600); ctx.fillStyle = C.white;
  ctx.fillText(i.partyName, innerX + dearW, y + 20);
  const nameW = ctx.measureText(i.partyName).width;
  ctx.font = TXT(14.5, 400); ctx.fillStyle = C.body;
  ctx.fillText(',', innerX + dearW + nameW, y + 20);
  ctx.font = TXT(13, 400); ctx.fillStyle = C.body;
  ctx.fillText('Please find below the outstanding summary as per our records.', innerX, y + 44);
  y += INTRO;

  // Cards — Payment Term | Total Outstanding | Past Due
  const cardH = 82, gap = 14, cardW = (innerW - 2 * gap) / 3;
  const x0 = innerX, x1 = innerX + cardW + gap, x2 = innerX + 2 * (cardW + gap);
  // Payment term
  ctx.fillStyle = C.panel; rr(ctx, x0, y, cardW, cardH, 12); ctx.fill();
  ctx.strokeStyle = C.panelBorder; ctx.stroke();
  ctx.fillStyle = C.sub; ctx.font = TXT(10.5, 600); ctx.fillText('PAYMENT TERM', x0 + 16, y + 28);
  ctx.fillStyle = C.white; ctx.font = TXT(15, 600); ctx.fillText(i.paymentTerm, x0 + 16, y + 56);
  // Total (brand)
  ctx.fillStyle = C.brandBg; rr(ctx, x1, y, cardW, cardH, 12); ctx.fill();
  ctx.strokeStyle = C.brandBorder; ctx.stroke();
  ctx.fillStyle = C.brandDim; ctx.font = TXT(10.5, 600); ctx.fillText(i.totalLabel, x1 + 16, y + 28);
  ctx.fillStyle = C.brand; ctx.font = NUM(20); ctx.fillText(inr(i.total), x1 + 16, y + 58);
  // Due (same green theme, neutral card + green figure)
  const overdue = i.overdue ?? 0;
  ctx.fillStyle = C.panel; rr(ctx, x2, y, cardW, cardH, 12); ctx.fill();
  ctx.strokeStyle = C.panelBorder; ctx.stroke();
  ctx.fillStyle = C.sub; ctx.font = TXT(10.5, 600); ctx.fillText(i.overdueLabel ?? 'DUE', x2 + 16, y + 28);
  ctx.fillStyle = C.brand; ctx.font = NUM(20); ctx.fillText(inr(overdue), x2 + 16, y + 58);
  y += CARDS;

  // Section title
  ctx.fillStyle = C.white; ctx.font = TXT(14.5, 600);
  ctx.fillText('Bill-wise Outstanding', innerX, y + 20);
  y += SECT;

  // Column geometry
  const c0 = innerX, c1 = innerX + innerW * 0.30, c2 = innerX + innerW * 0.50;
  const badgeCX = innerX + innerW * 0.72, amountRX = innerX + innerW;

  // Table header
  ctx.fillStyle = C.headBg; rr(ctx, innerX, y, innerW, 30, 8); ctx.fill();
  ctx.fillStyle = C.sub; ctx.font = TXT(11, 600);
  ctx.fillText(i.columns[0], c0 + 12, y + 20);
  ctx.fillText(i.columns[1], c1, y + 20);
  ctx.fillText(i.columns[2], c2, y + 20);
  center(i.columns[3], badgeCX, y + 20);
  right(i.columns[4], amountRX - 12, y + 20);
  y += THEAD;

  // Rows
  for (const b of bills) {
    const midY = y + ROW / 2 + 4;
    ctx.fillStyle = C.rowBg; rr(ctx, innerX, y + 3, innerW, ROW - 6, 8); ctx.fill();
    ctx.fillStyle = '#e5e7eb'; ctx.font = TXT(12.5, 500); ctx.fillText(b.no, c0 + 12, midY);
    ctx.fillStyle = C.body; ctx.font = TXT(12.5, 400);
    ctx.fillText(b.date, c1, midY);
    ctx.fillText(b.due, c2, midY);
    // badge
    const lv = LEVEL[b.level] ?? LEVEL.ok;
    ctx.font = TXT(11.5, 600);
    const bw = ctx.measureText(b.badge).width + 22;
    ctx.fillStyle = lv.bg; rr(ctx, badgeCX - bw / 2, midY - 15, bw, 22, 11); ctx.fill();
    ctx.fillStyle = lv.fg; center(b.badge, badgeCX, midY - 0.5);
    // amount
    ctx.fillStyle = C.brand; ctx.font = NUM(13.5); right(inr(b.amount), amountRX - 12, midY);
    y += ROW;
  }
  y += TGAP;

  // Closing
  ctx.fillStyle = C.body; ctx.font = TXT(12.5, 400);
  if (extra > 0) { ctx.fillStyle = C.dim; ctx.font = TXT(11.5, 400); ctx.fillText(`…and ${extra} more bill(s) — see the attached PDF / Excel.`, innerX, y - 2); }
  ctx.fillStyle = C.body; ctx.font = TXT(12.5, 400);
  ctx.fillText(i.closing1, innerX, y + 24);
  ctx.fillText(i.closing2, innerX, y + 50);
  y += CLOSE;

  // Footer
  ctx.strokeStyle = C.border; ctx.beginPath(); ctx.moveTo(innerX, y + 6); ctx.lineTo(innerX + innerW, y + 6); ctx.stroke();
  ctx.fillStyle = C.brandDim; ctx.font = TXT(12, 600); ctx.fillText(i.teamLabel, innerX, y + 30);
  ctx.fillStyle = C.body; ctx.font = TXT(12, 400); ctx.fillText(i.companyName, innerX, y + 50);
  const contact = [i.companyEmail, i.companyPhone].filter(Boolean).join('   ·   ');
  if (contact) {
    ctx.fillStyle = C.dim; ctx.font = TXT(11.5, 400); ctx.fillText('Email: ', innerX, y + 70);
    const ew = ctx.measureText('Email: ').width;
    ctx.fillStyle = C.brandDim; ctx.fillText(contact, innerX + ew, y + 70);
  }
  ctx.fillStyle = C.dim; ctx.font = TXT(11, 400);
  ctx.fillText('This is a system-generated statement.', innerX, y + 90);

  return canvas;
};

export const makeStatementImageBlob = async (i: StatementInput): Promise<Blob> => {
  // WhatsApp PNG stays bounded to 10 rows (a tall image is impractical);
  // the PDF (below) renders every bill.
  const canvas = await renderStatementCanvas(i, 10);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  );
};

/** The statement as a single-page PDF (the rendered card, fit to the page).
 *  Uses html2pdf (bundles jsPDF) — jspdf isn't importable on its own here. */
export const makeStatementPdfBlob = async (i: StatementInput): Promise<Blob> => {
  const canvas = await renderStatementCanvas(i);
  const dataUrl = canvas.toDataURL('image/png');
  const W = 720;
  const H = Math.round((W * canvas.height) / canvas.width);

  const wrap = document.createElement('div');
  wrap.style.width = `${W}px`;
  wrap.style.background = '#0d0e11';
  const img = document.createElement('img');
  img.src = dataUrl;
  img.style.width = '100%';
  img.style.display = 'block';
  wrap.appendChild(img);

  const offscreen = document.createElement('div');
  offscreen.style.position = 'fixed';
  offscreen.style.left = '-10000px';
  offscreen.style.top = '0';
  offscreen.appendChild(wrap);
  document.body.appendChild(offscreen);

  try {
    await new Promise<void>((res) => { if (img.complete) res(); else img.onload = () => res(); });
    const worker = html2pdf().set({
      margin: 0,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, backgroundColor: '#0d0e11', windowWidth: W },
      jsPDF: { unit: 'px', format: [W, H], orientation: 'portrait' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).from(wrap);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await (worker as any).output('blob')) as Blob;
  } finally {
    document.body.removeChild(offscreen);
  }
};

/**
 * Share the PNG via the native share sheet (WhatsApp on mobile) WITH the message
 * caption. Falls back to a download on desktop. Must run from a click handler.
 */
export const shareOrDownloadImage = async (
  blob: Blob, filename: string, message?: string,
): Promise<'shared' | 'cancelled' | 'downloaded'> => {
  const file = new File([blob], `${filename}.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], text: message ?? '' });
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  return 'downloaded';
};
