import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useScrollLock } from '../../../shared/hooks/useScrollLock.ts';
import { CloseIcon } from '../../../shared/ui/icons.tsx';
import { receiptUrl } from '../api/receipts.api.ts';
import { FIT, clampView, toggleZoom, zoomBy, zoomIn, zoomOut, type View } from '../model/zoom.ts';

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 24;

const buttonClass =
  'flex size-11 items-center justify-center rounded-full bg-black/60 text-xl font-medium text-white backdrop-blur hover:bg-black/80 disabled:opacity-40';

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The photo of a receipt almost full screen: fitted into the window, zoomed with a pinch or a double tap (phone),
 * with the buttons, a double click, Ctrl + wheel (desktop); a zoomed photo is dragged with a finger or the mouse.
 * Zoom is handled here with Pointer Events (`touch-action: none`), the page itself is not zoomed.
 */
export function ReceiptViewer({
  expenseId,
  src,
  onClose,
}: {
  /** A receipt saved on the server */
  expenseId?: string;
  /** Or any image address, e.g. a local blob URL of the photo just chosen */
  src?: string;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>(FIT);
  const viewRef = useRef(view);
  viewRef.current = view;
  const area = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const downAt = useRef<{ x: number; y: number } | undefined>(undefined);
  const gesture = useRef<{ distance: number; view: View } | undefined>(undefined);
  const lastTap = useRef<{ time: number; x: number; y: number } | undefined>(undefined);
  useScrollLock();

  const size = () => ({
    width: image.current?.offsetWidth ?? 0,
    height: image.current?.offsetHeight ?? 0,
  });
  const apply = (next: View) => {
    const { width, height } = size();
    setView(clampView(next, width, height));
  };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
    // Only on open and close
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl + wheel (and a trackpad pinch) zooms; the handler is not passive, so the page does not zoom as well
  useEffect(() => {
    const node = area.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const { width, height } = {
        width: image.current?.offsetWidth ?? 0,
        height: image.current?.offsetHeight ?? 0,
      };
      setView((current) => zoomBy(current, event.deltaY < 0 ? 1.15 : 1 / 1.15, width, height));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (event: ReactPointerEvent) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    downAt.current =
      pointers.current.size === 1 ? { x: event.clientX, y: event.clientY } : undefined;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { distance: distance(a!, b!), view: viewRef.current };
    }
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);

    if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      const start = gesture.current;
      apply({ ...start.view, scale: start.view.scale * (distance(a!, b!) / start.distance) });
    } else if (pointers.current.size === 1 && viewRef.current.scale > 1) {
      apply({
        ...viewRef.current,
        x: viewRef.current.x + point.x - previous.x,
        y: viewRef.current.y + point.y - previous.y,
      });
    }
  };

  const onPointerUp = (event: ReactPointerEvent) => {
    const wasAlone = pointers.current.size === 1;
    pointers.current.delete(event.pointerId);
    gesture.current = undefined;
    if (!wasAlone) return;

    // A tap on the dark background (outside the photo) closes the window
    const start = downAt.current;
    const rect = image.current?.getBoundingClientRect();
    const tapped = !!start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8;
    const outside =
      !!rect &&
      (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom);
    if (tapped && outside) {
      onClose();
      return;
    }
    if (event.pointerType === 'mouse' || !tapped) return;

    // A double tap (a touch has no reliable dblclick)
    const now = event.timeStamp;
    const last = lastTap.current;
    if (
      last &&
      now - last.time < DOUBLE_TAP_MS &&
      Math.hypot(event.clientX - last.x, event.clientY - last.y) < DOUBLE_TAP_PX
    ) {
      lastTap.current = undefined;
      setView((current) => toggleZoom(current));
    } else {
      lastTap.current = { time: now, x: event.clientX, y: event.clientY };
    }
  };

  const step = (zoom: typeof zoomIn) => () => {
    const { width, height } = size();
    setView((current) => zoom(current, width, height));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Фото чека"
      className="fixed inset-0 z-50 bg-black/95"
    >
      <div
        ref={area}
        className="flex size-full touch-none select-none items-center justify-center overflow-hidden p-2 pt-16 pb-20"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setView((current) => toggleZoom(current))}
      >
        <img
          ref={image}
          src={src ?? receiptUrl(expenseId ?? '')}
          alt="Фото чека"
          draggable={false}
          data-scale={view.scale.toFixed(2)}
          className={`max-h-full max-w-full object-contain ${view.scale > 1 ? 'cursor-grab' : 'cursor-zoom-in'}`}
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: 'center',
          }}
        />
      </div>

      <button
        ref={closeButton}
        type="button"
        aria-label="Закрыть"
        title="Закрыть"
        onClick={onClose}
        className={`${buttonClass} absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))]`}
      >
        <CloseIcon />
      </button>

      <div className="absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] flex justify-center gap-3">
        <button
          type="button"
          aria-label="Уменьшить"
          title="Уменьшить"
          disabled={view.scale <= 1}
          onClick={step(zoomOut)}
          className={buttonClass}
        >
          <span aria-hidden="true">−</span>
        </button>
        <button
          type="button"
          aria-label="По размеру"
          title="По размеру"
          disabled={view.scale === 1}
          onClick={() => setView(FIT)}
          className={buttonClass}
        >
          <span aria-hidden="true" className="text-sm">
            1:1
          </span>
        </button>
        <button
          type="button"
          aria-label="Увеличить"
          title="Увеличить"
          onClick={step(zoomIn)}
          className={buttonClass}
        >
          <span aria-hidden="true">+</span>
        </button>
      </div>
    </div>
  );
}
