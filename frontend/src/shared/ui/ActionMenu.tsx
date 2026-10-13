import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MoreIcon } from './icons.tsx';

export interface MenuAction {
  label: string;
  icon?: ReactNode;
  tone?: 'danger';
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * The «⋯» menu of a list row. Accessible like the user menu: the button has `aria-haspopup`/`aria-expanded`,
 * the items are `menuitem`s; it closes on Escape (the focus returns to the button), on a click outside and after
 * a choice; arrows, Home and End move between the items.
 */
export function ActionMenu({
  label,
  actions,
  title,
}: {
  label: string;
  actions: MenuAction[];
  /** A tooltip of the button, when it should say more than the label */
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') return close(true);
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [
      ...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []),
    ];
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };

  if (actions.length === 0) return null;

  return (
    <div ref={root} className="relative shrink-0" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={title ?? label}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex size-11 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 sm:size-9 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        <MoreIcon />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className="absolute right-0 z-30 mt-1 w-60 max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              onClick={() => {
                close();
                action.onSelect();
              }}
              className={
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-zinc-100 focus-visible:bg-zinc-100 focus-visible:outline-none disabled:opacity-60 dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800 ' +
                (action.tone === 'danger'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-zinc-700 dark:text-zinc-200')
              }
            >
              {action.icon && <span className="opacity-70">{action.icon}</span>}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
