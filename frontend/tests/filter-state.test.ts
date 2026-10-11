import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  granularityFor,
  parseFilterState,
  periodRange,
  serializeFilterState,
  toApiFilters,
  withoutFilters,
} from '../src/features/analytics/model/filter-state.ts';

const TODAY = '2026-10-15';
const parse = (query: string) => parseFilterState(new URLSearchParams(query), TODAY);

describe('parseFilterState', () => {
  it('без параметров: текущий месяц и никаких фильтров', () => {
    expect(parse('')).toEqual({
      period: 'month',
      month: '2026-10',
      from: undefined,
      to: undefined,
      cards: [],
      categories: [],
      createdBy: [],
      currencies: [],
      q: '',
      minAmount: undefined,
      maxAmount: undefined,
      includeDeleted: false,
    });
  });

  it('читает все фильтры', () => {
    const state = parse(
      'period=90d&card=Миша&card=Настя&category=кафе&by=nastya&cur=USD&q=латте&min=100&max=900&deleted=1',
    );

    expect(state).toMatchObject({
      period: '90d',
      cards: ['Миша', 'Настя'],
      categories: ['кафе'],
      createdBy: ['nastya'],
      currencies: ['USD'],
      q: 'латте',
      minAmount: 100,
      maxAmount: 900,
      includeDeleted: true,
    });
  });

  it('месяц: прошлый принимается, будущий и некорректный заменяются текущим', () => {
    expect(parse('month=2026-08').month).toBe('2026-08');
    expect(parse('month=2099-01').month).toBe('2026-10');
    expect(parse('month=2026-13').month).toBe('2026-10');
    expect(parse('month=abc').month).toBe('2026-10');
  });

  it('неизвестный период заменяется месяцем', () => {
    expect(parse('period=decade').period).toBe('month');
  });

  it('свой период: границы читаются, даты проверяются', () => {
    expect(parse('period=custom&from=2026-09-01&to=2026-09-30')).toMatchObject({
      period: 'custom',
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(parse('period=custom&from=2026-09-01')).toMatchObject({
      period: 'custom',
      to: undefined,
    });
  });

  it.each([
    ['без границ', 'period=custom'],
    ['перепутаны границы', 'period=custom&from=2026-09-30&to=2026-09-01'],
    ['даты не в формате', 'period=custom&from=вчера&to=сегодня'],
    ['несуществующая дата', 'period=custom&from=2026-02-31&to=2026-03-01x'],
  ])('свой период %s: возвращаемся к месяцу', (_title, query) => {
    expect(parse(query).period).toBe('month');
  });

  it('границы вне своего периода игнорируются', () => {
    expect(parse('period=30d&from=2026-09-01')).toMatchObject({ period: '30d', from: undefined });
  });

  it('повторы убираются, пустые значения пропускаются', () => {
    expect(parse('card=Миша&card=Миша&card=').cards).toEqual(['Миша']);
  });

  it('суммы: только целые неотрицательные; максимум меньше минимума отбрасывается', () => {
    expect(parse('min=abc&max=-5')).toMatchObject({ minAmount: undefined, maxAmount: undefined });
    expect(parse('min=500&max=100')).toMatchObject({ minAmount: 500, maxAmount: undefined });
    expect(parse('min=0')).toMatchObject({ minAmount: 0 });
    expect(parse('max=99999999999')).toMatchObject({ maxAmount: undefined });
  });

  it('поиск обрезается до 100 символов', () => {
    expect(parse(`q=${'я'.repeat(300)}`).q).toHaveLength(100);
  });
});

describe('serializeFilterState', () => {
  it('значения по умолчанию в адрес не попадают', () => {
    expect(serializeFilterState(parse(''), TODAY).toString()).toBe('');
    expect(serializeFilterState(parse('month=2026-10'), TODAY).toString()).toBe('');
  });

  it('разбор и запись обратимы', () => {
    const query =
      'period=custom&from=2026-09-01&to=2026-09-30&card=Миша&category=кафе&by=nastya&cur=USD&q=латте&min=100&max=900&deleted=1';
    const state = parse(query);

    expect(parseFilterState(serializeFilterState(state, TODAY), TODAY)).toEqual(state);
  });

  it('прошлый месяц пишется, текущий нет', () => {
    expect(serializeFilterState(parse('month=2026-08'), TODAY).toString()).toBe('month=2026-08');
  });
});

describe('periodRange и toApiFilters', () => {
  it.each([
    ['', { from: '2026-10-01', to: '2026-10-31' }],
    ['month=2026-02', { from: '2026-02-01', to: '2026-02-28' }],
    ['period=30d', { from: '2026-09-16', to: '2026-10-15' }],
    ['period=90d', { from: '2026-07-18', to: '2026-10-15' }],
    ['period=year', { from: '2026-01-01', to: '2026-12-31' }],
    ['period=all', {}],
    ['period=custom&from=2026-09-01', { from: '2026-09-01', to: undefined }],
  ])('%s', (query, expected) => {
    expect(periodRange(parse(query), TODAY)).toEqual(expected);
  });

  it('для запросов: фильтры без пустых значений, период по желанию', () => {
    const state = parse('period=30d&card=Миша&q=кофе&min=0');

    expect(toApiFilters(state, TODAY)).toMatchObject({
      from: '2026-09-16',
      to: '2026-10-15',
      cards: ['Миша'],
      q: 'кофе',
      minAmount: 0,
    });
    expect(toApiFilters(state, TODAY, false)).not.toHaveProperty('from');
    expect(toApiFilters(parse(''), TODAY).q).toBeUndefined();
  });
});

describe('granularityFor', () => {
  it.each([
    ['', 'day'],
    ['period=30d', 'day'],
    ['period=90d', 'week'],
    ['period=year', 'week'],
    ['period=all', 'month'],
    ['period=custom&from=2024-01-01&to=2026-10-01', 'month'],
    ['period=custom&from=2026-10-10&to=2026-10-12', 'day'],
  ])('%s → %s', (query, expected) => {
    expect(granularityFor(parse(query), TODAY)).toBe(expected);
  });
});

describe('activeFilterCount и withoutFilters', () => {
  it('считает включённые фильтры, период не считается', () => {
    expect(activeFilterCount(parse('period=90d'))).toBe(0);
    expect(activeFilterCount(parse('card=Миша&card=Настя&q=x&min=1&deleted=1'))).toBe(4);
  });

  it('сброс убирает фильтры, но оставляет период', () => {
    const cleared = withoutFilters(parse('month=2026-08&card=Миша&q=x'));

    expect(activeFilterCount(cleared)).toBe(0);
    expect(cleared.month).toBe('2026-08');
  });
});
