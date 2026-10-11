import { periodRange, type FilterState, type PeriodKind } from '../model/filter-state.ts';
import { addDays, monthOf } from '../model/periods.ts';
import { DateRangeInput } from './DateRangeInput.tsx';
import { ChartTypeSwitch } from './ChartTypeSwitch.tsx';
import { MonthSwitcher } from './MonthSwitcher.tsx';

const PERIOD_OPTIONS: { value: PeriodKind; label: string }[] = [
  { value: 'month', label: 'Месяц' },
  { value: '30d', label: '30 дней' },
  { value: '90d', label: '90 дней' },
  { value: 'year', label: 'Год' },
  { value: 'all', label: 'Всё время' },
  { value: 'custom', label: 'Свой' },
];

interface PeriodPickerProps {
  state: FilterState;
  today: string;
  onChange: (patch: Partial<FilterState>) => void;
}

/** Выбор периода: готовые варианты, переключатель месяца и диапазон дат. */
export function PeriodPicker({ state, today, onChange }: PeriodPickerProps) {
  const { from, to } = periodRange(state, today);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
      <ChartTypeSwitch
        label="Период"
        mobileColumns={3}
        options={PERIOD_OPTIONS}
        value={state.period}
        onChange={(period) => {
          // Свой период начинаем с того, что уже выбрано; для «всё время» берём последние 30 дней
          if (period === 'custom' && !state.from && !state.to) {
            onChange(
              from && to ? { period, from, to } : { period, from: addDays(today, -29), to: today },
            );
          } else {
            onChange({ period });
          }
        }}
      />

      {state.period === 'month' && (
        <MonthSwitcher
          month={state.month}
          latest={monthOf(today)}
          onChange={(month) => onChange({ month })}
        />
      )}

      {state.period === 'custom' && (
        <DateRangeInput
          from={from}
          to={to}
          max={today}
          onChange={(range) => onChange({ period: 'custom', ...range })}
        />
      )}
    </div>
  );
}
