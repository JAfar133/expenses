import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/features/auth/api/auth.api.ts';
import { AppShell } from '../src/app/AppShell.tsx';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const user: AuthUser = {
  username: 'misha',
  displayName: 'Миша',
  card: 'Миша',
  canEdit: true,
  role: 'member',
  isAdmin: false,
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

function renderShell(path: string, current: AuthUser = user) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell user={current} />}>
            <Route index element={<p>Страница формы</p>} />
            <Route path="analytics" element={<p>Страница анализа</p>} />
            <Route path="settings" element={<p>Страница настроек</p>} />
            <Route path="group" element={<p>Страница группы</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

describe('AppShell', () => {
  it('показывает заголовок, навигацию и меню пользователя', () => {
    renderShell('/');

    expect(screen.getByRole('heading', { name: /Мои расходы/ })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Разделы' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Меню пользователя: Миша' })).toBeInTheDocument();
    expect(screen.queryByText('Вы вошли как', { exact: false })).toBeNull();
    expect(screen.getByText('Страница формы')).toBeInTheDocument();
  });

  it('отмечает текущий раздел и переключает страницы', async () => {
    const person = renderShell('/');
    const form = within(screen.getByRole('navigation', { name: 'Разделы' })).getByRole('link', {
      name: 'Добавить',
    });
    const analysis = within(screen.getByRole('navigation', { name: 'Разделы' })).getByRole('link', {
      name: 'Аналитика',
    });
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

  it('страница группы шире настроек: max-w-3xl, настройки остаются max-w-2xl', () => {
    renderShell('/group');
    expect(screen.getByRole('main')).toHaveClass('max-w-3xl');
  });

  it('страница формы остаётся узкой колонкой', () => {
    renderShell('/');

    expect(screen.getByRole('main')).toHaveClass('max-w-[560px]');
  });

  it('«Добавить» — заметная кнопка, «Аналитика» — текст; активная аналитика с линией, не закрашена', async () => {
    const person = renderShell('/');
    const add = within(screen.getByRole('navigation', { name: 'Разделы' })).getByRole('link', {
      name: 'Добавить',
    });
    const analytics = within(screen.getByRole('navigation', { name: 'Разделы' })).getByRole(
      'link',
      { name: 'Аналитика' },
    );
    // On its own page the main button turns into a soft pill: the user sees where they are
    expect(add).toHaveClass('bg-indigo-100', 'text-indigo-700');
    expect(add).not.toHaveClass('bg-indigo-600');
    expect(analytics).not.toHaveClass('bg-indigo-600');
    expect(analytics).toHaveClass('border-transparent');

    await person.click(analytics);

    expect(analytics).toHaveClass('border-indigo-600', 'text-indigo-700');
    expect(analytics).not.toHaveClass('bg-indigo-600');
    // Elsewhere «Добавить» is the filled call to action
    expect(add).toHaveClass('bg-indigo-600', 'text-white');
  });

  it('навигация одна и стоит в шапке рядом с названием (на телефоне уходит на вторую строку)', () => {
    renderShell('/');

    const nav = screen.getByRole('navigation', { name: 'Разделы' });
    expect(nav.closest('header')).toContainElement(
      screen.getByRole('heading', { name: /Мои расходы/ }),
    );
    expect(nav).toHaveClass('w-full', 'sm:w-auto');
  });

  describe('меню пользователя', () => {
    const open = async (person: ReturnType<typeof userEvent.setup>) => {
      await person.click(screen.getByRole('button', { name: /Меню пользователя/ }));
      return screen.getByRole('menu');
    };
    const items = () => screen.getAllByRole('menuitem').map((item) => item.textContent?.trim());

    it('закрыто по умолчанию; открывается кликом, закрывается повторным кликом', async () => {
      const person = renderShell('/');
      const button = screen.getByRole('button', { name: /Меню пользователя/ });
      expect(button).toHaveAttribute('aria-haspopup', 'menu');
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('menu')).toBeNull();

      await person.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('menu')).toBeInTheDocument();

      await person.click(button);
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('Escape закрывает меню и возвращает фокус на кнопку', async () => {
      const person = renderShell('/');
      const button = screen.getByRole('button', { name: /Меню пользователя/ });
      await open(person);

      await person.keyboard('{Escape}');

      expect(screen.queryByRole('menu')).toBeNull();
      expect(button).toHaveFocus();
    });

    it('клик вне меню закрывает его', async () => {
      const person = renderShell('/');
      await open(person);

      await person.click(screen.getByText('Страница формы'));

      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('смена маршрута закрывает меню', async () => {
      const person = renderShell('/');
      await open(person);

      await person.click(screen.getByRole('menuitem', { name: 'Настройки' }));

      expect(await screen.findByText('Страница настроек')).toBeInTheDocument();
      expect(screen.queryByRole('menu')).toBeNull();
      expect(screen.getByRole('main')).toHaveClass('max-w-2xl');
    });

    it('участник: имя, роль «Участник», только «Настройки» и «Выйти»', async () => {
      const person = renderShell('/');
      const menu = await open(person);

      expect(within(menu).getByText('Миша')).toBeInTheDocument();
      expect(within(menu).getByText('Участник')).toBeInTheDocument();
      expect(items()).toEqual(['Настройки', 'Выйти']);
    });

    it('владелец: «Управление группой» ведёт на /group, роль «Владелец», «Админ» нет', async () => {
      const person = renderShell('/', { ...user, role: 'owner' });
      const menu = await open(person);

      expect(within(menu).getByText('Владелец')).toBeInTheDocument();
      expect(items()).toEqual(['Управление группой', 'Настройки', 'Выйти']);
      expect(screen.getByRole('menuitem', { name: 'Управление группой' })).toHaveAttribute(
        'href',
        '/group',
      );
    });

    it('администратор: «Админ» ведёт на /admin, роль «Администратор», группы нет', async () => {
      const person = renderShell('/', { ...user, isAdmin: true });
      const menu = await open(person);

      expect(within(menu).getByText('Администратор')).toBeInTheDocument();
      expect(items()).toEqual(['Админ', 'Настройки', 'Выйти']);
      expect(screen.getByRole('menuitem', { name: 'Админ' })).toHaveAttribute('href', '/admin');
    });

    it('при открытии фокус на первом пункте; стрелки переходят по пунктам', async () => {
      const person = renderShell('/', { ...user, role: 'owner' });
      await open(person);
      expect(screen.getByRole('menuitem', { name: 'Управление группой' })).toHaveFocus();

      await person.keyboard('{ArrowDown}');
      expect(screen.getByRole('menuitem', { name: 'Настройки' })).toHaveFocus();
      await person.keyboard('{ArrowUp}');
      expect(screen.getByRole('menuitem', { name: 'Управление группой' })).toHaveFocus();
    });
  });
});
