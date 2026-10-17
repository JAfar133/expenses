import { useState } from 'react';
import { ActionMenu } from '../../../shared/ui/ActionMenu.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { KeyIcon, PencilIcon, PlusIcon, TrashIcon } from '../../../shared/ui/icons.tsx';
import { ConfirmDialog } from '../../analytics/components/ConfirmDialog.tsx';
import { toErrorMessage } from '../../group/model/error-message.ts';
import type { ApiKey } from '../api/integrations.api.ts';
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  useUpdateApiKey,
} from '../hooks/useIntegrations.ts';
import { formatDate, lastUsedText } from '../model/format.ts';
import { KeyDialog } from './KeyDialog.tsx';
import { KeyCreatedDialog } from './KeyCreatedDialog.tsx';

/** «API-ключи»: the list (active first, revoked muted), create (the key is shown once) and revoke. */
export function ApiKeysSection({ categories }: { categories: string[] }) {
  const query = useApiKeys();
  const create = useCreateApiKey();
  const revoke = useRevokeApiKey();
  const update = useUpdateApiKey();
  const [editing, setEditing] = useState<ApiKey | null>(null);
  const [creating, setCreating] = useState(false);
  // The full key lives only here, only while its window is open
  const [issued, setIssued] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  const keys = Array.isArray(query.data) ? query.data : [];
  const active = keys.filter((key) => !key.revokedAt);
  const revoked = keys.filter((key) => key.revokedAt);

  const closeIssued = () => {
    setIssued(null);
    create.reset();
  };

  const row = (key: ApiKey) => {
    const off = key.revokedAt !== null;
    return (
      <li key={key.id} className={'flex items-center gap-3 py-3' + (off ? ' opacity-60' : '')}>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          <KeyIcon />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{key.name}</span>
            <span
              className={
                'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ' +
                (off
                  ? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                  : 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300')
              }
            >
              {off ? 'Отозван' : 'Активен'}
            </span>
          </div>
          <div className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {key.prefix}…
          </div>
          <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            Создан {formatDate(key.createdAt)} · {lastUsedText(key.lastUsedAt)}
          </div>
          <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            Категория по умолчанию: {key.defaultCategory ?? 'не выбрана'}
          </div>
        </div>
        {!off && (
          <ActionMenu
            label={`Действия: ${key.name}`}
            actions={[
              {
                label: 'Изменить',
                icon: <PencilIcon />,
                onSelect: () => {
                  update.reset();
                  setEditing(key);
                },
              },
              {
                label: 'Отозвать',
                icon: <TrashIcon />,
                tone: 'danger',
                onSelect: () => setRevoking(key),
              },
            ]}
          />
        )}
      </li>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          API-ключи
        </h3>
        <button
          type="button"
          onClick={() => {
            create.reset();
            setCreating(true);
          }}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-indigo-200 px-3 text-sm font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
        >
          <PlusIcon />
          Создать API-ключ
        </button>
      </div>
      {keys.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Ключей пока нет. Ключ нужен автоматизации на телефоне, чтобы присылать расходы в
          приложение
        </p>
      )}
      {keys.length > 0 && (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {active.map(row)}
          {revoked.map(row)}
        </ul>
      )}
      {revoke.isError && <Notice variant="error">{toErrorMessage(revoke.error)}</Notice>}

      {creating && issued === null && (
        <KeyDialog
          title="Новый API-ключ"
          submitLabel="Создать"
          categories={categories}
          busy={create.isPending}
          error={create.error}
          onClose={() => setCreating(false)}
          onSubmit={({ name, defaultCategory }) =>
            create.mutate(
              { name, ...(defaultCategory ? { defaultCategory } : {}) },
              {
                onSuccess: (result) => {
                  setCreating(false);
                  setIssued(result.key);
                },
              },
            )
          }
        />
      )}
      {editing && (
        <KeyDialog
          title={`Изменить ключ: ${editing.name}`}
          submitLabel="Сохранить"
          initial={{ name: editing.name, defaultCategory: editing.defaultCategory }}
          categories={categories}
          busy={update.isPending}
          error={update.error}
          onClose={() => setEditing(null)}
          onSubmit={(values) =>
            update.mutate({ id: editing.id, patch: values }, { onSuccess: () => setEditing(null) })
          }
        />
      )}
      {issued !== null && <KeyCreatedDialog apiKey={issued} onClose={closeIssued} />}
      {revoking && (
        <ConfirmDialog
          title="Отозвать ключ?"
          message={`Отозвать ключ «${revoking.name}»? Автоматизация на телефоне сразу перестанет работать`}
          confirmLabel="Отозвать"
          busy={revoke.isPending}
          onCancel={() => setRevoking(null)}
          onConfirm={() => revoke.mutate(revoking.id, { onSettled: () => setRevoking(null) })}
        />
      )}
    </div>
  );
}
