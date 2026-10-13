import { useIsWide } from '../hooks/useIsWide.ts';
import { useScrollLock } from '../hooks/useScrollLock.ts';
import { CloseIcon } from './icons.tsx';
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type Ref } from 'react';

export interface PanelTriggerProps {
  ref: Ref<HTMLButtonElement>;
  'aria-haspopup': 'dialog';
  'aria-expanded': boolean;
  onClick: () => void;
}

interface AnchoredPanelProps {
  /** The accessible name of the panel */
  label: string;
  /** The visible title of the panel; the header with it also has the close button */
  title?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: (props: PanelTriggerProps) => ReactNode;
  children: ReactNode;
  /** Desktop width of the panel */
  widthClass?: string;
  /** Layout classes of the wrapper (it is a flex child of the row) */
  className?: string;
}

/**
 * A panel opened by a button: a popover under the button on a desktop, a bottom sheet with a backdrop on a phone.
 * It closes on Escape (the focus returns to the button), on a click outside and on a click on the backdrop.
 */
export function AnchoredPanel({
  label,
  title,
  open,
  onOpenChange,
  trigger,
  children,
  widthClass = 'sm:w-96',
  className = '',
}: AnchoredPanelProps) {
  const wide = useIsWide();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // A sheet on a phone blocks the page; the desktop popover does not
  useScrollLock(open && !wide);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open, onOpenChange]);

  const close = () => {
    onOpenChange(false);
    button.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) close();
  };

  return (
    <div ref={root} className={`relative ${className}`} onKeyDown={onKeyDown}>
      {trigger({
        ref: button,
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        onClick: () => onOpenChange(!open),
      })}
      {open && (
        <>
          <div
            aria-hidden="true"
            onClick={close}
            className="fixed inset-0 z-30 bg-black/30 sm:hidden"
          />
          <div
            role="dialog"
            aria-label={label}
            className={`fixed inset-x-0 bottom-0 z-40 flex max-h-[90dvh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:max-h-[75dvh] sm:rounded-2xl sm:border sm:border-zinc-200 sm:shadow-lg dark:bg-zinc-900 sm:dark:border-zinc-700 ${widthClass}`}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 bg-white px-4 pt-3 pb-1 dark:bg-zinc-900">
              <h3 className="text-base font-semibold">{title ?? label}</h3>
              <button
                type="button"
                aria-label="Закрыть"
                title="Закрыть"
                onClick={close}
                className="-mr-2 flex size-11 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+4rem)] sm:pb-4">
              {children}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
