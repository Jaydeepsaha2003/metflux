// Free WhatsApp sharing with optional PDF attachment.
//
// wa.me URLs cannot carry files — only pre-filled text. So:
//  1. If the browser supports navigator.share with files (modern mobile),
//     hand the PDF off to the native share sheet and let the user pick
//     WhatsApp. The PDF attaches as a real document.
//  2. Otherwise (desktop, older browsers), upload the PDF to our server,
//     get back a public URL, and embed it in the wa.me text. The recipient
//     taps the link, opens the PDF in their browser.
//
// The recipient phone is picked from the company setting:
//   - COMPANY  → company.whatsappNumber
//   - CUSTOMER → customerPhone (if present, else fall back to PROMPT)
//   - PROMPT   → no recipient — WhatsApp opens its contact picker
import { api } from '@/lib/api';

export type ShareTarget = 'PROMPT' | 'CUSTOMER' | 'COMPANY';

type ShareArgs = {
  /** Plain-text message body sent to WhatsApp. */
  message: string;
  /** Company-wide setting; if undefined we default to PROMPT. */
  target?: ShareTarget;
  /** Company WhatsApp number — used when target = COMPANY. */
  companyPhone?: string | null;
  /** Customer phone for this document — used when target = CUSTOMER. */
  customerPhone?: string | null;
  /** Optional PDF to attach. */
  pdf?: { blob: Blob; filename: string };
};

// Normalise "+91 98765-43210" / "00919876543210" / "9876543210" → "919876543210".
// Bare 10-digit numbers (and "0xxxxxxxxxx") are assumed Indian and get +91, since
// customer records routinely store mobiles without a country code.
export const normalisePhone = (raw: string | null | undefined): string => {
  if (!raw) return '';
  let s = String(raw).trim();
  if (s.startsWith('00')) s = '+' + s.slice(2);
  const hasPlus = s.startsWith('+');
  let digits = s.replace(/\D+/g, '');
  if (!digits) return '';
  if (hasPlus) return digits;                                  // already has country code
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1); // strip trunk 0
  if (digits.length === 10) return '91' + digits;              // bare Indian mobile
  if (digits.length < 10) return '';                           // too short to be valid
  return digits;                                               // 11+ digits — assume it has a country code
};

const resolveRecipient = (args: ShareArgs): string => {
  switch (args.target) {
    case 'COMPANY':  return normalisePhone(args.companyPhone);
    case 'CUSTOMER': return normalisePhone(args.customerPhone);
    case 'PROMPT':
    default:         return '';
  }
};

const buildWaUrl = (phone: string, text: string) =>
  phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;

// Web Share with files is gated by capability + a user-gesture context.
const canShareFile = (file: File): boolean => {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    return nav.canShare({ files: [file] });
  } catch {
    return false;
  }
};

const uploadPdf = async (blob: Blob, filename: string): Promise<string> => {
  const fd = new FormData();
  fd.append('file', new File([blob], `${filename}.pdf`, { type: 'application/pdf' }));
  const res = await api<{ url: string; expiresAt: string }>('/share/pdf', {
    method: 'POST',
    body: fd,
  });
  return res.url;
};

/**
 * Share via WhatsApp. Caller must invoke this from a user gesture
 * (click handler) — both navigator.share and window.open require one.
 *
 * Returns:
 *   - 'web-share'  → native share sheet handled it (PDF attached)
 *   - 'wa-link'    → opened wa.me in a new tab (text-only or text + PDF link)
 */
export const shareViaWhatsApp = async (args: ShareArgs): Promise<'web-share' | 'wa-link'> => {
  const recipient = resolveRecipient(args);

  // Mobile path — attach the PDF natively. We skip Web Share when we have a
  // resolved recipient because the native sheet ignores phone numbers; using
  // it there would silently strip the targeting the user configured.
  if (args.pdf && !recipient) {
    const file = new File([args.pdf.blob], `${args.pdf.filename}.pdf`, { type: 'application/pdf' });
    if (canShareFile(file)) {
      try {
        await navigator.share({ files: [file], text: args.message, title: args.pdf.filename });
        return 'web-share';
      } catch (err) {
        // User cancelled — fall through to link approach.
        if ((err as Error)?.name !== 'AbortError') throw err;
      }
    }
  }

  // Desktop / fallback path — upload PDF, embed URL in the message.
  let text = args.message;
  if (args.pdf) {
    const url = await uploadPdf(args.pdf.blob, args.pdf.filename);
    text = `${args.message}\n\n${url}`;
  }
  window.open(buildWaUrl(recipient, text), '_blank', 'noopener,noreferrer');
  return 'wa-link';
};
