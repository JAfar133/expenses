import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../src/app/AppShell.tsx';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const user = {
  username: 'misha',
  displayName: 'Миша',
  card: 'Миша',
  canEdit: true,
  timezone: 'Asia/Yerevan',
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      json({
        success: true,
        data: {
          enabled: false,
          queued: 0,
          running: false,
          intervalMs: 1,
          nextRunAt: null,
          serverTime: '',
        },
      }),
    ),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderShell(path: string) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell user={user} />}>
            <Route index element={<p>Страница формы</p>} />
            <Route path="analytics" element={<p>Страница анализа</p>} />
            <Route path="settings" element={<p>Страница настроек</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe('AppShell', () => {
  it('показывает заголовок, навигацию и кто вошёл', () => {
    renderShell('/');

    expect(screen.getByRole('heading', { name: /Мои расходы/ })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Разделы' })).toBeInTheDocument();
    expect(screen.getByText('Вы вошли как', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Страница формы')).toBeInTheDocument();
  });

  it('отмечает текущий раздел и переключает страницы', async () => {
    const person = renderShell('/');
    const form = screen.getByRole('link', { name: 'Добавить' });
    const analysis = screen.getByRole('link', { name: 'Анализ' });
    expect(form).toHaveAttribute('aria-current', 'page');
    expect(analysis).not.toHaveAttribute('aria-current');

    await person.click(analysis);

    expect(await screen.findByText('Страница анализа')).toBeInTheDocument();
    expect(analysis).toHaveAttribute('aria-current', 'page');
    expect(form).not.toHaveAttribute('aria-current');
  });

  it('страница анализа шире страницы формы', () => {
    renderShell('/analytics');

    expect(screen.getByRole('main')).toHaveClass('max-w-5xl');
  });

  it('страница формы остаётся узкой колонкой', () => {
    renderShell('/');

    expect(screen.getByRole('main')).toHaveClass('max-w-[560px]');
  });

  it('рядом с «Выйти» есть ссылка на настройки; страница настроек средней ширины', async () => {
    const person = renderShell('/');

    await person.click(screen.getByRole('link', { name: 'Настройки' }));

    expect(await screen.findByText('Страница настроек')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveClass('max-w-2xl');
  });
});
