// Render a party's aging as a shareable PNG — no external libraries. We build a
// self-contained SVG (pure text/rect, so the canvas stays untainted) and rasterise
// it to a PNG blob, then hand it to the native share sheet (WhatsApp on mobile)
// or download it (desktop fallback).

const inr = (n: number) => 'Rs ' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export type AgingImageInput = {
  companyName: string;
  title: string;               // "Account Statement" / "Outstanding Payable"
  partyName: string;
  partySub?: string | null;    // code / phone
  dateLabel: string;           // "As on 03 Jul 2026"
  buckets: { label: string; value: number }[];
  total: number;
  lines?: string[];            // optional detail rows (invoices/bills)
  footer?: string;
};

const buildSvg = (i: AgingImageInput): { svg: string; width: number; height: number } => {
  const W = 680, P = 28;
  const lines = (i.lines ?? []).slice(0, 14);
  const headerH = 92;
  const partyH = 52;
  const bucketRowH = 30;
  const bucketsH = i.buckets.length * bucketRowH + 46; // + total row
  const linesH = lines.length ? 24 + lines.length * 22 + 12 : 0;
  const footerH = i.footer ? 34 : 16;
  const H = headerH + partyH + bucketsH + linesH + footerH;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  // Header band
  parts.push(`<rect width="${W}" height="${headerH}" fill="#1e293b"/>`);
  parts.push(`<text x="${P}" y="40" fill="#ffffff" font-size="22" font-weight="bold">${esc(i.companyName)}</text>`);
  parts.push(`<text x="${P}" y="68" fill="#cbd5e1" font-size="14">${esc(i.title)}</text>`);
  parts.push(`<text x="${W - P}" y="68" fill="#cbd5e1" font-size="13" text-anchor="end">${esc(i.dateLabel)}</text>`);

  // Party
  let y = headerH + 30;
  parts.push(`<text x="${P}" y="${y}" fill="#0f172a" font-size="17" font-weight="bold">${esc(i.partyName)}</text>`);
  if (i.partySub) parts.push(`<text x="${W - P}" y="${y}" fill="#64748b" font-size="13" text-anchor="end">${esc(i.partySub)}</text>`);
  y += 24;

  // Buckets
  parts.push(`<line x1="${P}" y1="${y}" x2="${W - P}" y2="${y}" stroke="#e2e8f0"/>`);
  y += 8;
  for (const b of i.buckets) {
    y += bucketRowH - 8;
    parts.push(`<text x="${P}" y="${y}" fill="#475569" font-size="14">${esc(b.label)}</text>`);
    parts.push(`<text x="${W - P}" y="${y}" fill="#0f172a" font-size="14" text-anchor="end">${esc(inr(b.value))}</text>`);
    y += 8;
  }
  // Total row
  parts.push(`<rect x="${P}" y="${y}" width="${W - 2 * P}" height="36" rx="6" fill="#eef2ff"/>`);
  y += 24;
  parts.push(`<text x="${P + 14}" y="${y}" fill="#3730a3" font-size="15" font-weight="bold">TOTAL OUTSTANDING</text>`);
  parts.push(`<text x="${W - P - 14}" y="${y}" fill="#3730a3" font-size="17" font-weight="bold" text-anchor="end">${esc(inr(i.total))}</text>`);
  y += 24;

  // Detail lines
  if (lines.length) {
    y += 18;
    parts.push(`<text x="${P}" y="${y}" fill="#64748b" font-size="12" font-weight="bold">DETAILS</text>`);
    y += 4;
    for (const l of lines) {
      y += 22;
      parts.push(`<text x="${P}" y="${y}" fill="#334155" font-size="12">${esc(l)}</text>`);
    }
    y += 12;
  }

  if (i.footer) {
    parts.push(`<text x="${P}" y="${H - 12}" fill="#94a3b8" font-size="11">${esc(i.footer)}</text>`);
  }
  parts.push('</svg>');
  return { svg: parts.join(''), width: W, height: H };
};

const svgToPngBlob = (svg: string, width: number, height: number, scale = 2): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('canvas unsupported'));
      ctx.scale(scale, scale);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    };
    img.onerror = () => reject(new Error('SVG render failed'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });

export const makeAgingImageBlob = async (input: AgingImageInput): Promise<Blob> => {
  const { svg, width, height } = buildSvg(input);
  return svgToPngBlob(svg, width, height);
};

/**
 * Share the PNG via the native share sheet (WhatsApp on mobile). Falls back to a
 * download on desktop / when file-share isn't supported. Must be called from a
 * click handler. Returns what happened.
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
