import { describe, expect, it } from 'vitest';
import { toSearch } from '../src/features/analytics/api/analytics.api.ts';
import {
  assignColors,
  changePercent,
  compactNumber,
  cumulative,
  seriesColor,
  toSlices,
} from '../src/features/analytics/model/chart-data.ts';
import {
  dayLabel,
  dayOfMonth,
  isMonthKey,
  monthLabel,
  monthOf,
  monthRange,
  shiftMonth,
} from '../src/features/analytics/model/periods.ts';

describe('periods', () => {
  it('monthRange: первый и последний день, в том числе високосный февраль', () => {
    expect(monthRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2026-04').to).toBe('2026-04-30');
  });

  it('shiftMonth переходит через границу года', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-10', 0)).toBe('2026-10');
    expect(shiftMonth('2026-03', -14)).toBe('2025-01');
  });

  it('isMonthKey принимает только ГГГГ-ММ', () => {
    expect(isMonthKey('2026-10')).toBe(true);
    for (const bad of [null, '', '2026-13', '2026-00', '26-10', '2026-1', 'abc']) {
      expect(isMonthKey(bad)).toBe(false);
    }
  });

  it('подписи: месяц, день, число', () => {
    expect(monthLabel('2026-10')).toBe('Октябрь 2026');
    expect(dayLabel('2026-10-10')).toBe('суббота, 10 октября');
    expect(dayOfMonth('2026-10-05')).toBe('5');
    expect(monthOf('2026-10-15')).toBe('2026-10');
  });
});

describe('toSearch', () => {
  it('списки повторяются, пустые значения пропускаются', () => {
    expect(
      toSearch(
        {
          from: '2026-10-01',
          cards: ['Миша', 'Настя'],
          categories: [],
          q: '',
          includeDeleted: false,
        },
        { by: 'category' },
      ),
    ).toBe(
      '?from=2026-10-01&cards=%D0%9C%D0%B8%D1%88%D0%B0&cards=%D0%9D%D0%B0%D1%81%D1%82%D1%8F&by=category',
    );
  });

  it('без параметров пустая строка; число и true передаются', () => {
    expect(toSearch({})).toBe('');
    expect(toSearch({ minAmount: 0, includeDeleted: true })).toBe(
      '?minAmount=0&includeDeleted=true',
    );
  });
});

const row = (key: string, total: number, count = 1) => ({
  key,
  total,
  count,
  average: total / count,
});

describe('toSlices', () => {
  it('до семи групп остаются как есть, с долями', () => {
    const slices = toSlices([row('кафе', 750), row('продукты', 250)]);

    expect(slices.map((s) => [s.key, s.share])).toEqual([
      ['кафе', 0.75],
      ['продукты', 0.25],
    ]);
    expect(slices.some((s) => s.isOther)).toBe(false);
  });

  it('если групп больше семи, хвост объединяется в «Другое»', () => {
    const rows = Array.from({ length: 9 }, (_, i) => row(`к${i}`, 100 - i * 10, 2));

    const slices = toSlices(rows);

    expect(slices).toHaveLength(7);
    const other = slices.at(-1)!;
    expect(other).toMatchObject({ key: 'Другое', isOther: true });
    // Суммы: 100, 90, … 20. Шесть крупных отдельно, остальные три (40 + 30 + 20) вместе
    expect(other.total).toBe(90);
    expect(other.count).toBe(6);
    expect(slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
  });

  it('пустой список и нулевая сумма дают пустой результат', () => {
    expect(toSlices([])).toEqual([]);
    expect(toSlices([row('x', 0)])).toEqual([]);
  });
});

describe('cumulative', () => {
  it('нарастающий итог по суммам и операциям', () => {
    const points = [
      { period: '2026-10-01', total: 100, count: 1 },
      { period: '2026-10-02', total: 0, count: 0 },
      { period: '2026-10-03', total: 50, count: 2 },
    ];

    expect(cumulative(points).map((p) => [p.total, p.count])).toEqual([
      [100, 1],
      [100, 1],
      [150, 3],
    ]);
    expect(points[0]!.total).toBe(100); // исходные данные не меняются
  });
});

describe('changePercent', () => {
  it('считает изменение в процентах', () => {
    expect(changePercent(150, 100)).toBe(50);
    expect(changePercent(50, 100)).toBe(-50);
    expect(changePercent(100, 100)).toBe(0);
  });

  it('не с чем сравнивать: null', () => {
    expect(changePercent(100, undefined)).toBeNull();
    expect(changePercent(100, 0)).toBeNull();
  });
});

describe('assignColors', () => {
  const order = ['кафе', 'одежда', 'продукты', 'жилье'];

  it('цвет закреплён за категорией, а не за местом в рейтинге', () => {
    const top = assignColors(['продукты', 'кафе'], order);
    const other = assignColors(['кафе', 'жилье', 'продукты'], order);

    expect(top.get('кафе')).toBe(0);
    expect(top.get('продукты')).toBe(2);
    expect(other.get('кафе')).toBe(0);
    expect(other.get('продукты')).toBe(2);
    expect(other.get('жилье')).toBe(3);
  });

  it('категориям не из справочника достаются свободные слоты', () => {
    const colors = assignColors(['новая', 'кафе'], order);

    expect(colors.get('кафе')).toBe(0);
    expect(colors.get('новая')).toBe(1);
  });

  it('слоты не повторяются; когда они кончились, цвет нейтральный', () => {
    const keys = Array.from({ length: 9 }, (_, i) => `категория ${i}`);

    const colors = assignColors(keys, []);

    const slots = [...colors.values()].filter((slot) => slot !== null);
    expect(new Set(slots).size).toBe(7);
    expect([...colors.values()].filter((slot) => slot === null)).toHaveLength(2);
  });

  it('seriesColor: слот или нейтральный', () => {
    expect(seriesColor(0)).toBe('var(--series-1)');
    expect(seriesColor(6)).toBe('var(--series-7)');
    expect(seriesColor(null)).toBe('var(--chart-other)');
  });
});

describe('compactNumber', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1K'],
    [1500, '1,5K'],
    [25_000, '25K'],
    [1_200_000, '1,2M'],
  ])('%s → %s', (value, expected) => {
    expect(compactNumber(value)).toBe(expected);
  });
});
