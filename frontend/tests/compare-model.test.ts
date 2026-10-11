import { describe, expect, it } from 'vitest';
import {
  averageOfCompleteMonths,
  compareCategories,
  sortRows,
  toCategoryMatrix,
  toMonthRows,
} from '../src/features/analytics/model/compare.ts';
import {
  addDays,
  daysBetween,
  daysInMonth,
  monthsEndingAt,
  monthShortLabel,
  monthYearShortLabel,
} from '../src/features/analytics/model/periods.ts';

const point = (period: string, total: number, count = 1, key?: string) => ({
  period,
  total,
  count,
  ...(key ? { key } : {}),
});

describe('toMonthRows', () => {
  const points = [
    point('2026-08-01', 1000, 4),
    point('2026-09-01', 1500, 6),
    point('2026-10-01', 600, 2),
  ];

  it('суммы, расход в день и изменение к предыдущему месяцу', () => {
    const rows = toMonthRows(points, '2026-10-15');

    expect(rows.map((r) => [r.month, r.total, r.change])).toEqual([
      ['2026-08', 1000, null],
      ['2026-09', 1500, 50],
      ['2026-10', 600, null],
    ]);
    expect(rows[0]).toMatchObject({ days: 31, perDay: 1000 / 31, partial: false });
    expect(rows[1]).toMatchObject({ days: 30, perDay: 50 });
  });

  it('у незаконченного месяца изменения к предыдущему нет: сравнивать неполный месяц с целым нельзя', () => {
    expect(toMonthRows(points, '2026-10-15')[2]!.change).toBeNull();
  });

  it('текущий месяц неполный: дни считаются до сегодня', () => {
    const current = toMonthRows(points, '2026-10-15')[2]!;

    expect(current).toMatchObject({ partial: true, days: 15, perDay: 40 });
  });

  it('изменение к нулевому месяцу не определено', () => {
    const rows = toMonthRows([point('2026-08-01', 0, 0), point('2026-09-01', 500)], '2026-10-15');

    expect(rows[1]!.change).toBeNull();
  });

  it('пустой список', () => {
    expect(toMonthRows([], '2026-10-15')).toEqual([]);
  });
});

describe('toCategoryMatrix', () => {
  const months = ['2026-09', '2026-10'];

  it('месяцы × категории, категории от самых затратных', () => {
    const matrix = toCategoryMatrix(
      [
        point('2026-09-01', 100, 1, 'кафе'),
        point('2026-09-01', 900, 1, 'жилье'),
        point('2026-10-01', 300, 1, 'кафе'),
      ],
      months,
    );

    expect(matrix.categories).toEqual(['жилье', 'кафе']);
    expect(matrix.rows).toEqual([
      { month: '2026-09', values: { кафе: 100, жилье: 900 } },
      { month: '2026-10', values: { кафе: 300 } },
    ]);
  });

  it('если категорий больше лимита, хвост объединяется в «Другое»', () => {
    const points = ['а', 'б', 'в', 'г', 'д'].map((key, i) =>
      point('2026-10-01', 100 - i * 10, 1, key),
    );

    const matrix = toCategoryMatrix(points, months, 3);

    expect(matrix.categories).toEqual(['а', 'б', 'Другое']);
    expect(matrix.rows[1]!.values).toEqual({ а: 100, б: 90, Другое: 80 + 70 + 60 });
  });

  it('месяцы вне списка игнорируются, пустые данные дают пустую матрицу', () => {
    expect(toCategoryMatrix([point('2025-01-01', 5, 1, 'x')], months).rows[0]!.values).toEqual({});
    expect(toCategoryMatrix([], months).categories).toEqual([]);
  });
});

describe('compareCategories', () => {
  const row = (key: string, total: number) => ({ key, total, count: 1, average: total });

  it('разница и проценты, сначала самые заметные расхождения', () => {
    const result = compareCategories(
      [row('кафе', 700), row('жилье', 1000), row('новая', 50)],
      [row('кафе', 500), row('жилье', 1000), row('исчезла', 300)],
    );

    expect(result.map((r) => [r.key, r.difference, r.change])).toEqual([
      ['исчезла', -300, -100],
      ['кафе', 200, 40],
      ['новая', 50, null],
      ['жилье', 0, 0],
    ]);
  });

  it('пустые месяцы', () => {
    expect(compareCategories([], [])).toEqual([]);
  });
});

describe('sortRows', () => {
  const rows = [
    { name: 'б', n: 2 as number | null },
    { name: 'а', n: null },
    { name: 'в', n: 5 as number | null },
  ];

  it('по числу в обе стороны, пустые всегда в конце', () => {
    expect(sortRows(rows, (r) => r.n, 'desc').map((r) => r.name)).toEqual(['в', 'б', 'а']);
    expect(sortRows(rows, (r) => r.n, 'asc').map((r) => r.name)).toEqual(['б', 'в', 'а']);
  });

  it('по тексту с учётом русского алфавита; исходный список не меняется', () => {
    expect(sortRows(rows, (r) => r.name, 'asc').map((r) => r.name)).toEqual(['а', 'б', 'в']);
    expect(rows[0]!.name).toBe('б');
  });
});

describe('даты и месяцы', () => {
  it('addDays, daysBetween, daysInMonth', () => {
    expect(addDays('2026-10-15', -29)).toBe('2026-09-16');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-10-01', '2026-10-15')).toBe(15);
    expect(daysBetween('2026-10-02', '2026-10-01')).toBe(0);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29);
  });

  it('monthsEndingAt: от старого к новому, через границу года', () => {
    expect(monthsEndingAt('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthsEndingAt('2026-10', 1)).toEqual(['2026-10']);
  });

  it('короткие подписи месяцев', () => {
    expect(monthShortLabel('2026-10')).toBe('окт');
    expect(monthYearShortLabel('2026-10')).toMatch(/^окт\s*26$/);
  });
});

describe('averageOfCompleteMonths', () => {
  const row = (month: string, total: number, partial = false) => ({
    month,
    total,
    count: 1,
    days: 30,
    perDay: total / 30,
    change: null,
    partial,
  });

  it('среднее по завершённым месяцам, текущий неполный месяц не учитывается', () => {
    const rows = [row('2026-08', 1000), row('2026-09', 2000), row('2026-10', 100, true)];

    expect(averageOfCompleteMonths(rows)).toBe(1500);
  });

  it('пустые месяцы до начала учёта не занижают среднее', () => {
    const rows = [row('2026-06', 0), row('2026-07', 0), row('2026-08', 1000), row('2026-09', 2000)];

    expect(averageOfCompleteMonths(rows)).toBe(1500);
  });

  it('пустой месяц после начала учёта входит в среднее', () => {
    expect(
      averageOfCompleteMonths([row('2026-07', 900), row('2026-08', 0), row('2026-09', 900)]),
    ).toBe(600);
  });

  it('меньше двух завершённых месяцев или нет расходов: среднего нет', () => {
    expect(averageOfCompleteMonths([row('2026-09', 1000), row('2026-10', 500, true)])).toBeNull();
    expect(averageOfCompleteMonths([row('2026-08', 0), row('2026-09', 0)])).toBeNull();
    expect(averageOfCompleteMonths([])).toBeNull();
  });
});
