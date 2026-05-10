// Free WhatsApp share via wa.me click-to-chat URL. The recipient's WhatsApp
// opens with the message + document link prefilled — the user taps Send.

// Normalize "+91 98765-43210" or "00919876543210" → "919876543210"
const toWaPhone = (raw) => {
  if (!raw) return '';
  let s = String(raw).trim();
  if (s.startsWith('00')) s = '+' + s.slice(2);
  const hasPlus = s.startsWith('+');
  s = s.replace(/\D+/g, '');
  if (!hasPlus && s.length <= 10) return ''; // missing country code
  return s;
};

export const buildShareUrl = ({ phone, message, documentUrl }) => {
  const wa = toWaPhone(phone);
  if (!wa) return null;
  const text = documentUrl ? `${message}\n\n${documentUrl}` : message;
  return `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
};
