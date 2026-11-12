/** Re-encode any browser-readable image (WebP, SVG, ...) as a PNG, no larger than
 *  `maxSide` on its longest edge. PDF libraries embed only PNG and JPEG, and a
 *  full-size upload would be several times the server's 2 MB limit. */
export const toPngFile = (file: File, maxSide = 1600): Promise<File> => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((img.naturalWidth || maxSide) * scale));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || maxSide) * scale));
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob(
      (blob) => (blob ? resolve(new File([blob], 'watermark.png', { type: 'image/png' })) : reject(new Error('Could not process the image'))),
      'image/png',
    );
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the image')); };
  img.src = url;
});
