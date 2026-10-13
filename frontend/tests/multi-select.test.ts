import { describe, expect, it } from 'vitest';
import {
  checkedValues,
  excludeValue,
  restoreValue,
  selectionSummary,
  toggleValue,
} from '../src/features/analytics/model/multi-select.ts';
import { periodCaption } from '../src/features/analytics/components/PeriodMenu.tsx';
import type { FilterState } from '../src/features/analytics/model/filter-state.ts';

const all = ['a', 'b', 'c'];
const none = { selected: [], excluded: [] };

describe('multi-select', () => {
  it('без выбора отмечены все, кроме исключённых', () => {
    expect(checkedValues(all, none)).toEqual(['a', 'b', 'c']);
    expect(checkedValues(all, { selected: [], excluded: ['b'] })).toEqual(['a', 'c']);
    expect(checkedValues(all, { selected: ['a'], excluded: [] })).toEqual(['a']);
  });

  it('снятие отметки выбирает остальные, возврат всех отметок снимает фильтр', () => {
    const one = toggleValue(all, none, 'c');
    expect(one).toEqual({ selected: ['a', 'b'], excluded: [] });
    expect(toggleValue(all, one, 'c')).toEqual(none);
  });

  it('последнюю отметку снять нельзя', () => {
    const current = { selected: ['a'], excluded: [] };
    expect(toggleValue(all, current, 'a')).toBe(current);
  });

  it('исключённые значения не мешают считать «все отмечены»', () => {
    const current = { selected: ['a'], excluded: ['c'] };
    expect(toggleValue(all, current, 'b')).toEqual({ selected: [], excluded: ['c'] });
  });

  it('исключение убирает значение из выбора, возврат возвращает его в нейтральное состояние', () => {
    const excluded = excludeValue({ selected: ['a', 'b'], excluded: [] }, 'a');
    expect(excluded).toEqual({ selected: ['b'], excluded: ['a'] });
    expect(restoreValue(excluded, 'a')).toEqual({ selected: ['b'], excluded: [] });
  });

  it('сводка на кнопке', () => {
    const options = all.map((value) => ({ value, label: value.toUpperCase() }));
    expect(selectionSummary(options, none, 'Все')).toBe('Все');
    expect(selectionSummary(options, { selected: ['a'], excluded: [] }, 'Все')).toBe('A');
    expect(selectionSummary(options, { selected: ['a', 'b'], excluded: [] }, 'Все')).toBe('2 из 3');
    expect(selectionSummary(options, { selected: [], excluded: ['b', 'c'] }, 'Все')).toBe(
      'кроме: B, C',
    );
  });
});

describe('periodCaption', () => {
  const state = { period: 'month', month: '2026-10' } as FilterState;

  it('месяц, пресеты и свой период', () => {
    expect(periodCaption(state)).toBe('Октябрь 2026');
    expect(periodCaption({ ...state, period: '30d' })).toBe('30 дней');
    expect(periodCaption({ ...state, period: 'all' })).toBe('Всё время');
    expect(periodCaption({ ...state, period: 'custom' }, '2026-10-05', '2026-10-12')).toBe(
      '05.10.2026 – 12.10.2026',
    );
  });
});
