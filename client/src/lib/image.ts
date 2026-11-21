/** Re-encode any browser-readable image (WebP, SVG, ...) as a PNG, no larger than
 *  `maxSide` on its longest edge. PDF libraries embed only PNG and JPEG, and a
 *  full-size upload would be several times the server's 2 MB limit.
 *
 *  The file is read as a data: URL, not a blob: one. The live server's default
 *  content-security policy allows images from 'self' and data: only, so a blob: URL
 *  is refused and the failure looks like an unreadable image. */
export const toPngFile = (file: File, maxSide = 1600): Promise<File> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error('Could not read the file'));
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((img.naturalWidth || maxSide) * scale));
      canvas.height = Math.max(1, Math.round((img.naturalHeight || maxSide) * scale));
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(new File([blob], 'watermark.png', { type: 'image/png' })) : reject(new Error('Could not process the image'))),
        'image/png',
      );
    };
    img.onerror = () => reject(new Error('That file is not an image this browser can read'));
    img.src = String(reader.result);
  };
  reader.readAsDataURL(file);
});

/** A data: URL image (the stored logo, in any format the browser reads) as a PNG data URL
 *  plus its pixel size, longest side capped at `maxSide`. Spreadsheet and PDF libraries
 *  embed only PNG/JPEG; data: because the production CSP refuses blob: images. */
export const dataUrlToPng = (src: string, maxSide = 600): Promise<{ dataUrl: string; w: number; h: number }> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((img.naturalWidth || maxSide) * k));
      canvas.height = Math.max(1, Math.round((img.naturalHeight || maxSide) * k));
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve({ dataUrl: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height });
    };
    img.onerror = () => reject(new Error('Could not read the image'));
    img.src = src;
  });
