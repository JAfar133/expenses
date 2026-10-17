import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '../src/features/settings/pages/SettingsPage.tsx';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown) => json({ success: true, data });

const BASE = {
  username: 'misha',
  displayName: 'Миша',
  card: 'Миша',
  canEdit: true,
  timezone: 'Asia/Yerevan',
  role: 'member',
  isAdmin: false,
};

let user: Record<string, unknown>;
let templates: Record<string, unknown>[];
let pushEnabled: boolean;
let calls: { method: string; url: string }[];

const tpl = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  scope: 'personal',
  pending: false,
  sharedStatus: null,
  name: id,
  emoji: null,
  category: 'кафе',
  card: null,
  effectiveCard: 'Миша',
  author: 'Миша',
  updatedBy: null,
  updatedAt: null,
  expenseName: id,
  amount: 100,
  currency: 'AMD',
  editable: true,
  mine: true,
  hidden: false,
  unavailable: false,
  ...patch,
});

/** A phone: no media query matches (`(min-width: 768px)` neither); without `matchMedia` a test is a desktop. */
function phone() {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

beforeEach(() => {
  user = { ...BASE };
  templates = [
    tpl('a'),
    tpl('b'),
    tpl('c', { scope: 'group', mine: false }),
    tpl('p', { scope: 'group', pending: true }),
  ];
  pushEnabled = false;
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url });
      if (url === '/api/auth/me') return ok({ user });
      if (url === '/api/templates') return ok(templates);
      if (url === '/api/push/config')
        return ok({ enabled: pushEnabled, publicKey: pushEnabled ? 'AQID' : null });
      if (url === '/api/push/subscriptions') return ok([]);
      if (url === '/api/preferences') return ok({});
      if (url === '/api/cards') return ok([{ name: 'Миша', currency: 'AMD' }]);
      if (url === '/api/group') return ok({ group: { id: 'g1', name: 'Семья' } });
      if (url === '/api/auth/logout') return ok({});
      if (url === '/api/notifications/settings') {
        return ok({
          push: {
            types: {
              expense_imported: true,
              import_problem: true,
              receipt_parsed: false,
              announcement: true,
            },
            hideAmounts: false,
          },
        });
      }
      return ok({});
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const Where = () => {
  const { pathname, hash } = useLocation();
  return <p data-testid="where">{pathname + hash}</p>;
};

function renderAt(entry: string | { pathname: string; hash: string }) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="settings/*" element={<SettingsPage />} />
          <Route path="group" element={<p>Страница группы</p>} />
          <Route path="admin" element={<p>Страница админа</p>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
const where = () => screen.getByTestId('where').textContent;
const personalRow = async (name: RegExp) => {
  await screen.findByRole('navigation', { name: 'Для меня' });
  return await within(screen.getByRole('navigation', { name: 'Для меня' })).findByRole('link', {
    name,
  });
};
const personal = () => within(screen.getByRole('navigation', { name: 'Для меня' }));

describe('главный экран настроек на телефоне', () => {
  beforeEach(phone);

  it('участник: заголовок, профиль, пять разделов, строки «Выйти»; управления группой и админки нет', async () => {
    renderAt('/settings');

    expect(await screen.findByRole('heading', { name: 'Настройки', level: 2 })).toBeInTheDocument();
    const profile = screen.getByRole('link', { name: 'Профиль: Миша' });
    expect(profile).toHaveTextContent('Участник группы');
    expect(profile).toHaveTextContent('М');
    expect(
      personal()
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/settings/account',
      '/settings/templates',
      '/settings/notifications',
      '/settings/appearance',
      '/settings/analytics',
    ]);
    expect(screen.getByText('Имя, карта, пароль')).toBeInTheDocument();
    expect(screen.queryByText('Управление группой')).toBeNull();
    expect(screen.queryByText('Админ')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Группа и приложение' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeInTheDocument();
  });

  it('значения справа: число шаблонов, «Нет на сервере», тема и валюта', async () => {
    renderAt('/settings');

    await screen.findByRole('navigation', { name: 'Для меня' });
    const rows = personal();
    await waitFor(() =>
      expect(rows.getByRole('link', { name: /Шаблоны расходов/ })).toHaveTextContent('3'),
    );
    expect(rows.getByRole('link', { name: /Уведомления/ })).toHaveTextContent('Нет на сервере');
    expect(rows.getByRole('link', { name: /Оформление/ })).toHaveTextContent('Системная');
    expect(rows.getByRole('link', { name: /Аналитика/ })).toHaveTextContent('AMD');
  });

  it('владелец: «Владелец группы «Семья»»; управления группой и админа среди настроек нет', async () => {
    user = { ...BASE, role: 'owner' };
    renderAt('/settings');

    const profile = await screen.findByRole('link', { name: 'Профиль: Миша' });
    await waitFor(() => expect(profile).toHaveTextContent('Владелец группы «Семья»'));
    expect(screen.queryByRole('navigation', { name: 'Группа и приложение' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Управление группой/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Админ/ })).toBeNull();
  });

  it('администратор и владелец: одна короткая строка «Администратор и владелец группы»', async () => {
    user = { ...BASE, role: 'owner', isAdmin: true };
    renderAt('/settings');

    expect(await screen.findByRole('link', { name: 'Профиль: Миша' })).toHaveTextContent(
      'Администратор и владелец группы',
    );
  });

  it('администратор: профиль «Администратор», строки «Админ» среди настроек нет (он в меню пользователя)', async () => {
    user = { ...BASE, isAdmin: true };
    renderAt('/settings');

    expect(await screen.findByRole('link', { name: 'Профиль: Миша' })).toHaveTextContent(
      'Администратор',
    );
    expect(screen.queryByRole('link', { name: /Админ/ })).toBeNull();
  });

  it('строки ведут в разделы; профиль ведёт в аккаунт; «‹ Настройки» возвращает на главный экран', async () => {
    const person = renderAt('/settings');

    await person.click(await screen.findByRole('link', { name: 'Профиль: Миша' }));
    expect(where()).toBe('/settings/account');
    const back = await screen.findByRole('link', { name: /Настройки/ });
    expect(back).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('heading', { name: 'Аккаунт', level: 2 })).toBeInTheDocument();
    await person.click(back);
    expect(where()).toBe('/settings');

    await person.click(await screen.findByRole('link', { name: /Оформление/ }));
    expect(screen.getByRole('heading', { name: 'Оформление', level: 2 })).toBeInTheDocument();
    // The menu of the desktop is not there
    expect(screen.queryByRole('navigation', { name: 'Разделы настроек' })).toBeNull();
  });

  it('«Выйти» запускает выход, как в меню пользователя', async () => {
    const person = renderAt('/settings');

    await person.click(await screen.findByRole('button', { name: 'Выйти' }));

    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/auth/logout' && c.method === 'POST')).toBe(true),
    );
  });

  it('неизвестный раздел ведёт на главный экран', async () => {
    renderAt('/settings/xyz');

    expect(await screen.findByRole('heading', { name: 'Настройки', level: 2 })).toBeInTheDocument();
    expect(where()).toBe('/settings');
  });

  it('старая ссылка /settings#notifications открывает «Уведомления»', async () => {
    renderAt({ pathname: '/settings', hash: '#notifications' });

    expect(
      await screen.findByRole('heading', { name: 'Уведомления', level: 2 }),
    ).toBeInTheDocument();
    expect(where()).toBe('/settings/notifications');
  });

  it('внутри раздела карточка не повторяет заголовок экрана, а своя кнопка остаётся', async () => {
    renderAt('/settings/templates');

    expect(
      await screen.findByRole('heading', { name: 'Шаблоны расходов', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.getByRole('button', { name: '+ Новый' })).toBeInTheDocument();
  });
});

describe('значение «Уведомления» на хабе: у каждой причины своё', () => {
  beforeEach(phone);

  it('сервер без Web Push: «Нет на сервере»', async () => {
    renderAt('/settings');
    expect(await personalRow(/Уведомления/)).toHaveTextContent('Нет на сервере');
  });

  it('iPhone во вкладке Safari: «Нужна установка»', async () => {
    pushEnabled = true;
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1',
      configurable: true,
    });
    renderAt('/settings');

    const row = await personalRow(/Уведомления/);
    await waitFor(() => expect(row).toHaveTextContent('Нужна установка'));
    Object.defineProperty(navigator, 'userAgent', { value: 'jsdom', configurable: true });
  });

  it('браузер без нужных API: «Не поддерживаются»', async () => {
    pushEnabled = true;
    renderAt('/settings');

    const row = await personalRow(/Уведомления/);
    await waitFor(() => expect(row).toHaveTextContent('Не поддерживаются'));
  });
});

describe('настройки на компьютере', () => {
  it('в боковом меню значения справа не показываются (названия не обрезаются), бейдж остаётся', async () => {
    user = { ...BASE, role: 'owner' };
    renderAt('/settings/account');
    const menu = within(await screen.findByRole('navigation', { name: 'Разделы настроек' }));

    expect(menu.getByRole('link', { name: /Шаблоны расходов/ })).toHaveTextContent(
      /^Шаблоны расходов$/,
    );
    expect(menu.getByRole('link', { name: /Аналитика/ })).toHaveTextContent(/^Аналитика$/);
    expect(screen.queryByRole('navigation', { name: 'Группа и приложение' })).toBeNull();
  });

  it('/settings сразу открывает «Аккаунт»; слева меню, справа раздел, кнопки «назад» нет', async () => {
    renderAt('/settings');

    expect(await screen.findByRole('heading', { name: 'Аккаунт', level: 2 })).toBeInTheDocument();
    expect(where()).toBe('/settings/account');
    const menu = within(screen.getByRole('navigation', { name: 'Разделы настроек' }));
    expect(menu.getByRole('link', { name: /Аккаунт/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: '‹ Настройки' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Профиль: Миша' })).toBeNull();
  });

  it('нажатие на раздел в меню меняет правую часть, выбранный выделен', async () => {
    const person = renderAt('/settings/account');
    const menu = () => within(screen.getByRole('navigation', { name: 'Разделы настроек' }));

    await screen.findByRole('navigation', { name: 'Разделы настроек' });
    await person.click(menu().getByRole('link', { name: /Оформление/ }));

    expect(
      await screen.findByRole('heading', { name: 'Оформление', level: 2 }),
    ).toBeInTheDocument();
    expect(menu().getByRole('link', { name: /Оформление/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(menu().getByRole('link', { name: /Аккаунт/ })).not.toHaveAttribute('aria-current');
  });

  it('в меню слева только личные разделы: ни «Управления группой», ни «Админа»', async () => {
    user = { ...BASE, role: 'owner', isAdmin: true };
    renderAt('/settings/account');
    const menu = within(await screen.findByRole('navigation', { name: 'Разделы настроек' }));

    expect(menu.getAllByRole('link')).toHaveLength(5);
    expect(screen.queryByRole('link', { name: /Управление группой/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Админ/ })).toBeNull();
  });

  it('/settings#notifications на компьютере тоже ведёт в раздел', async () => {
    renderAt({ pathname: '/settings', hash: '#notifications' });

    expect(
      await screen.findByRole('heading', { name: 'Уведомления', level: 2 }),
    ).toBeInTheDocument();
    expect(where()).toBe('/settings/notifications');
  });
});
