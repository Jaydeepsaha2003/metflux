// Session metadata helpers for the User Logs feature: client IP, a friendly
// device label from the user-agent, and a best-effort IP → location lookup.

/** Real client IP, honouring Hostinger's proxy headers (trust proxy is on). */
export const clientIp = (req) => {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '') || null;
};

/** "Chrome on Windows", "Safari on iPhone" — enough to recognise a device. */
export const parseDevice = (ua) => {
  if (!ua) return null;
  const s = String(ua);
  let browser =
    /Edg\//.test(s) ? 'Edge' :
    /OPR\/|Opera/.test(s) ? 'Opera' :
    /Chrome\//.test(s) && !/Chromium/.test(s) ? 'Chrome' :
    /Firefox\//.test(s) ? 'Firefox' :
    /Safari\//.test(s) && /Version\//.test(s) ? 'Safari' :
    'Browser';
  let os =
    /Windows NT/.test(s) ? 'Windows' :
    /iPhone|iPad|iPod/.test(s) ? 'iOS' :
    /Android/.test(s) ? 'Android' :
    /Mac OS X/.test(s) ? 'macOS' :
    /Linux/.test(s) ? 'Linux' :
    '';
  return os ? `${browser} on ${os}` : browser;
};

const isPrivateIp = (ip) =>
  !ip || ip === '127.0.0.1' || ip === '::1' || /^10\./.test(ip) ||
  /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

/** Best-effort "City, Country" from an IP. Returns null on any failure / private
 *  IP. Never throws — callers use it fire-and-forget so it can't slow login. */
export const geoLookup = async (ip) => {
  if (isPrivateIp(ip)) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,city,regionName,country`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    if (j.status !== 'success') return null;
    return [j.city, j.regionName, j.country].filter(Boolean).join(', ').slice(0, 160) || null;
  } catch {
    return null;
  }
};
