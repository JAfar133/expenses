import { useEffect, useRef, type ReactNode } from 'react';
import { useScrollLock } from '../hooks/useScrollLock.ts';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

const FOCUSABLE = 'input, select, textarea, button:not([disabled]), [href]';

/** Modal window: closes on Escape and on backdrop click, focus moves inside and returns back. */
export function Modal({ title, onClose, children }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  useScrollLock();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
    // The effect is needed only once, on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-dvh w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl dark:bg-zinc-900"
      >
        <h2 className="shrink-0 bg-white px-5 pt-5 pb-3 text-lg font-semibold dark:bg-zinc-900">
          {title}
        </h2>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
