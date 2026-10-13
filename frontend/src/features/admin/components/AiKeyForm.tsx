import { useState } from 'react';
import { CheckIcon, TrashIcon } from '../../../shared/ui/icons.tsx';
import { Modal } from '../../../shared/ui/Modal.tsx';
import { ConfirmDialog } from '../../analytics/components/ConfirmDialog.tsx';
import { compactInputClass } from '../../group/components/styles.ts';
import { toErrorMessage } from '../../group/model/error-message.ts';
import { deleteAdminAiKey, saveAdminAiKey, testAdminAi, type AdminAi } from '../api/admin.api.ts';
import { useRefreshAdminAi } from '../hooks/useAdminAi.ts';
import { useAdminMutation } from '../hooks/useAdminMutation.ts';

const SOURCE_TEXT = { app: 'из приложения', env: 'из окружения' } as const;

/** What is known about the key: never the key itself, only the tail and where it comes from. */
export function keyStatusText(
  ai: Pick<AdminAi, 'keyConfigured' | 'keySource' | 'keyHint'>,
): string {
  if (!ai.keyConfigured || ai.keySource === 'none') return 'Ключ не задан';
  return `Ключ задан …${ai.keyHint ?? ''} · ${SOURCE_TEXT[ai.keySource]}`;
}

export function MissingSecretsKey() {
  return (
    <div
      role="note"
      className="space-y-1 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      <p>
        На сервере не задан SECRETS_KEY, ключ из приложения сохранить нельзя. Добавьте SECRETS_KEY в
        .env сервера (32+ случайных символа, например:
      </p>
      <code className="block overflow-x-auto rounded-md bg-amber-100 px-2 py-1 font-mono text-xs dark:bg-amber-900/60">
        openssl rand -base64 36
      </code>
      <p>) и перезапустите бэкенд.</p>
    </div>
  );
}

/** The window of the key: a password field that is never filled from the server, with show and hide. */
export function AiKeySheet({ ai, onClose }: { ai: AdminAi; onClose: () => void }) {
  const refresh = useRefreshAdminAi();
  const [apiKey, setApiKey] = useState('');
  const [shown, setShown] = useState(false);
  const save = useAdminMutation(saveAdminAiKey, async () => {
    await refresh();
    onClose();
  });
  const entered = apiKey.trim() !== '';

  return (
    <Modal title="API-ключ" onClose={onClose}>
      <div className="space-y-3 pb-2">
        <p className="text-sm">{keyStatusText(ai)}</p>
        {ai.keySource === 'env' && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Ключ взят из переменной окружения сервера. Чтобы заменить его в приложении, нужен
            SECRETS_KEY.
          </p>
        )}
        {!ai.canStoreKey && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Сначала задайте SECRETS_KEY на сервере.
          </p>
        )}
        <div className="flex gap-2">
          <input
            type={shown ? 'text' : 'password'}
            aria-label="Новый ключ"
            autoComplete="off"
            placeholder="Новый ключ"
            value={apiKey}
            disabled={!ai.canStoreKey}
            onChange={(event) => setApiKey(event.target.value)}
            className={compactInputClass}
          />
          <button
            type="button"
            aria-label={shown ? 'Скрыть ключ' : 'Показать ключ'}
            title={shown ? 'Скрыть ключ' : 'Показать ключ'}
            onClick={() => setShown((value) => !value)}
            className="shrink-0 rounded-lg px-2 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
          >
            {shown ? 'Скрыть' : 'Показать'}
          </button>
        </div>
        <button
          type="button"
          disabled={!ai.canStoreKey || !entered || save.isPending}
          title={entered ? undefined : 'Сначала введите ключ'}
          onClick={() => save.mutate(apiKey.trim())}
          className="h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
        >
          {save.isPending ? 'Сохраняем…' : 'Сохранить ключ'}
        </button>
        {save.isError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {toErrorMessage(save.error)}
          </p>
        )}
      </div>
    </Modal>
  );
}

interface AiKeyActionsProps {
  ai: AdminAi;
  /** «Заменить» opens the same window as the key row */
  onReplace: () => void;
  /** The result of the last check: the status chip shows «Ошибка» after a failed one */
  onChecked: (failed: boolean) => void;
}

const buttonBase =
  'flex h-11 items-center justify-center gap-1.5 rounded-xl border px-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40';

/** «Проверить», «Заменить», «Удалить» in a row; the result of the check is a line under them. */
export function AiKeyActions({ ai, onReplace, onChecked }: AiKeyActionsProps) {
  const refresh = useRefreshAdminAi();
  const [confirming, setConfirming] = useState(false);
  const remove = useAdminMutation(deleteAdminAiKey, () => {
    onChecked(false);
    return refresh();
  });
  const test = useAdminMutation(testAdminAi, () => onChecked(false));
  const fromEnv = ai.keySource === 'env';

  async function confirmDelete() {
    try {
      await remove.mutateAsync();
    } catch {
      // The error is shown below
    }
    setConfirming(false);
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          disabled={!ai.keyConfigured || test.isPending}
          title={ai.keyConfigured ? undefined : 'Ключ не задан'}
          onClick={() => test.mutate(undefined, { onError: () => onChecked(true) })}
          className={`${buttonBase} border-indigo-300 text-indigo-700 dark:border-indigo-800 dark:text-indigo-300`}
        >
          {test.isPending ? (
            <>
              <span
                aria-hidden="true"
                className="size-3.5 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600"
              />
              Проверяем…
            </>
          ) : (
            'Проверить'
          )}
        </button>
        <button
          type="button"
          disabled={!ai.canStoreKey}
          title={ai.canStoreKey ? undefined : 'Нужен SECRETS_KEY на сервере'}
          onClick={onReplace}
          className={`${buttonBase} border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-200`}
        >
          Заменить
        </button>
        <button
          type="button"
          disabled={ai.keySource !== 'app' || remove.isPending}
          title={
            fromEnv
              ? 'Ключ задан в окружении сервера: удалите его из .env'
              : ai.keySource === 'none'
                ? 'Ключ не задан'
                : undefined
          }
          onClick={() => setConfirming(true)}
          className={`${buttonBase} border-red-300 text-red-600 dark:border-red-900 dark:text-red-400`}
        >
          <TrashIcon />
          Удалить
        </button>
      </div>
      {test.isSuccess && (
        <p className="flex items-start gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckIcon />
          {test.data.message}
        </p>
      )}
      {test.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {toErrorMessage(test.error)}
        </p>
      )}
      {remove.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {toErrorMessage(remove.error)}
        </p>
      )}
      {confirming && (
        <ConfirmDialog
          title="Удалить ключ?"
          message="ИИ перестанет работать, пока не будет задан новый ключ."
          confirmLabel="Удалить"
          busy={remove.isPending}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
