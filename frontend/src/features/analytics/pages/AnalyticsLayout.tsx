import { NavLink, Outlet, useLocation } from 'react-router';
import { FilterPanel } from '../components/FilterPanel.tsx';
import { useFilterState } from '../hooks/useFilterState.ts';

const tabClass = ({ isActive }: { isActive: boolean }) =>
  'border-b-2 px-3 py-2 text-sm font-medium transition ' +
  (isActive
    ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
    : 'border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100');

/** Рамка раздела «Анализ»: вкладки и общая панель фильтров. Фильтры при смене вкладки сохраняются. */
export default function AnalyticsLayout() {
  const { state, update, reset, today } = useFilterState();
  const { search, pathname } = useLocation();
  const isCompare = pathname.endsWith('/compare');

  return (
    <div className="space-y-4">
      <nav
        aria-label="Виды анализа"
        className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800"
      >
        <NavLink to={{ pathname: '/analytics', search }} end className={tabClass}>
          Обзор
        </NavLink>
        <NavLink to={{ pathname: '/analytics/compare', search }} className={tabClass}>
          Сравнение месяцев
        </NavLink>
      </nav>

      {/* У сравнения месяцев свой период (последние месяцы), остальные фильтры общие */}
      <FilterPanel
        state={state}
        today={today}
        onChange={update}
        onReset={reset}
        showPeriod={!isCompare}
      />

      <Outlet />
    </div>
  );
}
