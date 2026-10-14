import { useEffect, useRef, useState } from 'react';
import { useScrollLock } from '../../../shared/hooks/useScrollLock.ts';
import { CloseIcon } from '../../../shared/ui/icons.tsx';

export const CAMERA_DENIED_MESSAGE =
  'Нет доступа к камере. Разрешите её для этого сайта в настройках браузера или выберите фото из галереи';

const PREFERRED = {
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } },
  audio: false,
} satisfies MediaStreamConstraints;

/** No camera of that kind: try again with anything that films. */
const RETRY_WITH_ANY = ['NotFoundError', 'OverconstrainedError'];

async function openStream(): Promise<MediaStream> {
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) throw new Error('unsupported');
  try {
    return await devices.getUserMedia(PREFERRED);
  } catch (error) {
    if (error instanceof Error && RETRY_WITH_ANY.includes(error.name)) {
      return devices.getUserMedia({ video: true, audio: false });
    }
    throw error;
  }
}

interface CameraCaptureProps {
  /** A frame of the camera as a JPEG; the caller sends it down the usual road (compression, notice, parsing) */
  onCapture: (frame: Blob) => void | Promise<void>;
  /** The error layer offers the gallery instead */
  onGallery: () => void;
  onClose: () => void;
}

type State = 'starting' | 'live' | 'denied';

/**
 * The camera of the app over the whole screen: a live preview of the rear camera, a shutter button and a cross.
 * The stream is always stopped when the layer closes or goes away. Without access (no API, no https, refused) it
 * says so and offers the gallery.
 */
export function CameraCapture({ onCapture, onGallery, onClose }: CameraCaptureProps) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<State>('starting');
  useScrollLock();

  const stop = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  };

  useEffect(() => {
    let cancelled = false;
    openStream()
      .then(async (opened) => {
        if (cancelled) return opened.getTracks().forEach((track) => track.stop());
        stream.current = opened;
        if (video.current) {
          video.current.srcObject = opened;
          await video.current.play?.()?.catch?.(() => undefined);
        }
        setState('live');
      })
      .catch(() => !cancelled && setState('denied'));
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      document.removeEventListener('keydown', onKey);
      stop();
    };
    // Once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shoot = () => {
    const element = video.current;
    if (!element) return;
    const canvas = document.createElement('canvas');
    canvas.width = element.videoWidth || 1280;
    canvas.height = element.videoHeight || 720;
    canvas.getContext('2d')?.drawImage(element, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (frame) => {
        stop();
        onClose();
        if (frame) void onCapture(frame);
      },
      'image/jpeg',
      0.92,
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Камера"
      className="fixed inset-0 z-[60] flex flex-col bg-black text-white"
    >
      <video
        ref={video}
        playsInline
        muted
        autoPlay
        className={`absolute inset-0 size-full object-cover ${state === 'live' ? '' : 'invisible'}`}
      />

      <div className="relative flex items-start justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button
          type="button"
          aria-label="Закрыть камеру"
          title="Закрыть камеру"
          onClick={() => {
            stop();
            onClose();
          }}
          className="flex size-11 items-center justify-center rounded-full bg-black/50 backdrop-blur"
        >
          <CloseIcon />
        </button>
        <p className="rounded-full bg-black/50 px-4 py-2 text-sm backdrop-blur">
          Наведите камеру на чек
        </p>
        <span className="size-11" aria-hidden="true" />
      </div>

      <div className="relative flex flex-1 items-center justify-center px-6 text-center">
        {state === 'starting' && <p role="status">Запускаем камеру…</p>}
        {state === 'denied' && (
          <div className="space-y-4">
            <p role="alert" className="text-base">
              {CAMERA_DENIED_MESSAGE}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onGallery();
                }}
                className="h-11 rounded-xl bg-white px-5 text-sm font-semibold text-zinc-900"
              >
                Выбрать из галереи
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-11 rounded-xl border border-white/40 px-5 text-sm font-medium"
              >
                Закрыть
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="relative flex justify-center pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          aria-label="Сделать снимок"
          title="Сделать снимок"
          disabled={state !== 'live'}
          onClick={shoot}
          className="size-[72px] rounded-full border-4 border-white/70 bg-white shadow-lg active:scale-95 disabled:opacity-40"
        />
      </div>
    </div>
  );
}
