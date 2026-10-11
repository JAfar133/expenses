import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREFERENCES, PREFERENCE_KEYS } from '../src/features/preferences/model/preferences.ts';
import { validatePassword } from '../src/features/settings/components/PasswordSection.tsx';
import SettingsPage from '../src/features/settings/pages/SettingsPage.tsx';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown) => json({ success: true, data });
const failure = (code: string, message: string, status: number) =>
  json({ success: false, error: { code, message } }, status);

const MISHA = {
  username: 'misha',
  displayName: 'Миша',
  card: 'Миша',
  canEdit: true,
  timezone: 'Asia/Yerevan',
};

let user = MISHA;
let server: Record<string, string>;
let requests: { method: string; url: string; body?: unknown }[];
let passwordResponse: () => Response | Promise<Response>;
let preferencesPut: () => Response | undefined;
let profileResponse: ((body: Record<string, unknown>) => Response) | undefined;
let usersList: { username: string; displayName: string; canEdit: boolean }[];
let rightsResponse: (() => Response) | undefined;

beforeEach(() => {
  user = MISHA;
  server = {};
  requests = [];
  passwordResponse = () => json({ success: true });
  preferencesPut = () => undefined;
  profileResponse = undefined;
  rightsResponse = undefined;
  usersList = [
    { username: 'misha', displayName: 'Миша', canEdit: true },
    { username: 'nastya', displayName: 'Настя', canEdit: false },
  ];
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method, url, body });

      if (url === '/api/auth/me') return ok({ user });
      if (url === '/api/cards') return ok(['Миша', 'Настя']);
      if (url === '/api/auth/profile' && method === 'PATCH') {
        if (profileResponse) return profileResponse(body);
        user = {
          ...user,
          ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)),
        } as typeof user;
        return ok({ user });
      }
      if (url === '/api/users') return ok(usersList);
      if (url.startsWith('/api/users/') && url.endsWith('/rights') && method === 'PUT') {
        if (rightsResponse) return rightsResponse();
        const name = decodeURIComponent(url.split('/')[3]!);
        usersList = usersList.map((u) =>
          u.username === name ? { ...u, canEdit: body.canEdit } : u,
        );
        if (name === user.username) user = { ...user, canEdit: body.canEdit };
        return ok({ username: name, canEdit: body.canEdit });
      }
      if (url === '/api/auth/password') return passwordResponse();
      if (url === '/api/preferences') {
        if (method === 'PUT') {
          const forced = preferencesPut();
          if (forced) return forced;
          server = { ...server, ...body };
        }
        return ok(server);
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="settings" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const puts = () => requests.filter((r) => r.method === 'PUT' && r.url === '/api/preferences');
const section = (name: string) => screen.getByRole('heading', { name }).closest('section')!;

describe('страница настроек', () => {
  it('состоит из блоков: аккаунт, пароль, анализ, права (у редактора)', async () => {
    renderSettings();

    expect(await screen.findByRole('heading', { name: 'Настройки' })).toBeInTheDocument();
    for (const name of ['Аккаунт', 'Пароль', 'Анализ']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(await screen.findByRole('heading', { name: 'Права пользователей' })).toBeInTheDocument();
  });

  it('у пользователя без права правки блока прав нет, права показаны текстом', async () => {
    user = { ...MISHA, username: 'nastya', displayName: 'Настя', card: 'Настя', canEdit: false };
    renderSettings();

    expect(await screen.findByText('Просмотр')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Права пользователей' })).toBeNull();
    expect(requests.some((r) => r.url === '/api/users')).toBe(false);
  });
});

describe('аккаунт', () => {
  const account = () => within(section('Аккаунт'));

  it('имя, логин, карта и часовой пояс показаны в полях; логин только для чтения', async () => {
    renderSettings();
    await screen.findByRole('heading', { name: 'Аккаунт' });

    expect(account().getByLabelText('Имя')).toHaveValue('Миша');
    expect(account().getByLabelText('Логин')).toHaveValue('misha');
    expect(account().getByLabelText('Логин')).toHaveAttribute('readonly');
    await waitFor(() => expect(account().getByLabelText('Карта по умолчанию')).toHaveValue('Миша'));
    expect(account().getByLabelText('Часовой пояс')).toHaveValue('Asia/Yerevan');
    expect(account().getByText('Просмотр, правка и удаление записей')).toBeInTheDocument();
  });

  it('«Сохранить» недоступно, пока ничего не менялось; при правке отправляются только изменённые поля', async () => {
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Аккаунт' });
    expect(account().getByRole('button', { name: 'Сохранить' })).toBeDisabled();

    const name = account().getByLabelText('Имя');
    await person.clear(name);
    await person.type(name, '  Михаил ');
    await person.selectOptions(await account().findByLabelText('Карта по умолчанию'), 'Настя');
    await person.click(account().getByRole('button', { name: 'Сохранить' }));

    expect(await account().findByText('Изменения сохранены')).toBeInTheDocument();
    const call = requests.find((r) => r.url === '/api/auth/profile')!;
    expect(call).toMatchObject({ method: 'PATCH', body: { displayName: 'Михаил', card: 'Настя' } });
    expect(call.body).not.toHaveProperty('timezone');
  });

  it('часовой пояс: выбор из списка с указанием смещения', async () => {
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Аккаунт' });

    await person.selectOptions(account().getByLabelText('Часовой пояс'), 'Europe/Moscow');
    await person.click(account().getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(requests.find((r) => r.url === '/api/auth/profile')?.body).toEqual({
        timezone: 'Europe/Moscow',
      }),
    );
    const option = within(account().getByLabelText('Часовой пояс')).getByRole('option', {
      name: /Europe\/Moscow/,
    });
    expect(option).toHaveTextContent('UTC+3');
  });

  it('«Как на этом устройстве» подставляет пояс устройства, но не сохраняет без «Сохранить»', async () => {
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Аккаунт' });
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;

    await person.click(account().getByRole('button', { name: 'Как на этом устройстве' }));

    expect(account().getByLabelText('Часовой пояс')).toHaveValue(device);
    expect(requests.some((r) => r.url === '/api/auth/profile')).toBe(false);
  });

  it('«По умолчанию» сразу возвращает часовой пояс по умолчанию (null)', async () => {
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Аккаунт' });

    await person.click(account().getByRole('button', { name: 'По умолчанию' }));

    await waitFor(() =>
      expect(requests.find((r) => r.url === '/api/auth/profile')?.body).toEqual({ timezone: null }),
    );
  });

  it('пустое имя: ошибка и сохранение недоступно', async () => {
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Аккаунт' });

    await person.clear(account().getByLabelText('Имя'));

    expect(account().getByText('Введите имя')).toBeInTheDocument();
    expect(account().getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  it('ошибка сервера показывается, значения в полях остаются', async () => {
    profileResponse = () => failure('INVALID_PROFILE', 'Неизвестный часовой пояс', 422);
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Аккаунт' });

    await person.type(account().getByLabelText('Имя'), '!');
    await person.click(account().getByRole('button', { name: 'Сохранить' }));

    expect(await account().findByRole('alert')).toHaveTextContent('Неизвестный часовой пояс');
    expect(account().getByLabelText('Имя')).toHaveValue('Миша!');
  });

  it('после сохранения новый часовой пояс определяет «сегодня» во всём приложении', async () => {
    const { todayIso } = await import('../src/shared/utils/date.ts');
    const instant = new Date('2026-10-14T21:30:00Z'); // Yerevan: already the 15th; New York: still the 14th
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Аккаунт' });

    await person.selectOptions(account().getByLabelText('Часовой пояс'), 'America/New_York');
    await person.click(account().getByRole('button', { name: 'Сохранить' }));

    await account().findByText('Изменения сохранены');
    expect(todayIso(instant)).toBe('2026-10-14');
  });
});

describe('права пользователей', () => {
  const rights = () => within(section('Права пользователей'));

  it('список пользователей с переключателями права правки', async () => {
    renderSettings();
    await screen.findByRole('heading', { name: 'Права пользователей' });

    expect(rights().getByRole('checkbox', { name: 'Может править и удалять: Миша' })).toBeChecked();
    expect(
      rights().getByRole('checkbox', { name: 'Может править и удалять: Настя' }),
    ).not.toBeChecked();
  });

  it('дать право другому пользователю', async () => {
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Права пользователей' });

    await person.click(rights().getByRole('checkbox', { name: 'Может править и удалять: Настя' }));

    await waitFor(() =>
      expect(
        requests.find((r) => r.method === 'PUT' && r.url === '/api/users/nastya/rights')?.body,
      ).toEqual({
        canEdit: true,
      }),
    );
    await waitFor(() =>
      expect(
        rights().getByRole('checkbox', { name: 'Может править и удалять: Настя' }),
      ).toBeChecked(),
    );
  });

  it('ошибка (например, последний редактор) показывается', async () => {
    rightsResponse = () =>
      failure(
        'LAST_EDITOR',
        'Нельзя убрать право у последнего редактора: управлять правами будет некому',
        409,
      );
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Права пользователей' });

    await person.click(rights().getByRole('checkbox', { name: 'Может править и удалять: Миша' }));

    expect(await rights().findByRole('alert')).toHaveTextContent('последнего редактора');
  });
});

describe('смена пароля', () => {
  const fill = async (
    person: ReturnType<typeof userEvent.setup>,
    values: { current?: string; next?: string; repeat?: string },
  ) => {
    const password = within(section('Пароль'));
    if (values.current !== undefined)
      await person.type(password.getByLabelText('Текущий пароль'), values.current);
    if (values.next !== undefined)
      await person.type(password.getByLabelText('Новый пароль'), values.next);
    if (values.repeat !== undefined)
      await person.type(password.getByLabelText('Повторите новый пароль'), values.repeat);
  };
  const submit = (person: ReturnType<typeof userEvent.setup>) =>
    person.click(within(section('Пароль')).getByRole('button', { name: 'Сменить пароль' }));

  it('validatePassword: все проверки', () => {
    expect(validatePassword({ current: '', next: '', repeat: '' })).toEqual({
      current: 'Введите текущий пароль',
      next: 'Введите новый пароль',
    });
    expect(validatePassword({ current: 'a', next: 'short', repeat: 'short' }).next).toBe(
      'Не короче 8 символов',
    );
    expect(
      validatePassword({ current: 'old-password', next: 'old-password', repeat: 'old-password' })
        .next,
    ).toBe('Новый пароль совпадает с текущим');
    expect(
      validatePassword({ current: 'old-password', next: 'new-password', repeat: 'other-one' })
        .repeat,
    ).toBe('Пароли не совпадают');
    expect(
      validatePassword({ current: 'old-password', next: 'new-password', repeat: 'new-password' }),
    ).toEqual({});
  });

  it('пустая форма: ошибки и ни одного запроса', async () => {
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Пароль' });

    await submit(person);

    expect(await screen.findByText('Введите текущий пароль')).toBeInTheDocument();
    expect(screen.getByText('Введите новый пароль')).toBeInTheDocument();
    expect(requests.some((r) => r.url === '/api/auth/password')).toBe(false);
  });

  it('пароли не совпадают: ошибка, запроса нет', async () => {
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Пароль' });
    await fill(person, {
      current: 'old-password',
      next: 'new-password-1',
      repeat: 'new-password-2',
    });

    await submit(person);

    expect(await screen.findByText('Пароли не совпадают')).toBeInTheDocument();
    expect(requests.some((r) => r.url === '/api/auth/password')).toBe(false);
  });

  it('успех: запрос с текущим и новым паролем, поля очищаются, сообщение об успехе', async () => {
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Пароль' });
    await fill(person, {
      current: 'old-password',
      next: 'new-password-1',
      repeat: 'new-password-1',
    });

    await submit(person);

    expect(await screen.findByText(/Пароль изменён/)).toBeInTheDocument();
    const call = requests.find((r) => r.url === '/api/auth/password')!;
    expect(call).toMatchObject({
      method: 'POST',
      body: { currentPassword: 'old-password', newPassword: 'new-password-1' },
    });
    expect(within(section('Пароль')).getByLabelText('Текущий пароль')).toHaveValue('');
    expect(within(section('Пароль')).getByLabelText('Новый пароль')).toHaveValue('');
  });

  it('ошибка сервера показывается, поля остаются', async () => {
    passwordResponse = () =>
      failure('INVALID_CURRENT_PASSWORD', 'Текущий пароль указан неверно', 422);
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Пароль' });
    await fill(person, {
      current: 'wrong-password',
      next: 'new-password-1',
      repeat: 'new-password-1',
    });

    await submit(person);

    expect(await screen.findByRole('alert')).toHaveTextContent('Текущий пароль указан неверно');
    expect(within(section('Пароль')).getByLabelText('Новый пароль')).toHaveValue('new-password-1');
    expect(screen.queryByText(/Пароль изменён/)).toBeNull();
  });

  it('слишком много попыток: сообщение сервера', async () => {
    passwordResponse = () =>
      failure('TOO_MANY_ATTEMPTS', 'Слишком много попыток. Повторите через 15 мин.', 429);
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Пароль' });
    await fill(person, {
      current: 'old-password',
      next: 'new-password-1',
      repeat: 'new-password-1',
    });

    await submit(person);

    expect(await screen.findByRole('alert')).toHaveTextContent('Повторите через 15 мин.');
  });

  it('кнопка недоступна, пока идёт сохранение: двойное нажатие даёт один запрос', async () => {
    let release!: (response: Response) => void;
    passwordResponse = () => new Promise<Response>((resolve) => (release = resolve));
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Пароль' });
    await fill(person, {
      current: 'old-password',
      next: 'new-password-1',
      repeat: 'new-password-1',
    });

    await submit(person);
    const button = within(section('Пароль')).getByRole('button', { name: 'Сохраняем…' });
    expect(button).toBeDisabled();
    release(json({ success: true }));

    expect(await screen.findByText(/Пароль изменён/)).toBeInTheDocument();
    expect(requests.filter((r) => r.url === '/api/auth/password')).toHaveLength(1);
  });

  it('«Показать пароли» переключает тип полей; пароль в адрес и хранилище не попадает', async () => {
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Пароль' });
    await fill(person, { current: 'old-password' });
    const field = within(section('Пароль')).getByLabelText('Текущий пароль');
    expect(field).toHaveAttribute('type', 'password');

    await person.click(
      within(section('Пароль')).getByRole('checkbox', { name: 'Показать пароли' }),
    );

    expect(field).toHaveAttribute('type', 'text');
    expect(JSON.stringify(localStorage)).not.toContain('old-password');
  });
});

describe('настройки анализа', () => {
  const analytics = () => within(section('Анализ'));

  it('для каждой настройки есть переключатель со всеми вариантами и текущим выбором', async () => {
    server = { 'category.type': 'donut' };
    renderSettings();
    await screen.findByRole('heading', { name: 'Анализ' });

    for (const key of PREFERENCE_KEYS) {
      const group = analytics().getByRole('radiogroup', { name: PREFERENCES[key].label });
      expect(
        within(group)
          .getAllByRole('radio')
          .map((r) => r.textContent),
      ).toEqual(PREFERENCES[key].options.map((o) => o.label));
    }
    await waitFor(() =>
      expect(
        within(analytics().getByRole('radiogroup', { name: 'Расход по категориям' })).getByRole(
          'radio',
          {
            name: 'Кольцо',
          },
        ),
      ).toBeChecked(),
    );
  });

  it('без сохранённого выбора отмечены значения по умолчанию', async () => {
    renderSettings();
    await screen.findByRole('heading', { name: 'Анализ' });

    const daily = analytics().getByRole('radiogroup', { name: 'График по времени' });
    expect(within(daily).getByRole('radio', { name: 'Столбики' })).toBeChecked();
  });

  it('выбор сразу сохраняется на сервере (только изменённая настройка)', async () => {
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Анализ' });

    await person.click(
      within(analytics().getByRole('radiogroup', { name: 'График по времени' })).getByRole(
        'radio',
        {
          name: 'Линия',
        },
      ),
    );

    await waitFor(() => expect(puts().at(-1)?.body).toEqual({ 'daily.type': 'line' }));
    expect(
      within(analytics().getByRole('radiogroup', { name: 'График по времени' })).getByRole(
        'radio',
        {
          name: 'Линия',
        },
      ),
    ).toBeChecked();
    expect(localStorage.getItem('analytics.daily.type')).toBe('line');
  });

  it('«Сбросить к стандартным» отправляет значения по умолчанию для всех настроек', async () => {
    server = { 'daily.type': 'area', 'category.type': 'pie' };
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Анализ' });

    await person.click(analytics().getByRole('button', { name: 'Сбросить к стандартным' }));

    await waitFor(() => {
      const body = puts().at(-1)?.body as Record<string, string>;
      expect(Object.keys(body).sort()).toEqual([...PREFERENCE_KEYS].sort());
      expect(body['daily.type']).toBe('bars');
      expect(body['category.type']).toBe('donut');
    });
  });

  it('сервер не принял: выбор остаётся в этом браузере и показано предупреждение', async () => {
    preferencesPut = () => failure('X', 'сбой', 500);
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Анализ' });

    await person.click(
      within(analytics().getByRole('radiogroup', { name: 'График по времени' })).getByRole(
        'radio',
        {
          name: 'Область',
        },
      ),
    );

    expect(await analytics().findByRole('alert')).toHaveTextContent(
      'сохранён только в этом браузере',
    );
    expect(localStorage.getItem('analytics.daily.type')).toBe('area');
  });
});
