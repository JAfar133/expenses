import { useState } from 'react';
import { Notice } from '../../../shared/ui/Notice.tsx';
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
  const source = SOURCE_TEXT[ai.keySource];
  return `Ключ задан …${ai.keyHint ?? ''} (${source})`;
}

/** The API key: a password field that is never filled from the server, save, check and delete. */
export function AiKeyForm({ ai }: { ai: AdminAi }) {
  const refresh = useRefreshAdminAi();
  const [apiKey, setApiKey] = useState('');
  const save = useAdminMutation(saveAdminAiKey, () => {
    setApiKey('');
    return refresh();
  });
  const remove = useAdminMutation(deleteAdminAiKey, refresh);
  const test = useAdminMutation(testAdminAi);
  const failure = [save, remove, test].find((mutation) => mutation.isError)?.error;

  return (
    <div className="space-y-2">
      <p className="text-sm">{keyStatusText(ai)}</p>
      {!ai.canStoreKey && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          На сервере не задан SECRETS_KEY: ключ из приложения сохранить нельзя
        </p>
      )}
      <div className="flex gap-2">
        <input
          type="password"
          aria-label="API-ключ Gemini"
          autoComplete="off"
          placeholder="Новый ключ"
          value={apiKey}
          disabled={!ai.canStoreKey}
          onChange={(event) => setApiKey(event.target.value)}
          className={compactInputClass}
        />
        <button
          type="button"
          disabled={!ai.canStoreKey || !apiKey.trim() || save.isPending}
          onClick={() => save.mutate(apiKey.trim())}
          className={textButtonClass}
        >
          Сохранить ключ
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!ai.keyConfigured || test.isPending}
          onClick={() => test.mutate()}
          className={textButtonClass}
        >
          {test.isPending ? 'Проверяем…' : 'Проверить'}
        </button>
        <button
          type="button"
          disabled={ai.keySource !== 'app' || remove.isPending}
          onClick={() => remove.mutate()}
          className={textButtonClass}
        >
          Удалить ключ
        </button>
      </div>
      {test.isSuccess && <Notice variant="success">{test.data.message}</Notice>}
      {failure != null && <Notice variant="error">{toErrorMessage(failure)}</Notice>}
    </div>
  );
}
