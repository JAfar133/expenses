import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREFERENCE_KEYS } from '../src/features/preferences/model/preferences.ts';
import { validatePassword } from '../src/features/settings/components/ChangePasswordDialog.tsx';
import { timezoneChoices } from '../src/features/settings/model/popular-timezones.ts';
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
  role: 'member',
  isAdmin: false,
  timezone: 'Asia/Yerevan',
};

let user = MISHA;
let cardsList = [
  { name: 'Миша', currency: 'AMD' },
  { name: 'Настя', currency: 'AMD' },
];
let server: Record<string, string>;
let requests: { method: string; url: string; body?: unknown }[];
let passwordResponse: () => Response | Promise<Response>;
let preferencesPut: () => Response | undefined;
let profileResponse: ((body: Record<string, unknown>) => Response) | undefined;

beforeEach(() => {
  user = MISHA;
  cardsList = [
    { name: 'Миша', currency: 'AMD' },
    { name: 'Настя', currency: 'AMD' },
  ];
  server = {};
  requests = [];
  passwordResponse = () => json({ success: true });
  preferencesPut = () => undefined;
  profileResponse = undefined;
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ method, url, body });

      if (url === '/api/auth/me') return ok({ user });
      if (url === '/api/cards') return ok(cardsList);
      if (url === '/api/auth/profile' && method === 'PATCH') {
        if (profileResponse) return profileResponse(body);
        user = {
          ...user,
          ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)),
        } as typeof user;
        return ok({ user });
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
  it('четыре карточки: аккаунт, безопасность, оформление, настройки аналитики; прав пользователей нет', async () => {
    renderSettings();

    expect(await screen.findByRole('heading', { name: 'Настройки' })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      'Настройки',
      'Аккаунт',
      'Безопасность',
      'Оформление',
      'Настройки аналитики',
    ]);
    expect(screen.queryByRole('heading', { name: 'Права пользователей' })).toBeNull();
    expect(requests.some((r) => r.url === '/api/users')).toBe(false);
  });

  it('права не показываются никому: ни текстом, ни блоком', async () => {
    user = { ...MISHA, username: 'nastya', displayName: 'Настя', card: 'Настя', canEdit: false };
    renderSettings();

    await screen.findByRole('heading', { name: 'Аккаунт' });
    expect(screen.queryByText('Права')).toBeNull();
    expect(screen.queryByText(/Просмотр/)).toBeNull();
  });
});

describe('аккаунт', () => {
  const account = () => within(section('Аккаунт'));

  it('имя — поле; логин — обычный текст с подписью «Не изменяется»; карта и пояс — селекты', async () => {
    renderSettings();
    await screen.findByRole('heading', { name: 'Аккаунт' });

    expect(account().getByLabelText('Имя')).toHaveValue('Миша');
    expect(account().getByText('misha')).toBeInTheDocument();
    expect(account().queryByLabelText('Логин')).toBeNull();
    expect(account().getByText('Не изменяется')).toBeInTheDocument();
    await waitFor(() => expect(account().getByLabelText('Карта по умолчанию')).toHaveValue('Миша'));
    expect(
      account().getByLabelText('Карта по умолчанию').parentElement?.querySelector('svg'),
    ).not.toBeNull();
    expect(account().getByLabelText('Часовой пояс')).toHaveValue('Asia/Yerevan');
    expect(account().getByText('Сегодня определяется по этому часовому поясу')).toBeInTheDocument();
  });

  it('карты по умолчанию, которой уже нет, в списке нет: показывается «Не выбрана», выбор сохраняется', async () => {
    cardsList = [
      { name: 'Visa Digital (IDBank)', currency: 'AMD' },
      { name: 'Миша (Т-Банк)', currency: 'RUB' },
    ];
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Аккаунт' });

    const select = await account().findByLabelText('Карта по умолчанию');
    await waitFor(() => expect(select).toHaveValue(''));
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual([
      'Не выбрана (будет первая карта)',
      'Visa Digital (IDBank)',
      'Миша (Т-Банк)',
    ]);
    expect(account().getByRole('button', { name: 'Сохранить' })).toBeDisabled();

    await person.selectOptions(select, 'Миша (Т-Банк)');
    await person.click(account().getByRole('button', { name: 'Сохранить' }));

    const call = requests.find((r) => r.url === '/api/auth/profile')!;
    expect(call.body).toMatchObject({ card: 'Миша (Т-Банк)' });
  });

  it('часовой пояс — один селект: «По умолчанию», «Как на этом устройстве (…)», затем популярные зоны со смещением', async () => {
    renderSettings();
    await screen.findByRole('heading', { name: 'Аккаунт' });

    const labels = within(account().getByLabelText('Часовой пояс'))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(labels[0]).toBe('По умолчанию');
    expect(labels[1]).toMatch(/^Как на этом устройстве \(.+\)$/);
    expect(labels).toContain('Asia/Yerevan (UTC+4)');
    expect(labels).toContain('Europe/Moscow (UTC+3)');
    expect(labels).toContain('UTC (UTC)');
    expect(account().queryByRole('button', { name: 'Как на этом устройстве' })).toBeNull();
    expect(account().queryByRole('button', { name: 'По умолчанию' })).toBeNull();
  });

  it('зона из аккаунта, которой нет в популярных, всё равно есть в списке', () => {
    const labels = timezoneChoices('Pacific/Auckland', 'Asia/Yerevan').map((c) => c.value);
    const withDefault = timezoneChoices('Asia/Yerevan', 'Europe/Moscow', 'Asia/Yerevan');
    expect(withDefault[0]!.label).toBe('По умолчанию (Asia/Yerevan (UTC+4))');
    expect(labels).toContain('Pacific/Auckland');
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

  it('выбор зоны не сохраняется сам: «Сохранить» активна только после изменения', async () => {
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Аккаунт' });

    await person.selectOptions(account().getByLabelText('Часовой пояс'), 'Europe/Moscow');
    expect(requests.some((r) => r.url === '/api/auth/profile')).toBe(false);
    expect(account().getByRole('button', { name: 'Сохранить' })).toBeEnabled();
    await person.click(account().getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(requests.find((r) => r.url === '/api/auth/profile')?.body).toEqual({
        timezone: 'Europe/Moscow',
      }),
    );
  });

  it('возврат к прежней зоне снова отключает «Сохранить»', async () => {
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Аккаунт' });

    await person.selectOptions(account().getByLabelText('Часовой пояс'), 'Europe/Moscow');
    await person.selectOptions(account().getByLabelText('Часовой пояс'), 'Asia/Yerevan');

    expect(account().getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  it('«Как на этом устройстве» сохраняет зону устройства (не динамическую)', async () => {
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Аккаунт' });
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;

    await person.selectOptions(account().getByLabelText('Часовой пояс'), 'device');
    expect(requests.some((r) => r.url === '/api/auth/profile')).toBe(false);
    if (device !== 'Asia/Yerevan') {
      await person.click(account().getByRole('button', { name: 'Сохранить' }));
      await waitFor(() =>
        expect(requests.find((r) => r.url === '/api/auth/profile')?.body).toEqual({
          timezone: device,
        }),
      );
    }
  });

  it('«По умолчанию» сохраняется как null по кнопке «Сохранить»', async () => {
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Аккаунт' });

    await person.selectOptions(account().getByLabelText('Часовой пояс'), 'default');
    expect(requests.some((r) => r.url === '/api/auth/profile')).toBe(false);
    await person.click(account().getByRole('button', { name: 'Сохранить' }));

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

describe('безопасность: смена пароля', () => {
  const security = () => within(section('Безопасность'));
  const dialog = () => within(screen.getByRole('dialog'));

  const open = async (person: ReturnType<typeof userEvent.setup>) => {
    await screen.findByRole('heading', { name: 'Безопасность' });
    await person.click(security().getByRole('button', { name: 'Изменить пароль' }));
  };
  const fill = async (
    person: ReturnType<typeof userEvent.setup>,
    values: { current?: string; next?: string; repeat?: string },
  ) => {
    if (values.current !== undefined)
      await person.type(dialog().getByLabelText('Текущий пароль'), values.current);
    if (values.next !== undefined)
      await person.type(dialog().getByLabelText('Новый пароль'), values.next);
    if (values.repeat !== undefined)
      await person.type(dialog().getByLabelText('Повторите новый пароль'), values.repeat);
  };
  const submit = (person: ReturnType<typeof userEvent.setup>) =>
    person.click(dialog().getByRole('button', { name: 'Сохранить новый пароль' }));

  it('карточка: строка «Пароль» и кнопка; постоянных полей нет; даты последнего изменения нет', async () => {
    renderSettings();
    await screen.findByRole('heading', { name: 'Безопасность' });

    expect(security().getByText('Пароль')).toBeInTheDocument();
    expect(security().getByRole('button', { name: 'Изменить пароль' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Текущий пароль')).toBeNull();
    expect(screen.queryByText(/Последнее изменение/)).toBeNull();
  });

  it('кнопка открывает окно с тремя полями; «Отмена» закрывает', async () => {
    const person = renderSettings();
    await open(person);

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Изменить пароль');
    for (const label of ['Текущий пароль', 'Новый пароль', 'Повторите новый пароль']) {
      expect(dialog().getByLabelText(label)).toBeInTheDocument();
    }
    await person.click(dialog().getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

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
    await open(person);

    await submit(person);

    expect(await dialog().findByText('Введите текущий пароль')).toBeInTheDocument();
    expect(dialog().getByText('Введите новый пароль')).toBeInTheDocument();
    expect(requests.some((r) => r.url === '/api/auth/password')).toBe(false);
  });

  it('пароли не совпадают: ошибка, запроса нет', async () => {
    const person = renderSettings();
    await open(person);
    await fill(person, {
      current: 'old-password',
      next: 'new-password-1',
      repeat: 'new-password-2',
    });

    await submit(person);

    expect(await dialog().findByText('Пароли не совпадают')).toBeInTheDocument();
    expect(requests.some((r) => r.url === '/api/auth/password')).toBe(false);
  });

  it('успех: запрос с текущим и новым паролем, окно закрывается, в карточке «Пароль изменён»', async () => {
    const person = renderSettings();
    await open(person);
    await fill(person, {
      current: 'old-password',
      next: 'new-password-1',
      repeat: 'new-password-1',
    });

    await submit(person);

    expect(await security().findByText(/Пароль изменён/)).toBeInTheDocument();
    expect(security().getByText(/На других устройствах вход завершён/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    const call = requests.find((r) => r.url === '/api/auth/password')!;
    expect(call).toMatchObject({
      method: 'POST',
      body: { currentPassword: 'old-password', newPassword: 'new-password-1' },
    });
    // The next opening starts with empty fields
    await person.click(security().getByRole('button', { name: 'Изменить пароль' }));
    expect(dialog().getByLabelText('Текущий пароль')).toHaveValue('');
  });

  it('ошибка сервера в окне, поля остаются, окно не закрывается', async () => {
    passwordResponse = () =>
      failure('INVALID_CURRENT_PASSWORD', 'Текущий пароль указан неверно', 422);
    const person = renderSettings();
    await open(person);
    await fill(person, {
      current: 'wrong-password',
      next: 'new-password-1',
      repeat: 'new-password-1',
    });

    await submit(person);

    expect(await dialog().findByRole('alert')).toHaveTextContent('Текущий пароль указан неверно');
    expect(dialog().getByLabelText('Новый пароль')).toHaveValue('new-password-1');
    expect(screen.queryByText(/Пароль изменён/)).toBeNull();
  });

  it('слишком много попыток: сообщение сервера', async () => {
    passwordResponse = () =>
      failure('TOO_MANY_ATTEMPTS', 'Слишком много попыток. Повторите через 15 мин.', 429);
    const person = renderSettings();
    await open(person);
    await fill(person, {
      current: 'old-password',
      next: 'new-password-1',
      repeat: 'new-password-1',
    });

    await submit(person);

    expect(await dialog().findByRole('alert')).toHaveTextContent('Повторите через 15 мин.');
  });

  it('кнопка недоступна, пока идёт сохранение: двойное нажатие даёт один запрос', async () => {
    let release!: (response: Response) => void;
    passwordResponse = () => new Promise<Response>((resolve) => (release = resolve));
    const person = renderSettings();
    await open(person);
    await fill(person, {
      current: 'old-password',
      next: 'new-password-1',
      repeat: 'new-password-1',
    });

    await submit(person);
    expect(dialog().getByRole('button', { name: 'Сохраняем…' })).toBeDisabled();
    release(json({ success: true }));

    expect(await security().findByText(/Пароль изменён/)).toBeInTheDocument();
    expect(requests.filter((r) => r.url === '/api/auth/password')).toHaveLength(1);
  });

  it('«Показать пароли» переключает тип всех полей; пароль в адрес и хранилище не попадает', async () => {
    const person = renderSettings();
    await open(person);
    await fill(person, { current: 'old-password' });
    const field = dialog().getByLabelText('Текущий пароль');
    expect(field).toHaveAttribute('type', 'password');

    await person.click(dialog().getByRole('checkbox', { name: 'Показать пароли' }));

    expect(field).toHaveAttribute('type', 'text');
    expect(dialog().getByLabelText('Новый пароль')).toHaveAttribute('type', 'text');
    expect(dialog().getByLabelText('Повторите новый пароль')).toHaveAttribute('type', 'text');
    expect(JSON.stringify(localStorage)).not.toContain('old-password');
  });
});

describe('настройки аналитики', () => {
  const analytics = () => within(section('Настройки аналитики'));
  const sectionButton = (name: string) =>
    analytics().getByRole('button', { name: new RegExp(`^${name}`) });

  it('сверху одна подпись; общие настройки видны сразу и без длинных пояснений', async () => {
    renderSettings();
    await screen.findByRole('heading', { name: 'Настройки аналитики' });

    expect(
      analytics().getByText(
        'Настройки отображения сохраняются в вашем аккаунте и действуют на всех устройствах',
      ),
    ).toBeInTheDocument();
    const currency = analytics().getByRole('radiogroup', { name: 'Валюта отображения' });
    expect(
      within(currency)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['🇦🇲 AMD', '🇷🇺 RUB', '🇺🇸 USD', '🇪🇺 EUR']);
    expect(analytics().queryByRole('radiogroup', { name: 'Панель фильтров' })).toBeNull();
    expect(analytics().queryByText(/Суммы хранятся в драммах/)).toBeNull();
  });

  it('аккордеон: три секции закрыты, под заголовком текущие значения, aria-expanded/aria-controls', async () => {
    server = { 'category.type': 'pie', 'category.tab': 'structure' };
    renderSettings();
    await screen.findByRole('heading', { name: 'Настройки аналитики' });

    for (const name of ['Динамика расходов', 'Расходы по категориям', 'Сравнение месяцев']) {
      const button = sectionButton(name);
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(button).toHaveAttribute('aria-controls');
    }
    expect(sectionButton('Динамика расходов')).toHaveTextContent('Столбики · За день');
    await waitFor(() =>
      expect(sectionButton('Расходы по категориям')).toHaveTextContent('Круг · Структура расходов'),
    );
    expect(sectionButton('Сравнение месяцев')).toHaveTextContent('12 мес. · С накоплением');
    expect(analytics().queryByRole('radiogroup', { name: 'Тип графика' })).toBeNull();
  });

  it('можно открыть несколько секций одновременно; у открытой сводки под заголовком нет', async () => {
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Настройки аналитики' });

    await person.click(sectionButton('Динамика расходов'));
    await person.click(sectionButton('Сравнение месяцев'));

    expect(sectionButton('Динамика расходов')).toHaveAttribute('aria-expanded', 'true');
    expect(sectionButton('Сравнение месяцев')).toHaveAttribute('aria-expanded', 'true');
    expect(sectionButton('Расходы по категориям')).toHaveAttribute('aria-expanded', 'false');
    expect(sectionButton('Динамика расходов')).not.toHaveTextContent('Столбики · За день');
    const region = document.getElementById(
      sectionButton('Динамика расходов').getAttribute('aria-controls')!,
    )!;
    expect(region).toHaveAttribute('role', 'region');
    expect(within(region).getByRole('radiogroup', { name: 'Тип графика' })).toBeInTheDocument();
    expect(within(region).getByRole('radiogroup', { name: 'Отображение' })).toBeInTheDocument();

    await person.click(sectionButton('Динамика расходов'));
    expect(sectionButton('Динамика расходов')).toHaveAttribute('aria-expanded', 'false');
    expect(sectionButton('Сравнение месяцев')).toHaveAttribute('aria-expanded', 'true');
  });

  it('все настройки на месте: в открытых секциях есть переключатели всех ключей', async () => {
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Настройки аналитики' });
    for (const name of ['Динамика расходов', 'Расходы по категориям', 'Сравнение месяцев']) {
      await person.click(sectionButton(name));
    }

    const labels = analytics()
      .getAllByRole('radiogroup')
      .map((g) => g.getAttribute('aria-label'));
    expect(labels).toEqual([
      'Валюта отображения',
      'Тип графика',
      'Отображение',
      'Тип графика',
      'Раздел',
      'Период',
      'Тип графика',
    ]);
    // The theme has its own card
    expect(labels).toHaveLength(PREFERENCE_KEYS.length - 1);
  });

  it('выбор сразу сохраняется на сервере (только изменённая настройка)', async () => {
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Настройки аналитики' });
    await person.click(sectionButton('Динамика расходов'));

    const type = analytics().getAllByRole('radiogroup', { name: 'Тип графика' })[0]!;
    await person.click(within(type).getByRole('radio', { name: 'Линия' }));

    await waitFor(() => expect(puts().at(-1)?.body).toEqual({ 'daily.type': 'line' }));
    expect(within(type).getByRole('radio', { name: 'Линия' })).toBeChecked();
    expect(localStorage.getItem('analytics.daily.type')).toBe('line');
  });

  it('«Сбросить настройки аналитики» просит подтверждение; «Отмена» ничего не отправляет', async () => {
    server = { 'daily.type': 'area' };
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Настройки аналитики' });

    await person.click(analytics().getByRole('button', { name: 'Сбросить настройки аналитики' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Вернуть стандартные настройки отображения аналитики? Ваши расходы и бюджеты не изменятся.',
    );
    await person.click(dialog.getByRole('button', { name: 'Отмена' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(puts()).toHaveLength(0);
  });

  it('подтверждённый сброс отправляет значения по умолчанию для настроек аналитики, тему не трогает', async () => {
    server = { 'daily.type': 'area', 'category.type': 'pie' };
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Настройки аналитики' });

    await person.click(analytics().getByRole('button', { name: 'Сбросить настройки аналитики' }));
    await person.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Сбросить' }),
    );

    await waitFor(() => {
      const body = puts().at(-1)?.body as Record<string, string>;
      // The reset is for the analytics settings: the theme stays
      expect(Object.keys(body).sort()).toEqual(
        PREFERENCE_KEYS.filter((key) => key !== 'theme').sort(),
      );
      expect(body['daily.type']).toBe('bars');
      expect(body['category.type']).toBe('donut');
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('сервер не принял: выбор остаётся в этом браузере и показано предупреждение', async () => {
    preferencesPut = () => failure('X', 'сбой', 500);
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Настройки аналитики' });
    await person.click(sectionButton('Динамика расходов'));

    const type = analytics().getAllByRole('radiogroup', { name: 'Тип графика' })[0]!;
    await person.click(within(type).getByRole('radio', { name: 'Область' }));

    expect(await analytics().findByRole('alert')).toHaveTextContent(
      'сохранён только в этом браузере',
    );
    expect(localStorage.getItem('analytics.daily.type')).toBe('area');
  });
});

describe('оформление: тема', () => {
  const appearance = () => within(section('Оформление'));

  it('три варианта: «Как в системе» (по умолчанию), «Светлая», «Тёмная»', async () => {
    renderSettings();
    await screen.findByRole('heading', { name: 'Оформление' });

    const group = appearance().getByRole('radiogroup', { name: 'Тема' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Как в системе', 'Светлая', 'Тёмная']);
    expect(within(group).getByRole('radio', { name: 'Как в системе' })).toBeChecked();
  });

  it('выбор сохраняется на сервере ключом theme и отражается в localStorage', async () => {
    const person = renderSettings();
    await screen.findByRole('heading', { name: 'Оформление' });

    await person.click(appearance().getByRole('radio', { name: 'Тёмная' }));

    await waitFor(() => expect(puts().at(-1)?.body).toEqual({ theme: 'dark' }));
    expect(localStorage.getItem('analytics.theme')).toBe('dark');
    expect(appearance().getByRole('radio', { name: 'Тёмная' })).toBeChecked();
  });

  it('сохранённая на сервере тема показана выбранной', async () => {
    server = { theme: 'light' };
    renderSettings();
    await screen.findByRole('heading', { name: 'Оформление' });

    await waitFor(() => expect(appearance().getByRole('radio', { name: 'Светлая' })).toBeChecked());
  });
});
