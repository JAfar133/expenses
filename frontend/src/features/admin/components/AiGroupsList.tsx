import { useState } from 'react';
import { CheckIcon } from '../../../shared/ui/icons.tsx';
import { compactInputClass } from '../../group/components/styles.ts';
import { toErrorMessage } from '../../group/model/error-message.ts';
import { setGroupAiLimit, type AdminAi } from '../api/admin.api.ts';
import { groupLimit } from '../model/ai-status.ts';
import { useRefreshAdminAi } from '../hooks/useAdminAi.ts';
import { useAdminMutation } from '../hooks/useAdminMutation.ts';

type AiGroup = AdminAi['groups'][number];

/** The own limit of a group: saved on Enter, on leaving the field or with the small check button. Empty = common. */
function GroupLimit({ group }: { group: AiGroup }) {
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

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        inputMode="numeric"
        aria-label={`Лимит разборов в сутки: ${group.name}`}
        placeholder="общий"
        value={value}
        onChange={(event) => setValue(event.target.value.replace(/\D/g, ''))}
        onBlur={commit}
        onKeyDown={(event) => event.key === 'Enter' && commit()}
        className={`${compactInputClass} h-10 w-24 flex-none`}
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
  );
}

/** Step 4: every group (even a single one): the state, today's use out of the limit, and its own limit. */
export function AiGroupsList({ groups, commonLimit }: { groups: AiGroup[]; commonLimit: number }) {
  return (
    <section aria-label="Группы" className="space-y-2">
      <h3 className="text-sm font-semibold">Группы</h3>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {groups.map((group) => (
          <li key={group.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{group.name}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {group.enabled ? 'ИИ включён владельцем' : 'ИИ выключен владельцем'} · сегодня
                разобрано {group.usedToday} из {groupLimit(group.dailyLimit, commonLimit)}
              </div>
            </div>
            <GroupLimit group={group} />
          </li>
        ))}
      </ul>
    </section>
  );
}
