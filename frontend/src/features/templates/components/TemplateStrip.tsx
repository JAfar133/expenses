import { useCallback, useEffect, useRef, useState } from 'react';
import { BoltIcon } from '../../../shared/ui/icons.tsx';
import { formatMoney } from '../../../shared/utils/money.ts';
import type { Template } from '../api/templates.api.ts';
import { STRIP_SIZE, templateLabel } from '../model/available.ts';

interface TemplateStripProps {
  templates: Template[];
  onApply: (template: Template) => void;
  onOpenAll: () => void;
}

/**
 * One row above the fields of the add form: the first few templates as chips (an amount, if the template has one, is
 * written on the chip) and «Все» pinned at the end. The chips keep their natural width and scroll sideways when they
 * do not fit; a soft fade at the right edge says there is more. What is beyond the first few is behind «Все».
 */
export function TemplateStrip({ templates, onApply, onOpenAll }: TemplateStripProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  const measure = useCallback(() => {
    const element = scroller.current;
    if (element) setMore(element.scrollLeft + element.clientWidth < element.scrollWidth - 1);
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure, templates]);

  return (
    <div role="group" aria-label="Быстрые траты" className="-mt-2 mb-5 flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <div
          ref={scroller}
          onScroll={measure}
          className="flex snap-x gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {templates.slice(0, STRIP_SIZE).map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => onApply(template)}
              className="flex h-11 shrink-0 snap-start items-center rounded-full bg-indigo-50 px-3.5 text-sm font-semibold whitespace-nowrap text-indigo-700 transition hover:bg-indigo-100 active:scale-[0.98] dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900"
            >
              <span className="max-w-[16ch] truncate">{templateLabel(template)}</span>
              {template.amount !== null && (
                <span className="ml-1.5 font-normal opacity-80">
                  {formatMoney(template.amount)}
                </span>
              )}
            </button>
          ))}
        </div>
        {more && (
          <div
            aria-hidden="true"
            data-testid="strip-fade"
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent dark:from-zinc-900"
          />
        )}
      </div>
      <button
        type="button"
        onClick={onOpenAll}
        className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-indigo-400 px-3.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-50 dark:border-indigo-500 dark:text-indigo-300 dark:hover:bg-indigo-950"
      >
        <BoltIcon size={15} />
        Все
      </button>
    </div>
  );
}
