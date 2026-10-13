/** Longest side of a receipt photo after compression, in pixels. */
export const MAX_SIDE = 2400;
const JPEG_QUALITY = 0.85;

export const PHOTO_ERROR = 'Не удалось обработать фото';

/** Size that fits into `max` on the longer side, keeping the proportions; a smaller image is not enlarged. */
export function fitSize(
  width: number,
  height: number,
  max = MAX_SIDE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Shrinks a photo to JPEG with the longer side up to 2400px. The EXIF orientation is applied while decoding.
 * Throws `Error('Не удалось обработать фото')` if the browser cannot decode the file (e.g. HEIC).
 */
export async function compressImage(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = fitSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no canvas');
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) throw new Error('no blob');
    return blob;
  } catch {
    throw new Error(PHOTO_ERROR);
  }
}
