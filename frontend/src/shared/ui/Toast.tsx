import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { InfoIcon } from './icons.tsx';

export const TOAST_MS = 4000;
/** How long the fade takes; the notice is removed after it. */
export const TOAST_FADE_MS = 200;
/** A swipe up of this many pixels sweeps the notice away. */
export const TOAST_SWIPE_PX = 30;

interface ToastProps {
  children: ReactNode;
  onDismiss: () => void;
  durationMs?: number;
}

/**
 * A short notice that does not shift the page: it floats at the top (under the safe area), away from the bottom bar.
 * It fades in, goes away by itself after a few seconds (fading out), at once on any tap or key outside it and on typing
 * in a field, and it can be swept up with a finger or the mouse.
 */
export function Toast({ children, onDismiss, durationMs = TOAST_MS }: ToastProps) {
  const root = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const [shown, setShown] = useState(false);
  const [offset, setOffset] = useState(0);
  const leaving = useRef(false);
  const dragFrom = useRef<number | null>(null);

  // Fades out, then goes away
  const close = () => {
    if (leaving.current) return;
    leaving.current = true;
    setShown(false);
    setTimeout(() => dismiss.current(), TOAST_FADE_MS);
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  // Fades in one frame after it is mounted
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => closeRef.current(), durationMs);
    const outside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) closeRef.current();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', outside);
    document.addEventListener('input', outside);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', outside);
      document.removeEventListener('input', outside);
    };
  }, [durationMs]);

  const onPointerDown = (event: PointerEvent) => {
    dragFrom.current = event.clientY;
  };
  const onPointerMove = (event: PointerEvent) => {
    if (dragFrom.current === null) return;
    // Only upwards: the notice follows the finger
    setOffset(Math.min(0, event.clientY - dragFrom.current));
  };
  const onPointerUp = () => {
    if (dragFrom.current === null) return;
    dragFrom.current = null;
    if (offset <= -TOAST_SWIPE_PX) closeRef.current();
    else setOffset(0);
  };

  return (
    <div
      ref={root}
      role="status"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={offset === 0 ? undefined : { transform: `translateY(${offset}px)` }}
      className={`fixed inset-x-4 top-[max(0.75rem,env(safe-area-inset-top))] z-40 mx-auto flex max-w-sm touch-none items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white/90 px-4 py-3 text-sm text-zinc-800 shadow-lg shadow-zinc-900/10 backdrop-blur-md duration-200 ease-out motion-reduce:transition-none dark:border-zinc-700/80 dark:bg-zinc-900/90 dark:text-zinc-100 dark:shadow-black/30 ${
        offset === 0 ? 'transition' : ''
      } ${shown ? 'opacity-100' : '-translate-y-2 opacity-0'}`}
    >
      <span aria-hidden="true" className="shrink-0 text-indigo-500 dark:text-indigo-400">
        <InfoIcon size={18} />
      </span>
      {children}
    </div>
  );
}
