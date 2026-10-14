import { useEffect, useRef, type RefObject } from 'react';
import { CameraIcon, ImageIcon } from '../../../shared/ui/icons.tsx';

interface PhotoSourceMenuProps {
  onCamera: () => void;
  onGallery: () => void;
  onClose: () => void;
  /** The button that opened the menu: pressing it again is the button's own business, not an outside click */
  anchor?: RefObject<HTMLElement | null>;
  /** Placement (the menu is absolutely positioned by the caller) */
  className?: string;
}

const itemClass =
  'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-zinc-100 focus-visible:bg-zinc-100 focus-visible:outline-none dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800';

/**
 * Two items: «Сфотографировать» and «Выбрать из галереи». Android offers only the gallery for a plain file input,
 * so the app asks itself. Closes on Escape, on a click outside and after a choice; the first item gets the focus.
 */
export function PhotoSourceMenu({
  onCamera,
  onGallery,
  onClose,
  anchor,
  className = '',
}: PhotoSourceMenuProps) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (root.current?.contains(target) || anchor?.current?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onClose();
      anchor?.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
    // Registered once per opening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <div
      ref={root}
      role="menu"
      aria-label="Источник фото"
      className={`z-40 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${className}`}
    >
      <button type="button" role="menuitem" onClick={choose(onCamera)} className={itemClass}>
        <CameraIcon />
        Сфотографировать
      </button>
      <button type="button" role="menuitem" onClick={choose(onGallery)} className={itemClass}>
        <ImageIcon />
        Выбрать из галереи
      </button>
    </div>
  );
}
