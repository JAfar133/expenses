import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { todayIso } from '../../../shared/utils/date.ts';
import {
  mergeFilterParams,
  parseFilterState,
  withoutFilters,
  type FilterState,
} from '../model/filter-state.ts';

/** Analytics page filters: read from the URL and written back to it (without new history entries). */
export function useFilterState() {
  const [params, setParams] = useSearchParams();
  const today = todayIso();

  const state = useMemo(() => parseFilterState(params, today), [params, today]);

  const update = useCallback(
    (patch: Partial<FilterState>) =>
      setParams(
        (current) =>
          mergeFilterParams(current, { ...parseFilterState(current, today), ...patch }, today),
        { replace: true },
      ),
    [setParams, today],
  );

  /** Resets filters, the period stays. */
  const reset = useCallback(
    () =>
      setParams(
        (current) =>
          mergeFilterParams(current, withoutFilters(parseFilterState(current, today)), today),
        { replace: true },
      ),
    [setParams, today],
  );

  return { state, update, reset, today };
}
