import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BroadcastCard } from '../src/features/notifications/components/BroadcastCard.tsx';
import { peopleLabel, recipientsDative } from '../src/features/notifications/model/broadcast.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ok = (data: unknown, status = 200) => json({ success: true, data }, status);

const USER = {
  username: 'misha',
  displayName: 'Миша',
  card: 'Миша',
  canEdit: true,
  timezone: 'Asia/Yerevan',
  role: 'owner',
  isAdmin: true,
};

const people = [
  { id: 'u1', name: 'Настя', group: 'Семья', role: 'member', groupId: 'g1' },
  { id: 'u2', name: 'Петя', group: 'Семья', role: 'member', groupId: 'g1' },
  { id: 'u3', name: 'Вера', group: 'Офис', role: 'owner', groupId: 'g2' },
];

type Call = { method: string; url: string; body?: Record<string, unknown> };
let calls: Call[];
let recipients: Response | { canSendToAll: boolean; users: typeof people };
let history: Record<string, unknown>[];
let sendResponse: Response | null;

beforeEach(() => {
  calls = [];
  recipients = { canSendToAll: true, users: people };
  history = [];
  sendResponse = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      if (url === '/api/auth/me') return ok({ user: USER });
      if (url === '/api/notifications/recipients') {
        return recipients instanceof Response ? recipients : ok(recipients);
      }
      if (url === '/api/notifications/broadcasts') return ok(history);
      if (url === '/api/notifications/broadcast' && method === 'POST') {
        return sendResponse ?? ok({ id: 'b1', recipients: 2 }, 201);
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function renderCard(mode: 'owner' | 'admin', groupId?: string) {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <BroadcastCard mode={mode} groupId={groupId} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
const sent = () =>
  calls.find((c) => c.method === 'POST' && c.url === '/api/notifications/broadcast')?.body;

describe('числа и склонения', () => {
  it('человек и получателям', () => {
    expect([0, 1, 2, 5, 11, 21, 22].map(peopleLabel)).toEqual([
      '0 человек',
      '1 человек',
      '2 человека',
      '5 человек',
      '11 человек',
      '21 человек',
      '22 человека',
    ]);
    expect([1, 2, 5, 21].map(recipientsDative)).toEqual([
      '1 получателю',
      '2 получателям',
      '5 получателям',
      '21 получателю',
    ]);
  });
});

describe('карточка владельца', () => {
  it('заголовок, «Всем в группе», «Получат: N человек» только по своей группе', async () => {
    renderCard('owner', 'g1');

    expect(
      await screen.findByRole('heading', { name: 'Сообщение участникам', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Всем в группе' })).toBeChecked();
    expect(screen.getByText('Получат: 2 человека')).toBeInTheDocument();
  });

  it('403: карточки нет вообще', async () => {
    recipients = json({ success: false, error: { code: 'FORBIDDEN', message: 'Нет прав' } }, 403);
    renderCard('owner', 'g1');

    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/notifications/recipients')).toBe(true),
    );
    expect(screen.queryByRole('heading', { name: 'Сообщение участникам' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отправить' })).toBeNull();
  });

  it('текст: счётчик, «Отправить» выключена, пока текста нет; предпросмотр с заголовком по умолчанию', async () => {
    const person = renderCard('owner', 'g1');
    const send = await screen.findByRole('button', { name: 'Отправить' });
    expect(send).toBeDisabled();
    expect(screen.getByText('0/300')).toBeInTheDocument();
    expect(screen.getByLabelText('Заголовок')).toHaveAttribute('placeholder', 'Сообщение · Миша');

    await person.type(screen.getByLabelText('Текст'), 'Завтра обновление');

    expect(screen.getByText('17/300')).toBeInTheDocument();
    expect(send).toBeEnabled();
    const preview = within(screen.getByRole('group', { name: 'Предпросмотр уведомления' }));
    expect(preview.getByText('Сообщение · Миша')).toBeInTheDocument();
    expect(preview.getByText('Завтра обновление')).toBeInTheDocument();
    await person.type(screen.getByLabelText('Заголовок'), 'Важно');
    expect(preview.getByText('Важно')).toBeInTheDocument();
  });

  it('всем в группе: подтверждение с числом, тело {type:group}, тост и очистка формы', async () => {
    const person = renderCard('owner', 'g1');
    await person.type(await screen.findByLabelText('Текст'), 'Привет');
    await person.click(screen.getByRole('button', { name: 'Отправить' }));

    const dialog = within(screen.getByRole('dialog', { name: 'Отправить сообщение?' }));
    expect(
      dialog.getByText(
        'Отправить сообщение 2 получателям? Его увидят в колокольчике и на телефоне',
      ),
    ).toBeInTheDocument();
    expect(sent()).toBeUndefined();
    await person.click(dialog.getByRole('button', { name: 'Отправить' }));

    await waitFor(() => expect(sent()).toEqual({ text: 'Привет', audience: { type: 'group' } }));
    expect(await screen.findByText('Отправлено: 2 человека')).toBeInTheDocument();
    expect(screen.getByLabelText('Текст')).toHaveValue('');
  });

  it('выбор людей: чекбоксы, «Выбрать всех / Снять», счётчик; тело {type:users, userIds}; заголовок уходит, если задан', async () => {
    sendResponse = ok({ id: 'b2', recipients: 1 }, 201);
    const person = renderCard('owner', 'g1');
    await person.type(await screen.findByLabelText('Текст'), 'Только тебе');
    await person.type(screen.getByLabelText('Заголовок'), 'Личное');
    await person.click(screen.getByRole('radio', { name: 'Выбрать' }));

    expect(screen.getByText('Получат: 0 человек')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled();
    expect(screen.queryByText('Вера')).toBeNull();
    await person.click(screen.getByRole('button', { name: 'Выбрать всех' }));
    expect(screen.getByText('Получат: 2 человека')).toBeInTheDocument();
    await person.click(screen.getByRole('button', { name: 'Снять' }));
    await person.click(screen.getByRole('checkbox', { name: 'Петя' }));
    expect(screen.getByText('Получат: 1 человек')).toBeInTheDocument();
    await person.click(screen.getByRole('button', { name: 'Отправить' }));
    await person.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Отправить' }),
    );

    await waitFor(() =>
      expect(sent()).toEqual({
        text: 'Только тебе',
        title: 'Личное',
        audience: { type: 'users', userIds: ['u2'] },
      }),
    );
    expect(await screen.findByText('Отправлено: 1 человек')).toBeInTheDocument();
  });

  it('ошибка сервера показывается в карточке, текст остаётся', async () => {
    sendResponse = json(
      {
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Слишком много сообщений. Попробуйте позже' },
      },
      429,
    );
    const person = renderCard('owner', 'g1');
    await person.type(await screen.findByLabelText('Текст'), 'Привет');
    await person.click(screen.getByRole('button', { name: 'Отправить' }));
    await person.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Отправить' }),
    );

    expect(
      await screen.findByText('Слишком много сообщений. Попробуйте позже'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Текст')).toHaveValue('Привет');
  });

  it('история свёрнута, со счётчиком: время, заголовок, текст и «кому»', async () => {
    history = [
      {
        id: 'h1',
        scope: 'group',
        title: 'Обновление',
        body: 'Завтра',
        recipients: 2,
        createdAt: '2026-10-17T10:14:00.000Z',
      },
      {
        id: 'h2',
        scope: 'all',
        title: 'Всем',
        body: 'Привет',
        recipients: 9,
        createdAt: '2026-10-16T10:14:00.000Z',
      },
      {
        id: 'h3',
        scope: 'users',
        title: 'Лично',
        body: 'Тебе',
        recipients: 3,
        createdAt: '2026-10-15T10:14:00.000Z',
      },
    ];
    renderCard('owner', 'g1');

    const summary = await screen.findByText('Отправленные');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    await waitFor(() => expect(summary.parentElement).toHaveTextContent('3'));
    expect(screen.getByText('кому: всем в группе')).toBeInTheDocument();
    expect(screen.getByText('кому: всем пользователям')).toBeInTheDocument();
    expect(screen.getByText('кому: 3 человека')).toBeInTheDocument();
    expect(screen.getByText('Обновление')).toBeInTheDocument();
  });
});

describe('карточка администратора', () => {
  it('«Рассылка», «Всем пользователям», выбор показывает группы и отметку владельца; тело {type:all}', async () => {
    const person = renderCard('admin');

    expect(await screen.findByRole('heading', { name: 'Рассылка', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Всем пользователям' })).toBeChecked();
    expect(screen.getByText('Получат: 3 человека')).toBeInTheDocument();

    await person.type(screen.getByLabelText('Текст'), 'Плановые работы');
    await person.click(screen.getByRole('button', { name: 'Отправить' }));
    await person.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Отправить' }),
    );
    await waitFor(() =>
      expect(sent()).toEqual({ text: 'Плановые работы', audience: { type: 'all' } }),
    );
  });

  it('список для выбора: имя, группа, «владелец»', async () => {
    const person = renderCard('admin');
    await person.click(await screen.findByRole('radio', { name: 'Выбрать' }));

    const list = within(screen.getByRole('checkbox', { name: /Вера/ }).closest('ul')!);
    expect(list.getByText('Вера')).toBeInTheDocument();
    expect(list.getByText('Офис')).toBeInTheDocument();
    expect(list.getByText('владелец')).toBeInTheDocument();
    expect(list.getAllByText('Семья')).toHaveLength(2);
  });

  it('403: карточки нет', async () => {
    recipients = json({ success: false, error: { code: 'FORBIDDEN', message: 'Нет прав' } }, 403);
    renderCard('admin');

    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/notifications/recipients')).toBe(true),
    );
    expect(screen.queryByRole('heading', { name: 'Рассылка' })).toBeNull();
  });
});
