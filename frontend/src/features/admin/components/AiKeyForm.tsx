import { useState } from 'react';
import { CheckIcon } from '../../../shared/ui/icons.tsx';
import { compactInputClass, textButtonClass } from '../../group/components/styles.ts';
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

/** A disabled control must look disabled and say why. */
const linkButton =
  'rounded-lg px-2 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/60 ' +
  'disabled:cursor-not-allowed disabled:text-zinc-400 disabled:opacity-60 disabled:hover:bg-transparent dark:disabled:text-zinc-500';

function MissingSecretsKey() {
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

function KeyInput({
  ai,
  onDone,
  onCancel,
}: {
  ai: AdminAi;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const refresh = useRefreshAdminAi();
  const [apiKey, setApiKey] = useState('');
  const [shown, setShown] = useState(false);
  const save = useAdminMutation(saveAdminAiKey, () => {
    setApiKey('');
    onDone();
    return refresh();
  });
  const entered = apiKey.trim() !== '';

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type={shown ? 'text' : 'password'}
          aria-label="API-ключ Gemini"
          autoComplete="off"
          placeholder="Вставьте ключ"
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
          className={`${linkButton} shrink-0`}
        >
          {shown ? 'Скрыть' : 'Показать'}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!ai.canStoreKey || !entered || save.isPending}
          title={entered ? undefined : 'Сначала введите ключ'}
          onClick={() => save.mutate(apiKey.trim())}
          className="h-10 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
        >
          {save.isPending ? 'Сохраняем…' : 'Сохранить ключ'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={textButtonClass}>
            Отмена
          </button>
        )}
        {save.isError && (
          <span role="alert" className="text-sm text-red-600 dark:text-red-400">
            {toErrorMessage(save.error)}
          </span>
        )}
      </div>
    </div>
  );
}

interface AiKeyFormProps {
  ai: AdminAi;
  /** The result of the last check: the status line shows «Ошибка» after a failed one */
  onChecked: (failed: boolean) => void;
}

/** Step 1: the key. No key: an input. A key: its tail and source, «Проверить», «Заменить», «Удалить». */
export function AiKeyForm({ ai, onChecked }: AiKeyFormProps) {
  const refresh = useRefreshAdminAi();
  const [replacing, setReplacing] = useState(false);
  const remove = useAdminMutation(deleteAdminAiKey, () => {
    onChecked(false);
    return refresh();
  });
  const test = useAdminMutation(testAdminAi, () => onChecked(false));
  const checkFailed = test.isError;
  const fromEnv = ai.keySource === 'env';

  return (
    <section aria-label="API-ключ" className="space-y-2">
      <h3 className="text-sm font-semibold">API-ключ</h3>
      {!ai.canStoreKey && <MissingSecretsKey />}

      {!ai.keyConfigured ? (
        <>
          <p className="text-sm">{keyStatusText(ai)}</p>
          <KeyInput ai={ai} onDone={() => undefined} />
        </>
      ) : (
        <>
          <p className="text-sm">{keyStatusText(ai)}</p>
          {fromEnv && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Ключ взят из переменной окружения сервера. Чтобы заменить его в приложении, нужен
              SECRETS_KEY.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              disabled={test.isPending}
              onClick={() => test.mutate(undefined, { onError: () => onChecked(true) })}
              className={linkButton}
            >
              {test.isPending ? (
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-3.5 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-600"
                  />
                  Проверяем…
                </span>
              ) : (
                'Проверить'
              )}
            </button>
            <button
              type="button"
              disabled={!ai.canStoreKey}
              title={ai.canStoreKey ? undefined : 'Нужен SECRETS_KEY на сервере'}
              onClick={() => setReplacing(true)}
              className={linkButton}
            >
              Заменить
            </button>
            <button
              type="button"
              disabled={fromEnv || remove.isPending}
              title={fromEnv ? 'Ключ задан в окружении сервера: удалите его из .env' : undefined}
              onClick={() => remove.mutate()}
              className={`${linkButton} enabled:text-red-600 dark:enabled:text-red-400`}
            >
              Удалить
            </button>
          </div>
          {test.isSuccess && (
            <p className="flex items-start gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
              <CheckIcon />
              {test.data.message}
            </p>
          )}
          {checkFailed && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {toErrorMessage(test.error)}
            </p>
          )}
          {remove.isError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {toErrorMessage(remove.error)}
            </p>
          )}
          {replacing && (
            <KeyInput
              ai={ai}
              onDone={() => setReplacing(false)}
              onCancel={() => setReplacing(false)}
            />
          )}
        </>
      )}
    </section>
  );
}
