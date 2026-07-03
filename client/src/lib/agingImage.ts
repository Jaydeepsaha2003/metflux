// Render a party's aging as a shareable PNG — drawn directly on a canvas (no
// external libraries) so it uses the app's loaded web fonts:
//   • text    → Poppins (already linked in index.html)
//   • numbers → Calibri Bold where available (Windows), else Poppins Bold
// Canvas fillText honours document fonts once they're loaded, unlike an SVG
// rasterised via <img>, so we await the specific Poppins weights first.

const inr = (n: number) => 'Rs ' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

// Poppins for labels/headings; Calibri→Poppins bold for the figures.
const TXT = (px: number, weight = 400) => `${weight} ${px}px "Poppins", ui-sans-serif, sans-serif`;
const NUM = (px: number) => `700 ${px}px "Calibri", "Poppins", ui-sans-serif, sans-serif`;

export type AgingImageInput = {
  companyName: string;
  title: string;
  partyName: string;
  partySub?: string | null;
  dateLabel: string;
  buckets: { label: string; value: number }[];
  total: number;
  lines?: string[];
  footer?: string;
};

let fontsReady: Promise<void> | null = null;
const ensureFonts = () => {
  if (fontsReady) return fontsReady;
  fontsReady = (async () => {
    try {
      const f = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (!f) return;
      await Promise.all([
        f.load('400 14px Poppins'),
        f.load('500 14px Poppins'),
        f.load('600 18px Poppins'),
        f.load('700 22px Poppins'),
      ]);
      await f.ready;
    } catch { /* fall back to system fonts */ }
  })();
  return fontsReady;
};

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  const rr = (ctx as CanvasRenderingContext2D & { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect;
  if (typeof rr === 'function') rr.call(ctx, x, y, w, h, r);
  else ctx.rect(x, y, w, h);
};

export const makeAgingImageBlob = async (i: AgingImageInput): Promise<Blob> => {
  await ensureFonts();

  const scale = 2;
  const W = 700, P = 30;
  const lines = (i.lines ?? []).slice(0, 14);
  const headerH = 98;
  const partyH = 48;
  const rowH = 32;
  const bucketsH = i.buckets.length * rowH;
  const totalH = 58;
  const linesH = lines.length ? 30 + lines.length * 24 + 10 : 0;
  const footerH = 34;
  const H = headerH + partyH + bucketsH + totalH + linesH + footerH;

  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unsupported');
  ctx.scale(scale, scale);
  ctx.textBaseline = 'alphabetic';

  const rightText = (s: string, x: number, y: number) => { ctx.textAlign = 'right'; ctx.fillText(s, x, y); ctx.textAlign = 'left'; };

  // Background
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

  // Header band
  ctx.fillStyle = '#1e293b'; ctx.fillRect(0, 0, W, headerH);
  ctx.fillStyle = '#ffffff'; ctx.font = TXT(23, 700);
  ctx.fillText(i.companyName, P, 44);
  ctx.fillStyle = '#cbd5e1'; ctx.font = TXT(13, 500);
  ctx.fillText(i.title, P, 70);
  ctx.font = TXT(12.5, 400);
  rightText(i.dateLabel, W - P, 70);

  // Party
  let y = headerH + 32;
  ctx.fillStyle = '#0f172a'; ctx.font = TXT(17, 600);
  ctx.fillText(i.partyName, P, y);
  if (i.partySub) { ctx.fillStyle = '#64748b'; ctx.font = TXT(13, 400); rightText(i.partySub, W - P, y); }
  y += 18;
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(P, y); ctx.lineTo(W - P, y); ctx.stroke();

  // Buckets
  for (const b of i.buckets) {
    y += rowH;
    ctx.fillStyle = '#475569'; ctx.font = TXT(14, 500);
    ctx.fillText(b.label, P, y - 9);
    ctx.fillStyle = '#0f172a'; ctx.font = NUM(15);
    rightText(inr(b.value), W - P, y - 9);
    ctx.strokeStyle = '#f1f5f9';
    ctx.beginPath(); ctx.moveTo(P, y); ctx.lineTo(W - P, y); ctx.stroke();
  }

  // Total box
  y += 14;
  ctx.fillStyle = '#eef2ff'; roundRect(ctx, P, y, W - 2 * P, 40, 8); ctx.fill();
  ctx.fillStyle = '#3730a3'; ctx.font = TXT(14, 700);
  ctx.fillText('TOTAL OUTSTANDING', P + 16, y + 26);
  ctx.font = NUM(19);
  rightText(inr(i.total), W - P - 16, y + 27);
  y += 40;

  // Detail lines
  if (lines.length) {
    y += 26;
    ctx.fillStyle = '#94a3b8'; ctx.font = TXT(11.5, 600);
    ctx.fillText('DETAILS', P, y);
    for (const l of lines) {
      y += 24;
      ctx.fillStyle = '#334155'; ctx.font = TXT(12.5, 400);
      ctx.fillText(l, P, y);
    }
    y += 10;
  }

  // Footer
  if (i.footer) {
    ctx.fillStyle = '#94a3b8'; ctx.font = TXT(11, 400);
    ctx.fillText(i.footer, P, H - 14);
  }

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  );
};

/**
 * Share the PNG via the native share sheet (WhatsApp on mobile) WITH the message
 * as the caption. Falls back to a download on desktop / when file-share isn't
 * supported. Must be called from a click handler.
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
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  return 'downloaded';
};
