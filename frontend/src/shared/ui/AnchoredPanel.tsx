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
  title?: ReactNode;
  /** Something at the right of the title, before the close button (a menu) */
  headerExtra?: ReactNode;
  /** A «←» button before the title (a screen inside the panel) */
  onBack?: () => void;
  /** The highest the panel gets: on a phone and from `sm` up (default: tall sheet, 75dvh popover) */
  maxHeightClass?: string;
  /** Little room under the content (no space for a bottom bar): the sheet is as short as its content */
  compactBody?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: (props: PanelTriggerProps) => ReactNode;
  children: ReactNode;
  /** Desktop width of the panel */
  widthClass?: string;
  /** Which edge of the button the desktop popover lines up with (a button at the right edge needs `right`) */
  align?: 'left' | 'right';
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
  headerExtra,
  onBack,
  maxHeightClass = 'max-h-[90dvh] sm:max-h-[75dvh]',
  compactBody = false,
  open,
  onOpenChange,
  trigger,
  children,
  widthClass = 'sm:w-96',
  align = 'left',
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
      const target = event.target as Node;
      // A notice floating over the panel (marked `data-panel-ignore`) is not «outside»
      if ((target as Element).closest?.('[data-panel-ignore]')) return;
      if (!root.current?.contains(target)) onOpenChange(false);
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
            className={`fixed inset-x-0 bottom-0 z-40 flex ${maxHeightClass} flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto ${align === 'right' ? 'sm:right-0' : 'sm:left-0'} sm:top-full sm:mt-2 sm:rounded-2xl sm:border sm:border-zinc-200 sm:shadow-lg dark:bg-zinc-900 sm:dark:border-zinc-700 ${widthClass}`}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 bg-white px-4 pt-3 pb-1 dark:bg-zinc-900">
              {onBack && (
                <button
                  type="button"
                  aria-label="Назад"
                  title="Назад"
                  onClick={onBack}
                  className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <span aria-hidden="true" className="text-xl leading-none">
                    ←
                  </span>
                </button>
              )}
              <h3 className="flex min-w-0 flex-1 items-center gap-2 text-base font-semibold">
                {title ?? label}
              </h3>
              {headerExtra}
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
            <div
              className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 sm:pb-4 ${compactBody ? 'pb-[calc(env(safe-area-inset-bottom)+1rem)]' : 'pb-[calc(env(safe-area-inset-bottom)+4rem)]'}`}
            >
              {children}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
