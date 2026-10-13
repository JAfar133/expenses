import { useState, type ReactNode } from 'react';
import { AnchoredPanel } from '../../../shared/ui/AnchoredPanel.tsx';
import { SettingsIcon } from '../../../shared/ui/icons.tsx';
import { useFilterOptions } from '../hooks/useFilterOptions.ts';
import { activeFilterCount, type FilterState } from '../model/filter-state.ts';
import { ActiveFilters } from './ActiveFilters.tsx';
import { FilterSheet } from './FilterSheet.tsx';
import { PeriodMenu } from './PeriodMenu.tsx';

interface FilterPanelProps {
  state: FilterState;
  today: string;
  onChange: (patch: Partial<FilterState>) => void;
  onReset: () => void;
  /** Show the period; month comparison has its own period */
  showPeriod?: boolean;
  /** Buttons next to the Filters button (e.g. the report download) */
  actions?: ReactNode;
}

/**
 * The top of the analytics pages: the period and the Filters button on one line (the panel with the filters opens
 * from it), under them only the filters that restrict something, as chips with a cross.
 */
export function FilterPanel({
  state,
  today,
  onChange,
  onReset,
  showPeriod = true,
  actions,
}: FilterPanelProps) {
  const [open, setOpen] = useState(false);
  const options = useFilterOptions();
  const count = activeFilterCount(state);

  return (
    <section
      aria-label="Фильтры"
      className="space-y-2 rounded-2xl bg-white p-3 shadow-sm dark:bg-zinc-900"
    >
      <div className="flex items-center gap-2">
        {showPeriod && <PeriodMenu state={state} today={today} onChange={onChange} />}
        <div
          className={`flex items-center gap-2 ${showPeriod ? 'shrink-0' : 'min-w-0 flex-1 sm:flex-none'}`}
        >
          <AnchoredPanel
            label="Фильтры"
            className={showPeriod ? 'shrink-0' : 'min-w-0 flex-1 sm:flex-none'}
            open={open}
            onOpenChange={setOpen}
            widthClass="sm:w-[26rem]"
            trigger={(props) => (
              <button
                {...props}
                type="button"
                aria-label={count > 0 ? `Фильтры · ${count}` : 'Фильтры'}
                className="flex h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-300 px-2.5 text-sm font-medium hover:border-indigo-400 sm:gap-2 sm:px-3 dark:border-zinc-700"
              >
                <SettingsIcon />
                {/* On a narrow screen only the icon and the number of active filters */}
                <span className="hidden min-[420px]:inline">Фильтры</span>
                {count > 0 && (
                  <span>
                    <span className="hidden min-[420px]:inline">· </span>
                    {count}
                  </span>
                )}
              </button>
            )}
          >
            <FilterSheet
              state={state}
              options={options}
              onChange={onChange}
              onReset={onReset}
              onClose={() => setOpen(false)}
            />
          </AnchoredPanel>
          {actions}
        </div>
      </div>
      <ActiveFilters
        state={state}
        authors={options.authors}
        onChange={onChange}
        onReset={onReset}
      />
    </section>
  );
}
