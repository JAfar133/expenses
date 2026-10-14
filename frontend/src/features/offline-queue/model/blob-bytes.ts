/** A photo as bytes: Safari is unreliable with Blobs in IndexedDB, bytes are not. */
export interface StoredBlob {
  bytes: ArrayBuffer;
  type: string;
}

export function readBytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsArrayBuffer(blob);
  });
}

export async function toStoredBlob(blob: Blob): Promise<StoredBlob> {
  return { bytes: await readBytes(blob), type: blob.type };
}

export const fromStoredBlob = ({ bytes, type }: StoredBlob): Blob => new Blob([bytes], { type });
