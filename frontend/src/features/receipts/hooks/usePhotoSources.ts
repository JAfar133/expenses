import { usePhotoFile } from './usePhotoFile.ts';

/**
 * Two ways to get the same photo: the camera of the phone and the gallery (two file inputs, one with `capture`).
 * Whatever the source, the file takes the same road: compression in the browser, then `onPhoto`.
 */
export function usePhotoSources(onPhoto: (photo: Blob) => void | Promise<void>) {
  const camera = usePhotoFile(onPhoto);
  const gallery = usePhotoFile(onPhoto);
  return {
    camera,
    gallery,
    busy: camera.busy || gallery.busy,
    error: camera.error ?? gallery.error,
  };
}
