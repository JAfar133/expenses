import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { OperationItem } from '../src/features/analytics/api/operations.api.ts';
import { dayWords, groupByDate, recordsLabel } from '../src/features/analytics/model/operations.ts';
import { shortCaption } from '../src/features/analytics/components/PeriodMenu.tsx';
import {
  harness,
  ok,
  renderAnalytics,
  setupAnalyticsHarness,
} from './helpers/analytics-harness.tsx';

setupAnalyticsHarness();

const op = (n: number, patch: Partial<OperationItem> = {}): OperationItem => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  date: '2026-10-10',
  card: 'Миша',
  category: 'кафе',
  name: `Покупка ${n}`,
  amount: 1000 * n,
  currency: 'AMD',
  original: null,
  editable: true,
  editableUntil: null,
  createdBy: 'misha',
  source: 'app',
  excelState: 'synced',
  excelError: null,
  deletedAt: null,
  deletedReason: null,
  updatedBy: null,
  ...patch,
});

function serve(items: OperationItem[], days?: { period: string; total: number; count: number }[]) {
  harness.handlers['/api/expenses'] = () =>
    ok({ items, total: items.length, totalAmount: items.reduce((s, i) => s + i.amount, 0) });
  harness.handlers['/api/analytics/timeseries'] = () => ok(days ?? []);
}

const cards = () => screen.getByRole('list', { name: 'Операции' });
const loaded = () => screen.findByRole('list', { name: 'Операции' });
const dayTimeseries = () =>
  harness.requests.filter(
    (r) => r.startsWith('/api/analytics/timeseries') && r.includes('granularity=day'),
  );

describe('чистые функции мобильного списка', () => {
  it('дата словами и «запись» по-русски', () => {
    expect(dayWords('2026-10-13')).toBe('13 октября 2026');
    expect(dayWords('2026-01-05')).toBe('5 января 2026');
    expect([1, 2, 5, 11, 68].map(recordsLabel)).toEqual([
      '1 запись',
      '2 записи',
      '5 записей',
      '11 записей',
      '68 записей',
    ]);
  });

  it('группы — подряд идущие записи одной даты', () => {
    const groups = groupByDate([{ date: 'a' }, { date: 'a' }, { date: 'b' }, { date: 'a' }]);

    expect(groups.map((g) => [g.date, g.items.length])).toEqual([
      ['a', 2],
      ['b', 1],
      ['a', 1],
    ]);
  });

  it('короткий период для узкого экрана', () => {
    expect(shortCaption('Октябрь 2026')).toBe('Окт2026'.replace('Окт2026', 'Окт 2026'));
    expect(shortCaption('30 дней')).toBe('30 дней');
  });
});

describe('мобильный список операций', () => {
  it('заголовок «Операции» и под ним «N записей · сумма»', async () => {
    serve([op(1), op(2)]);
    renderAnalytics('/analytics/operations');

    expect(await screen.findByRole('heading', { name: 'Операции' })).toBeInTheDocument();
    expect(await screen.findByText('2 записи · 3 000 AMD')).toBeInTheDocument();
  });

  it('группировка по дням: плашка «дата словами · сумма за день» из timeseries по дням', async () => {
    serve(
      [op(1, { date: '2026-10-10' }), op(2, { date: '2026-10-10' }), op(3, { date: '2026-10-09' })],
      [
        { period: '2026-10-10', total: 16620, count: 7 },
        { period: '2026-10-09', total: 500, count: 1 },
      ],
    );
    renderAnalytics('/analytics/operations');

    expect(
      await within(await loaded()).findByRole('heading', { name: '10 октября 2026 · 16 620 AMD' }),
    ).toBeInTheDocument();
    expect(
      within(cards()).getByRole('heading', { name: '9 октября 2026 · 500 AMD' }),
    ).toBeInTheDocument();
    // The totals are the whole days from the daily series, with the same currency
    expect(dayTimeseries().at(-1)).toContain('currency=AMD');
    expect(within(cards()).getAllByRole('heading')).toHaveLength(2);
  });

  it('нет данных за день: плашка с датой без суммы', async () => {
    serve([op(1, { date: '2026-10-10' })], []);
    renderAnalytics('/analytics/operations');

    expect(
      await within(await loaded()).findByRole('heading', { name: '10 октября 2026' }),
    ).toBeInTheDocument();
  });

  it('другая сортировка: плоский список без плашек, дата в строке, запроса по дням нет', async () => {
    serve([op(1, { date: '2026-10-10' })], [{ period: '2026-10-10', total: 1000, count: 1 }]);
    renderAnalytics('/analytics/operations?sort=amount&dir=desc');
    await waitFor(() => expect(within(cards()).getAllByRole('listitem').length).toBeGreaterThan(0));

    expect(within(cards()).queryByRole('heading')).toBeNull();
    expect(within(cards()).getByText(/10\.10\.2026 · Кафе · Миша/)).toBeInTheDocument();
    expect(dayTimeseries()).toHaveLength(0);
  });

  it('вторая строка: «Категория · Карта» с заглавной буквы', async () => {
    serve([op(1)]);
    renderAnalytics('/analytics/operations');

    expect(await within(await loaded()).findByText('Кафе · Миша')).toBeInTheDocument();
  });

  it('запись из Excel: вместо карты «Из Excel»', async () => {
    serve([op(1, { source: 'excel' })]);
    renderAnalytics('/analytics/operations');

    expect(await within(await loaded()).findByText('Кафе · Из Excel')).toBeInTheDocument();
  });

  it('автор добавляется только если он не текущий пользователь', async () => {
    serve([op(1), op(2, { createdBy: 'nastya' })]);
    renderAnalytics('/analytics/operations');

    expect(await within(await loaded()).findByText('Кафе · Миша · Настя')).toBeInTheDocument();
    expect(within(cards()).getByText('Кафе · Миша')).toBeInTheDocument();
  });

  it('удалённая запись приглушена и зачёркнута', async () => {
    serve([
      op(1, { deletedAt: '2026-10-11T10:00:00.000Z', deletedReason: 'app', editable: false }),
    ]);
    renderAnalytics('/analytics/operations?deleted=1');

    const item = (await within(await loaded()).findByText('Покупка 1')).closest('li')!;
    expect(item.className).toContain('opacity-70');
    expect(within(item).getByText('Покупка 1').parentElement!.className).toContain('line-through');
  });

  it('у строки меню «⋯» и сумма жирным', async () => {
    serve([op(1)]);
    renderAnalytics('/analytics/operations');

    const item = (await within(await loaded()).findByText('Покупка 1')).closest('li')!;
    expect(within(item).getByRole('button', { name: 'Действия' })).toBeInTheDocument();
    expect(within(item).getByText('1 000 AMD').className).toContain('font-semibold');
  });
});

describe('шапка вкладки «Операции» в одну строку', () => {
  it('‹ период › фильтры и скачивание в одном ряду', async () => {
    serve([op(1)]);
    renderAnalytics('/analytics/operations');
    const prev = await screen.findByRole('button', { name: 'Предыдущий месяц' });

    const row = prev.closest('section')!.firstElementChild as HTMLElement;
    expect(row.className).not.toContain('flex-col');
    for (const name of [/^Период:/, 'Следующий месяц', /^Фильтры/, 'Скачать Excel']) {
      expect(within(row).getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('на узкой ширине период короткий («Окт 2026»), полное название остаётся в aria-label', async () => {
    serve([op(1)]);
    renderAnalytics('/analytics/operations');

    const period = await screen.findByRole('button', { name: 'Период: Октябрь 2026' });

    expect(within(period).getByText('Окт 2026')).toBeInTheDocument();
    expect(within(period).getByText('Октябрь 2026')).toBeInTheDocument();
  });
});

describe('шапка на узкой ширине', () => {
  it('период целиком в DOM («Окт 2026»), без усечения, с минимальной шириной', async () => {
    serve([op(1)]);
    renderAnalytics('/analytics/operations');

    const period = await screen.findByRole('button', { name: 'Период: Октябрь 2026' });

    const short = within(period).getByText('Окт 2026');
    expect(short.className).not.toContain('truncate');
    expect(period.className).toContain('min-w-[6.75rem]');
    expect(period.className).toContain('whitespace-nowrap');
  });

  it('стрелки ‹ и › уже (36px) и одинаковые', async () => {
    serve([op(1)]);
    renderAnalytics('/analytics/operations');

    const prev = await screen.findByRole('button', { name: 'Предыдущий месяц' });
    const next = screen.getByRole('button', { name: 'Следующий месяц' });

    expect(prev.className).toContain('size-9');
    expect(next.className).toBe(prev.className);
  });

  it('«Фильтры»: aria-label сохранён, текст виден от 420px, на узкой остаётся иконка', async () => {
    serve([op(1)]);
    renderAnalytics('/analytics/operations');

    const filters = await screen.findByRole('button', { name: 'Фильтры' });

    const label = within(filters).getByText('Фильтры');
    expect(label.className).toContain('hidden');
    expect(label.className).toContain('min-[420px]:inline');
    expect(filters.querySelector('svg')).not.toBeNull();
  });

  it('счётчик активных фильтров остаётся рядом с иконкой и входит в имя кнопки', async () => {
    serve([op(1)]);
    renderAnalytics('/analytics/operations?q=кофе&deleted=1');

    const filters = await screen.findByRole('button', { name: 'Фильтры · 2' });

    expect(filters).toHaveTextContent('2');
  });

  it('скачивание — иконка 40px на узкой ширине', async () => {
    serve([op(1)]);
    renderAnalytics('/analytics/operations');

    const download = await screen.findByRole('button', { name: 'Скачать Excel' });

    expect(download.className).toContain('size-10');
  });
});
