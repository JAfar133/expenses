import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  harness,
  json,
  ok,
  renderAnalytics,
  setupAnalyticsHarness,
} from './helpers/analytics-harness.tsx';

setupAnalyticsHarness();

const xlsx = () =>
  new Response('xlsx', {
    status: 200,
    headers: { 'Content-Disposition': 'attachment; filename="expenses.xlsx"' },
  });
const exportUrls = () =>
  harness.requests.filter((r) => r.startsWith('/api/expenses/export.xlsx')).map(decodeURIComponent);
const button = () => screen.getByRole('button', { name: 'Скачать Excel' });
let clicks: number;

beforeEach(() => {
  clicks = 0;
  URL.createObjectURL = vi.fn(() => 'blob:report');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
    clicks += 1;
  });
  harness.handlers['/api/expenses'] = () => ok({ items: [], total: 0, totalAmount: 0 });
  harness.handlers['/api/expenses/export.xlsx'] = xlsx;
});

describe('скачивание отчёта на странице анализа', () => {
  it('кнопка есть на всех трёх вкладках, на «Операциях» она одна', async () => {
    const user = renderAnalytics('/analytics');
    expect(await screen.findByRole('button', { name: 'Скачать Excel' })).toHaveAttribute(
      'title',
      'Скачать Excel с текущими фильтрами',
    );

    await user.click(screen.getByRole('link', { name: 'Операции' }));
    await screen.findByRole('heading', { name: 'Операции' });
    expect(screen.getAllByRole('button', { name: 'Скачать Excel' })).toHaveLength(1);

    await user.click(screen.getByRole('link', { name: 'Сравнение месяцев' }));
    await screen.findByRole('heading', { name: 'Сравнение по месяцам' });
    expect(screen.getAllByRole('button', { name: 'Скачать Excel' })).toHaveLength(1);
  });

  it('обзор: отчёт с периодом, активными фильтрами и валютой показа', async () => {
    const user = renderAnalytics(`/analytics?card=${encodeURIComponent('Настя')}&q=кофе`);
    await screen.findByRole('button', { name: 'Скачать Excel' });

    await user.click(button());

    await waitFor(() => expect(exportUrls()).toHaveLength(1));
    const url = new URL(exportUrls()[0]!, 'http://localhost');
    expect(url.pathname).toBe('/api/expenses/export.xlsx');
    expect(url.searchParams.get('from')).toBe('2026-10-01');
    expect(url.searchParams.get('to')).toBe('2026-10-31');
    expect(url.searchParams.getAll('cards')).toEqual(['Настя']);
    expect(url.searchParams.get('q')).toBe('кофе');
    expect(url.searchParams.get('currency')).toBe('AMD');
    expect(url.searchParams.has('limit')).toBe(false);
    expect(url.searchParams.has('sort')).toBe(false);
    await waitFor(() => expect(clicks).toBe(1));
  });

  it('при смене фильтров следующий отчёт строится по новым', async () => {
    const user = renderAnalytics('/analytics');
    await screen.findByRole('button', { name: 'Скачать Excel' });
    await user.click(button());
    await waitFor(() => expect(exportUrls()).toHaveLength(1));
    expect(exportUrls()[0]).not.toContain('cards=');

    await user.click(screen.getByRole('button', { name: /Фильтры/ }));
    await user.click(await screen.findByRole('button', { name: /^Карты:/ }));
    await user.click(await screen.findByRole('checkbox', { name: 'Настя' }));
    await waitFor(() => expect(button()).toBeEnabled());
    await user.click(button());

    await waitFor(() => expect(exportUrls()).toHaveLength(2));
    expect(exportUrls()[1]).toContain('cards=Миша');
  });

  it('сравнение месяцев: период не отправляется, остальные фильтры — да', async () => {
    const user = renderAnalytics(`/analytics/compare?card=${encodeURIComponent('Настя')}`);
    await screen.findByRole('button', { name: 'Скачать Excel' });

    await user.click(button());

    await waitFor(() => expect(exportUrls()).toHaveLength(1));
    const url = new URL(exportUrls()[0]!, 'http://localhost');
    expect(url.searchParams.has('from')).toBe(false);
    expect(url.searchParams.has('to')).toBe(false);
    expect(url.searchParams.getAll('cards')).toEqual(['Настя']);
    expect(url.searchParams.get('currency')).toBe('AMD');
  });

  it('ошибка показывается под панелью фильтров сообщением сервера', async () => {
    harness.handlers['/api/expenses/export.xlsx'] = () =>
      json(
        {
          success: false,
          error: { code: 'EXPORT_TOO_LARGE', message: 'Больше 50 000 операций: сузьте фильтры' },
        },
        422,
      );
    const user = renderAnalytics('/analytics');
    await screen.findByRole('button', { name: 'Скачать Excel' });

    await user.click(button());

    expect(await screen.findByRole('alert')).toHaveTextContent('Больше 50 000 операций');
    expect(clicks).toBe(0);
  });
});
