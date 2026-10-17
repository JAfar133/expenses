import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { GripIcon } from '../../../shared/ui/icons.tsx';

/** The grip that starts a drag; `touch-action: none` only here, so the rest of the row still scrolls the page. */
export const DragHandle = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function DragHandle(props, ref) {
    return (
      <button
        ref={ref}
        type="button"
        style={{ touchAction: 'none' }}
        className="flex size-11 shrink-0 cursor-grab items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-600 focus-visible:ring-2 focus-visible:ring-indigo-500 aria-pressed:bg-indigo-50 aria-pressed:text-indigo-600 dark:text-zinc-500 dark:hover:text-zinc-300 dark:aria-pressed:bg-indigo-950"
        {...props}
      >
        <GripIcon />
      </button>
    );
  },
);

/** Screen-reader only live region that announces the position while a row is moved. */
export const MoveAnnouncer = ({ text }: { text: string }) => (
  <div aria-live="assertive" role="status" className="sr-only">
    {text}
  </div>
);
