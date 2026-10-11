import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { pickDrillCategory, toNameShares } from '../src/features/analytics/model/drill.ts';
import {
  harness,
  ok,
  renderAnalytics,
  setupAnalyticsHarness,
} from './helpers/analytics-harness.tsx';

setupAnalyticsHarness();

const row = (key: string, total: number, count = 1) => ({
  key,
  total,
  count,
  average: total / count,
});

describe('pickDrillCategory', () => {
  const categories = [row('кафе', 1500), row('продукты', 600)];

  it('запрошенная категория, если она есть', () => {
    expect(pickDrillCategory('продукты', categories)).toBe('продукты');
  });

  it('иначе самая затратная', () => {
    expect(pickDrillCategory(null, categories)).toBe('кафе');
    expect(pickDrillCategory('нет такой', categories)).toBe('кафе');
  });

  it('нет категорий: нечего показывать', () => {
    expect(pickDrillCategory('кафе', [])).toBeUndefined();
  });
});

describe('toNameShares', () => {
  it('доли берутся от суммы категории, полосы от самого крупного наименования', () => {
    const shares = toNameShares([row('Латте', 900), row('Эспрессо', 300)], 1500);

    expect(shares.map((s) => [s.key, s.share, s.relative])).toEqual([
      ['Латте', 0.6, 1],
      ['Эспрессо', 0.2, 300 / 900],
    ]);
  });

  it('нулевая сумма категории и пустой список не дают деления на ноль', () => {
    expect(toNameShares([row('x', 0)], 0)[0]).toMatchObject({ share: 0, relative: 0 });
    expect(toNameShares([], 100)).toEqual([]);
  });
});

const names = () => screen.getByRole('list', { name: /^Наименования в категории/ });
const nameRows = () => within(names()).getAllByRole('listitem');
const nameRequests = () => harness.requests.filter((r) => r.includes('by=name'));

describe('наименования в категории', () => {
  it('по умолчанию открыта самая затратная категория: наименования от самых затратных', async () => {
    renderAnalytics();

    await screen.findByRole('list', { name: 'Наименования в категории кафе' });

    expect(nameRows().map((r) => r.querySelector('span')?.textContent)).toEqual([
      'Латте',
      'Эспрессо',
    ]);
    expect(nameRows()[0]).toHaveTextContent('900');
    // Доля от суммы категории: 900 из 1 500
    expect(nameRows()[0]).toHaveTextContent('60%');
    expect(nameRows()[0]).toHaveTextContent('2×');
    expect(screen.getByText('кафе', { selector: 'strong' }).closest('p')).toHaveTextContent(
      '1 500 AMD',
    );
  });

  it('запрашивает наименования выбранной категории за выбранный период', async () => {
    renderAnalytics();

    await waitFor(() => expect(nameRequests().length).toBeGreaterThan(0));

    expect(decodeURIComponent(nameRequests()[0]!)).toBe(
      '/api/analytics/breakdown?from=2026-10-01&to=2026-10-31&categories=кафе&by=name',
    );
  });

  it('выбор другой категории меняет список и адрес', async () => {
    const user = renderAnalytics();
    const group = await screen.findByRole('radiogroup', { name: 'Категория' });

    await user.click(within(group).getByRole('radio', { name: 'продукты' }));

    expect(
      await screen.findByRole('list', { name: 'Наименования в категории продукты' }),
    ).toBeInTheDocument();
    expect(nameRows().map((r) => r.querySelector('span')?.textContent)).toEqual(['Хлеб']);
    expect(screen.getByTestId('location')).toHaveTextContent('drill=');
    expect(within(group).getByRole('radio', { name: 'продукты' })).toBeChecked();
  });

  it('категория из адреса открывается сразу', async () => {
    renderAnalytics(`/analytics?drill=${encodeURIComponent('продукты')}`);

    expect(
      await screen.findByRole('list', { name: 'Наименования в категории продукты' }),
    ).toBeInTheDocument();
  });

  it('неизвестная категория в адресе заменяется самой затратной', async () => {
    renderAnalytics('/analytics?drill=нет');

    expect(
      await screen.findByRole('list', { name: 'Наименования в категории кафе' }),
    ).toBeInTheDocument();
  });

  it('нажатие на категорию в кольце открывает её наименования', async () => {
    localStorage.setItem('analytics.category.type', 'donut');
    const user = renderAnalytics();

    await user.click(
      await screen.findByRole('button', { name: 'продукты: показать наименования' }),
    );

    expect(
      await screen.findByRole('list', { name: 'Наименования в категории продукты' }),
    ).toBeInTheDocument();
  });

  it('фильтры периода и карт применяются и к наименованиям', async () => {
    renderAnalytics('/analytics?month=2026-09&card=Миша');

    await waitFor(() => expect(nameRequests().length).toBeGreaterThan(0));

    const request = decodeURIComponent(nameRequests()[0]!);
    expect(request).toContain('from=2026-09-01&to=2026-09-30');
    expect(request).toContain('cards=Миша');
    expect(request).toContain('categories=кафе');
  });

  it('если категория уже выбрана в фильтре, наименования только из неё', async () => {
    renderAnalytics(`/analytics?category=${encodeURIComponent('продукты')}`);

    await screen.findByRole('list', { name: 'Наименования в категории кафе' }).catch(() => null);

    await waitFor(() => expect(nameRequests().length).toBeGreaterThan(0));
    expect(decodeURIComponent(nameRequests().at(-1)!)).toContain('categories=кафе');
  });

  it('больше десяти наименований: остальные раскрываются кнопкой', async () => {
    const many = Array.from({ length: 14 }, (_, i) => row(`Позиция ${i + 1}`, 140 - i * 10));
    harness.handlers['/api/analytics/breakdown'] = (url) => {
      const by = url.searchParams.get('by');
      if (by === 'name') return ok(many);
      return ok([{ key: 'кафе', total: 1500, count: 14, average: 100 }]);
    };
    const user = renderAnalytics();
    await screen.findByRole('list', { name: 'Наименования в категории кафе' });
    expect(nameRows()).toHaveLength(10);

    await user.click(screen.getByRole('button', { name: 'Показать все (14)' }));

    expect(nameRows()).toHaveLength(14);
    await user.click(screen.getByRole('button', { name: 'Свернуть' }));
    expect(nameRows()).toHaveLength(10);
  });

  it('категория без расходов: сообщение', async () => {
    harness.handlers['/api/analytics/breakdown'] = (url) =>
      url.searchParams.get('by') === 'name' ? ok([]) : ok([row('кафе', 100)]);
    renderAnalytics();

    expect(await screen.findByText('В этой категории нет расходов')).toBeInTheDocument();
  });

  it('нет расходов за период: наименований нет, запрос не отправляется', async () => {
    harness.handlers['/api/analytics/breakdown'] = () => ok([]);
    renderAnalytics();

    expect(await screen.findAllByText('За выбранный период расходов нет')).not.toHaveLength(0);
    expect(nameRequests()).toHaveLength(0);
  });
});
