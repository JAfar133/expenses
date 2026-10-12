import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * A round "?" button with a text bubble. A mouse opens it on hover; a tap or the keyboard opens it and keeps it open
 * (closes on a second tap, Escape or a tap outside). There is one per section, next to its title.
 *
 * The bubble is positioned against the nearest `relative` ancestor (the title row of the card), not against the
 * button or the screen: on a phone it takes the width of the card, on a wide screen it hangs under the title at
 * most 22rem wide. So it can never leave the screen (and, unlike `position: fixed`, it behaves the same in
 * mobile Safari).
 */
export function HelpHint({ children }: { children: ReactNode }) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = pinned || hovered;
  const root = useRef<HTMLSpanElement>(null);
  const bubbleId = useId();

  const closeAll = () => {
    setPinned(false);
    setHovered(false);
  };

  useEffect(() => {
    if (!pinned) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) closeAll();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAll();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [pinned]);

  const onMouse = (value: boolean) => (event: { pointerType?: string }) => {
    if (event.pointerType === 'mouse') setHovered(value);
  };

  return (
    <span
      ref={root}
      className="inline-flex align-middle"
      onPointerEnter={onMouse(true)}
      onPointerLeave={onMouse(false)}
    >
      <button
        type="button"
        aria-label="Подсказка"
        aria-expanded={open}
        aria-controls={open ? bubbleId : undefined}
        onClick={() => (pinned ? closeAll() : setPinned(true))}
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
          className="absolute inset-x-0 top-full z-30 mt-1 rounded-xl bg-zinc-800 px-3 py-2 text-left text-sm font-normal leading-snug text-white shadow-lg sm:right-auto sm:w-max sm:max-w-[22rem] dark:bg-zinc-100 dark:text-zinc-900"
        >
          {children}
        </span>
      )}
    </span>
  );
}

/** Bubble content: a short intro and one line per action. */
export function HintList({ intro, items }: { intro?: string; items: [string, string][] }) {
  return (
    <>
      {intro && <p className="mb-1.5">{intro}</p>}
      <ul className="space-y-1">
        {items.map(([action, text]) => (
          <li key={action}>
            <span className="font-semibold">{action}</span> — {text}
          </li>
        ))}
      </ul>
    </>
  );
}
