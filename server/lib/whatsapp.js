// Free WhatsApp share via wa.me click-to-chat URL. The recipient's WhatsApp
// opens with the message + document link prefilled — the user taps Send.

// Normalize "+91 98765-43210" / "00919876543210" / "9876543210" → "919876543210".
// Bare 10-digit numbers (and "0xxxxxxxxxx") are assumed Indian and get +91.
const toWaPhone = (raw) => {
  if (!raw) return '';
  let s = String(raw).trim();
  if (s.startsWith('00')) s = '+' + s.slice(2);
  const hasPlus = s.startsWith('+');
  let digits = s.replace(/\D+/g, '');
  if (!digits) return '';
  if (hasPlus) return digits;
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1); // strip trunk 0
  if (digits.length === 10) return '91' + digits; // bare Indian mobile
  if (digits.length < 10) return '';
  return digits;
};

export const buildShareUrl = ({ phone, message, documentUrl }) => {
  const wa = toWaPhone(phone);
  if (!wa) return null;
  const text = documentUrl ? `${message}\n\n${documentUrl}` : message;
  return `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
};
