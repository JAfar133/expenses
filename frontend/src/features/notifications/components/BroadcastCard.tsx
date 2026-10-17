import { useState } from 'react';
import { ApiError } from '../../../shared/api/http.ts';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { Toast } from '../../../shared/ui/Toast.tsx';
import { UsersIcon } from '../../../shared/ui/icons.tsx';
import { ConfirmDialog } from '../../analytics/components/ConfirmDialog.tsx';
import { useCurrentUser } from '../../auth/hooks/useAuth.ts';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import { ChoiceSetting } from '../../templates/components/ChoiceSetting.tsx';
import type { Audience } from '../api/broadcast.api.ts';
import { useRecipients, useSendBroadcast } from '../hooks/useBroadcast.ts';
import { TEXT_MAX, TITLE_MAX, peopleLabel, recipientsDative } from '../model/broadcast.ts';
import { BroadcastHistory } from './BroadcastHistory.tsx';
import { NotificationPreview } from './NotificationPreview.tsx';
import { RecipientPicker } from './RecipientPicker.tsx';

const field =
  'w-full rounded-xl border border-zinc-300 bg-white px-3 text-base outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-zinc-700 dark:bg-zinc-900';

/**
 * A message to people: the owner writes to the group, the administrator to all users. It stays out of sight for
 * anybody else (the server answers 403 to the list of recipients).
 */
export function BroadcastCard({
  mode,
  groupId,
}: {
  mode: 'owner' | 'admin';
  /** Owner mode: the group of the owner, so that an administrator who owns a group sees only its members here */
  groupId?: string;
}) {
  const { data: user } = useCurrentUser();
  const recipients = useRecipients();
  const send = useSendBroadcast();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [wide, setWide] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [toast, setToast] = useState<string>();

  // No answer, a refusal (403) or something that is not a list of people: nothing is shown
  if (!recipients.isSuccess || !Array.isArray(recipients.data.users)) return null;

  const owner = mode === 'owner';
  const users =
    owner && groupId
      ? recipients.data.users.filter((person) => person.groupId === groupId)
      : recipients.data.users;
  const everyone = owner ? 'Всем в группе' : 'Всем пользователям';
  const count = wide ? users.length : selected.size;
  const trimmed = text.trim();
  const valid = trimmed.length > 0 && trimmed.length <= TEXT_MAX && count > 0;
  const heading = title.trim() || `Сообщение · ${user?.displayName ?? ''}`.trim();

  const audience = (): Audience =>
    wide
      ? owner
        ? { type: 'group' }
        : { type: 'all' }
      : {
          type: 'users',
          userIds: users.filter((person) => selected.has(person.id)).map((person) => person.id),
        };

  const submit = () =>
    send.mutate(
      { text: trimmed, ...(title.trim() ? { title: title.trim() } : {}), audience: audience() },
      {
        onSuccess: (result) => {
          setToast(`Отправлено: ${peopleLabel(result.recipients)}`);
          setTitle('');
          setText('');
          setSelected(new Set());
        },
        onSettled: () => setConfirming(false),
      },
    );

  return (
    <SettingsSection
      title={owner ? 'Сообщение участникам' : 'Рассылка'}
      description={
        owner
          ? 'Напишите участникам группы: они увидят сообщение в колокольчике и на телефоне'
          : 'Напишите пользователям приложения: они увидят сообщение в колокольчике и на телефоне'
      }
      compact
    >
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Заголовок</span>
          <input
            aria-label="Заголовок"
            maxLength={TITLE_MAX}
            value={title}
            placeholder={`Сообщение · ${user?.displayName ?? ''}`.trim()}
            onChange={(event) => setTitle(event.target.value)}
            className={`${field} h-12`}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="flex items-baseline justify-between text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Текст
            <span className="text-xs font-normal" aria-live="polite">
              {text.length}/{TEXT_MAX}
            </span>
          </span>
          <textarea
            aria-label="Текст"
            maxLength={TEXT_MAX}
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className={`${field} py-2.5`}
          />
        </label>

        <ChoiceSetting
          title="Кому"
          value={wide ? 'all' : 'pick'}
          onChange={(value) => setWide(value === 'all')}
          choices={[
            { value: 'all', label: everyone, icon: <UsersIcon /> },
            { value: 'pick', label: 'Выбрать', icon: <UsersIcon /> },
          ]}
          helper={`Получат: ${peopleLabel(count)}`}
        />
        {!wide && (
          <RecipientPicker
            users={users}
            selected={selected}
            onChange={setSelected}
            showGroup={!owner}
          />
        )}

        <NotificationPreview title={heading} text={trimmed} />

        {send.isError && (
          <Notice variant="error">
            {send.error instanceof ApiError && send.error.status >= 400 && send.error.status < 500
              ? send.error.message
              : 'Не удалось отправить сообщение'}
          </Notice>
        )}
        <button
          type="button"
          disabled={!valid || send.isPending}
          onClick={() => setConfirming(true)}
          className="h-12 w-full rounded-xl bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          Отправить
        </button>
      </div>

      <BroadcastHistory />

      {confirming && (
        <ConfirmDialog
          title="Отправить сообщение?"
          message={`Отправить сообщение ${recipientsDative(count)}? Его увидят в колокольчике и на телефоне`}
          confirmLabel="Отправить"
          busy={send.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={submit}
        />
      )}
      {toast && <Toast onDismiss={() => setToast(undefined)}>{toast}</Toast>}
    </SettingsSection>
  );
}
