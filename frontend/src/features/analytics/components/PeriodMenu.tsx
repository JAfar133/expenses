import { useState } from 'react';
import { ChevronDownIcon } from '../../../shared/ui/icons.tsx';
import { AnchoredPanel } from '../../../shared/ui/AnchoredPanel.tsx';
import { periodRange, type FilterState, type PeriodKind } from '../model/filter-state.ts';
import { addDays, monthLabel, monthOf, shiftMonth } from '../model/periods.ts';
import { ChartTypeSwitch } from './ChartTypeSwitch.tsx';
import { useIsWide } from '../../../shared/hooks/useIsWide.ts';
import { DateRangeInput } from './DateRangeInput.tsx';

const PERIOD_OPTIONS: { value: PeriodKind; label: string }[] = [
  { value: 'month', label: 'Месяц' },
  { value: '30d', label: '30 дней' },
  { value: '90d', label: '90 дней' },
  { value: 'year', label: 'Год' },
  { value: 'all', label: 'Всё время' },
  { value: 'custom', label: 'Свой' },
];

const display = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** The caption of the period: «Октябрь 2026», «30 дней», «05.10.2026 – 12.10.2026». */
export function periodCaption(state: FilterState, from?: string, to?: string): string {
  if (state.period === 'month') return monthLabel(state.month);
  if (state.period === 'custom') {
    if (from && to) return `${display(from)} – ${display(to)}`;
    return from ? `с ${display(from)}` : to ? `по ${display(to)}` : 'Свой период';
  }
  return PERIOD_OPTIONS.find((option) => option.value === state.period)?.label ?? '';
}

const arrowClass =
  'flex size-11 shrink-0 items-center justify-center rounded-lg border border-zinc-300 text-lg text-zinc-600 hover:border-indigo-400 disabled:opacity-40 disabled:hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300';

interface PeriodMenuProps {
  state: FilterState;
  today: string;
  onChange: (patch: Partial<FilterState>) => void;
}

/**
 * The period: a button with its caption opens a compact panel (presets, a date range for «Свой»);
 * for a month there are arrows ‹ › next to the button. The panel closes after a choice («Применить» for a range).
 */
export function PeriodMenu({ state, today, onChange }: PeriodMenuProps) {
  const [open, setOpen] = useState(false);
  const wide = useIsWide();
  const { from, to } = periodRange(state, today);
  const latest = monthOf(today);
  const caption = periodCaption(state, from, to);

  const choose = (period: PeriodKind) => {
    // A custom period starts from what is already selected; for "all time" take the last 30 days
    if (period === 'custom' && !state.from && !state.to) {
      onChange(
        from && to ? { period, from, to } : { period, from: addDays(today, -29), to: today },
      );
      return;
    }
    onChange({ period });
    if (period !== 'custom') setOpen(false);
  };

  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      {state.period === 'month' && (
        <button
          type="button"
          aria-label="Предыдущий месяц"
          className={arrowClass}
          onClick={() => onChange({ month: shiftMonth(state.month, -1) })}
        >
          ‹
        </button>
      )}
      <AnchoredPanel
        label="Период"
        className="min-w-0 flex-1 sm:max-w-72"
        open={open}
        onOpenChange={setOpen}
        trigger={(props) => (
          <button
            {...props}
            type="button"
            aria-label={`Период: ${caption}`}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 px-3 text-sm font-medium hover:border-indigo-400 dark:border-zinc-700"
          >
            <span aria-hidden="true" className="text-zinc-500 dark:text-zinc-400">
              Период:
            </span>
            <span aria-live="polite" className="tabular-nums">
              {caption}
            </span>
            <ChevronDownIcon />
          </button>
        )}
      >
        <div className="space-y-4">
          <ChartTypeSwitch
            label="Период"
            mobileColumns={3}
            options={PERIOD_OPTIONS}
            value={state.period}
            onChange={choose}
          />
          {state.period === 'custom' && (
            <>
              <DateRangeInput
                from={from}
                to={to}
                max={today}
                inline={!wide}
                onChange={(range) => onChange({ period: 'custom', ...range })}
              />
              <div className="sticky bottom-0 bg-white pt-1 sm:static dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="h-12 w-full rounded-xl bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-500 sm:h-11"
                >
                  Применить
                </button>
              </div>
            </>
          )}
        </div>
      </AnchoredPanel>
      {state.period === 'month' && (
        <button
          type="button"
          aria-label="Следующий месяц"
          className={arrowClass}
          disabled={state.month >= latest}
          onClick={() => onChange({ month: shiftMonth(state.month, 1) })}
        >
          ›
        </button>
      )}
    </div>
  );
}
