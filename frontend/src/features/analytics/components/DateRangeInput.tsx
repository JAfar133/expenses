import { useEffect, useRef, useState } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import { ru } from 'react-day-picker/locale';
import 'react-day-picker/style.css';

interface DateRangeInputProps {
  /** Bounds of the selected range, YYYY-MM-DD */
  from?: string;
  to?: string;
  /** Last selectable day (usually today) */
  max: string;
  /** The calendar opens in the flow under the field (inside a sheet on a phone) instead of a popover */
  inline?: boolean;
  onChange: (range: { from: string; to: string }) => void;
}

/** A date without time: noon, so a time zone change does not shift the day. */
const toDate = (iso: string | undefined): Date | undefined =>
  iso
    ? new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)), 12)
    : undefined;

const pad = (value: number) => String(value).padStart(2, '0');
const toIso = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const display = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** How many months to show: one on narrow screens, two on wide. */
function useMonthsShown(): number {
  const query = '(min-width: 640px)';
  const [wide, setWide] = useState(() => globalThis.matchMedia?.(query).matches ?? false);

  useEffect(() => {
    const media = globalThis.matchMedia?.(query);
    if (!media) return;
    const update = () => setWide(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return wide ? 2 : 1;
}

function rangeText(from?: string, to?: string): string {
  if (from && to) return `${display(from)} – ${display(to)}`;
  if (from) return `с ${display(from)}`;
  if (to) return `по ${display(to)}`;
  return 'Выберите даты';
}

/**
 * A single "input" for a date range: a button with the chosen period opens a calendar
 * where start and end are clicked. The selection completes on the second click.
 */
export function DateRangeInput({ from, to, max, inline = false, onChange }: DateRangeInputProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>();
  const root = useRef<HTMLDivElement>(null);
  const calendar = useRef<HTMLDivElement>(null);
  const months = inline ? 1 : useMonthsShown();

  // The calendar closes on Escape and on a click outside it
  useEffect(() => {
    if (!open) return;
    // In the capture phase and stopped: Escape closes only the calendar, not the panel around it
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  // Inside a sheet the opened calendar is scrolled into view as a whole
  useEffect(() => {
    if (open && inline)
      calendar.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [open, inline]);

  const toggle = () => {
    if (!open) setDraft({ from: toDate(from), to: toDate(to) });
    setOpen((current) => !current);
  };

  /** The first click sets the start, the second the end (earlier than the start: bounds are swapped). */
  const pick = (day: Date) => {
    if (!draft?.from || draft.to) {
      setDraft({ from: day, to: undefined });
      return;
    }
    const [start, end] = day < draft.from ? [day, draft.from] : [draft.from, day];
    setDraft({ from: start, to: end });
    onChange({ from: toIso(start), to: toIso(end) });
    setOpen(false);
  };

  const label = rangeText(from, to);
  const anchor = toDate(to) ?? toDate(max) ?? new Date();
  const firstMonth = new Date(anchor.getFullYear(), anchor.getMonth() - (months - 1), 1);

  return (
    <div ref={root} className="relative w-full sm:w-auto">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Диапазон дат: ${label}`}
        onClick={toggle}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-xl sm:w-auto sm:justify-start border border-zinc-300 bg-white px-3 text-sm outline-none hover:border-indigo-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-900"
      >
        <span aria-hidden="true">📅</span>
        <span className="tabular-nums">{label}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Выбор диапазона дат"
          ref={calendar}
          className={
            inline
              ? 'mt-2 flex flex-col items-center overflow-x-auto rounded-2xl p-1 ring-1 ring-zinc-200 dark:ring-zinc-700'
              : 'absolute left-0 z-20 mt-2 w-max max-w-[calc(100vw-2rem)] overflow-x-auto rounded-2xl bg-white p-3 shadow-xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700'
          }
        >
          <DayPicker
            mode="range"
            locale={ru}
            weekStartsOn={1}
            numberOfMonths={months}
            defaultMonth={firstMonth}
            selected={draft}
            onDayClick={pick}
            disabled={{ after: toDate(max)! }}
          />
          <p className="px-1 pt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {draft?.from && !draft.to
              ? 'Выберите последний день'
              : 'Выберите первый и последний день'}
          </p>
        </div>
      )}
    </div>
  );
}
