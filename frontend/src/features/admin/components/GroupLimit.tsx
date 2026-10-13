import { useState } from 'react';
import { CheckIcon } from '../../../shared/ui/icons.tsx';
import { compactInputClass } from '../../group/components/styles.ts';
import { toErrorMessage } from '../../group/model/error-message.ts';
import { setGroupAiLimit, type AdminAi } from '../api/admin.api.ts';
import { groupLimit } from '../model/ai-status.ts';
import { useRefreshAdminAi } from '../hooks/useAdminAi.ts';
import { useAdminMutation } from '../hooks/useAdminMutation.ts';

type AiGroup = AdminAi['groups'][number];

const LIMIT_HINT =
  'Сколько чеков эта группа может разобрать за сутки. Пусто: действует общий лимит';

/** The own limit of a group: saved on Enter, on leaving the field or with the small check button. Empty = common. */
export function GroupLimit({ group, commonLimit }: { group: AiGroup; commonLimit: number }) {
  const refresh = useRefreshAdminAi();
  const [value, setValue] = useState(group.dailyLimit === null ? '' : String(group.dailyLimit));
  const save = useAdminMutation(
    (limit: number | null) => setGroupAiLimit(group.id, limit),
    refresh,
  );
  const parsed = value.trim() === '' ? null : Number(value);
  const changed = parsed !== group.dailyLimit;

  const commit = () => {
    if (changed && !save.isPending) save.mutate(parsed);
  };

  const reset = () => {
    setValue('');
    save.mutate(null);
  };

  return (
    <div className="space-y-0.5" title={LIMIT_HINT}>
      <div className="flex items-baseline justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span aria-hidden="true">Лимит в сутки</span>
        {group.dailyLimit !== null && (
          <span className="flex items-baseline gap-1">
            свой лимит
            <button
              type="button"
              aria-label={`Сбросить лимит: ${group.name}`}
              title="Вернуть общий лимит"
              onClick={reset}
              className="text-indigo-700 hover:underline dark:text-indigo-300"
            >
              Сбросить
            </button>
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <input
          type="text"
          inputMode="numeric"
          aria-label={`Лимит разборов в сутки: ${group.name}`}
          placeholder={`как у всех (${commonLimit})`}
          value={value}
          onChange={(event) => setValue(event.target.value.replace(/\D/g, ''))}
          onBlur={commit}
          onKeyDown={(event) => event.key === 'Enter' && commit()}
          className={`${compactInputClass} h-10 w-36 flex-none`}
        />
        {changed && (
          <button
            type="button"
            aria-label={`Сохранить лимит: ${group.name}`}
            title="Сохранить лимит"
            // The button is pressed before the field loses focus: the blur saves it once
            onMouseDown={(event) => event.preventDefault()}
            onClick={commit}
            className="flex size-10 items-center justify-center rounded-lg text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
          >
            <CheckIcon />
          </button>
        )}
        {save.isError && <span className="text-xs text-red-600">{toErrorMessage(save.error)}</span>}
      </div>
    </div>
  );
}
