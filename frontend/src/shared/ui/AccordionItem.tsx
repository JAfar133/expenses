import { useId, useState, type ReactNode } from 'react';
import { ChevronDownIcon } from './icons.tsx';

interface AccordionItemProps {
  title: string;
  /** One line under the title while the item is closed (e.g. the current values) */
  summary?: string;
  children: ReactNode;
}

/**
 * A section that opens and closes on its own: several can be open at once. The title is a button with
 * `aria-expanded`/`aria-controls`; the chevron turns when it is open.
 */
export function AccordionItem({ title, summary, children }: AccordionItemProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className="py-1">
      <button
        type="button"
        id={`${id}-button`}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 rounded-lg py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          {!open && summary && (
            <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
              {summary}
            </span>
          )}
        </span>
        <span
          aria-hidden="true"
          className={`shrink-0 text-zinc-400 transition ${open ? 'rotate-180' : ''}`}
        >
          <ChevronDownIcon />
        </span>
      </button>
      <div id={`${id}-panel`} role="region" aria-labelledby={`${id}-button`} hidden={!open}>
        {open && <div className="space-y-4 pb-4">{children}</div>}
      </div>
    </div>
  );
}
