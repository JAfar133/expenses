import { useRef, useState, type ChangeEvent } from 'react';
import { compressImage } from '../../../shared/utils/image-compress.ts';

/**
 * Picking a photo: the camera or the gallery of the phone, compressed in the browser before it is used.
 * `onPhoto` gets the compressed JPEG; a failure to decode the file becomes a calm message.
 */
export function usePhotoFile(onPhoto: (photo: Blob) => void | Promise<void>) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  /** Compresses a picture and hands it over: the road of a file from the gallery and of a frame from the camera. */
  const process = async (file: Blob) => {
    setBusy(true);
    setError(undefined);
    try {
      await onPhoto(await compressImage(file));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось обработать фото');
    } finally {
      setBusy(false);
    }
  };

  const onChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // The same file can be chosen again later
    event.target.value = '';
    if (!file) return;
    await process(file);
  };

  return { input, open: () => input.current?.click(), onChange, process, busy, error };
}
