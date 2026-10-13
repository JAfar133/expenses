import { NavLink, Outlet, useLocation } from 'react-router';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { toSaveErrorMessage } from '../../expenses/api/save-error-message.ts';
import { CurrencySelect } from '../components/CurrencySelect.tsx';
import { ExportButton } from '../components/ExportButton.tsx';
import { FilterPanel } from '../components/FilterPanel.tsx';
import { DisplayCurrencyProvider, useDisplayCurrency } from '../hooks/useDisplayCurrency.tsx';
import { useExportReport } from '../hooks/useExportReport.ts';
import { useFilterState } from '../hooks/useFilterState.ts';
import { toApiFilters } from '../model/filter-state.ts';

const tabClass = ({ isActive }: { isActive: boolean }) =>
  '-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ' +
  (isActive
    ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
    : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-100');

/** Frame of the "Analytics" section: tabs, currency picker and the shared filter panel. Filters persist when switching tabs. */
export default function AnalyticsLayout() {
  return (
    <DisplayCurrencyProvider>
      <AnalyticsFrame />
    </DisplayCurrencyProvider>
  );
}

function AnalyticsFrame() {
  const { state, update, reset, today } = useFilterState();
  const { search, pathname } = useLocation();
  const isCompare = pathname.endsWith('/compare');
  const { code: currency } = useDisplayCurrency();

  // The report covers what the page shows: the shared filters and the display currency.
  // Month comparison has its own period, so the report there is not limited by dates.
  const report = useExportReport({ ...toApiFilters(state, today, !isCompare), currency });

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <nav
          aria-label="Виды анализа"
          className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800"
        >
          <NavLink to={{ pathname: '/analytics', search }} end className={tabClass}>
            Обзор
          </NavLink>
          <NavLink to={{ pathname: '/analytics/operations', search }} className={tabClass}>
            Операции
          </NavLink>
          <NavLink to={{ pathname: '/analytics/compare', search }} className={tabClass}>
            Сравнение месяцев
          </NavLink>
        </nav>
        <div className="sm:flex sm:justify-end">
          <CurrencySelect />
        </div>
      </div>

      {/* Month comparison has its own period (last months), other filters are shared */}
      <FilterPanel
        state={state}
        today={today}
        onChange={update}
        onReset={reset}
        showPeriod={!isCompare}
        actions={<ExportButton busy={report.isPending} onClick={() => report.mutate()} />}
      />
      {report.isError && <Notice variant="error">{toSaveErrorMessage(report.error)}</Notice>}

      <Outlet />
    </div>
  );
}
