import { useEffect, useId, useRef, useState } from 'react';

/**
 * A round "?" button with a text bubble. Works by tap and keyboard (not hover-only):
 * closes on a second tap, Escape or a click outside. On phones the bubble spans the screen width.
 */
export function HelpHint({ children }: { children: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const bubbleId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={root} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label="Подсказка"
        aria-expanded={open}
        aria-controls={open ? bubbleId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex size-8 items-center justify-center rounded-full"
      >
        <span
          aria-hidden="true"
          className="flex size-5 items-center justify-center rounded-full border border-zinc-400 text-xs font-semibold text-zinc-500 dark:border-zinc-500 dark:text-zinc-400"
        >
          ?
        </span>
      </button>
      {open && (
        <span
          id={bubbleId}
          role="note"
          className="fixed inset-x-4 z-30 mt-9 rounded-xl bg-zinc-800 px-3 py-2 text-left text-sm font-normal leading-snug text-white shadow-lg sm:absolute sm:inset-x-auto sm:left-0 sm:w-72 sm:max-w-[18rem] dark:bg-zinc-100 dark:text-zinc-900"
        >
          {children}
        </span>
      )}
    </span>
  );
}
