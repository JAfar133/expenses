import { usePhotoFile } from './usePhotoFile.ts';

/**
 * The photo of a receipt comes from the gallery (a file input) or from the camera of the app (`CameraCapture`).
 * Whatever the source, it takes the same road: compression in the browser, then `onPhoto`.
 */
export function usePhotoSources(onPhoto: (photo: Blob) => void | Promise<void>) {
  const gallery = usePhotoFile(onPhoto);
  return {
    gallery,
    /** A frame from the camera of the app */
    capture: gallery.process,
    busy: gallery.busy,
    error: gallery.error,
  };
}
