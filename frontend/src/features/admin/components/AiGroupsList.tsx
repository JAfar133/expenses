import { useState } from 'react';
import { compactInputClass, textButtonClass } from '../../group/components/styles.ts';
import { toErrorMessage } from '../../group/model/error-message.ts';
import { setGroupAiLimit, type AdminAi } from '../api/admin.api.ts';
import { useRefreshAdminAi } from '../hooks/useAdminAi.ts';
import { useAdminMutation } from '../hooks/useAdminMutation.ts';

type AiGroup = AdminAi['groups'][number];

/** The limit field of a group: empty means the common limit. */
function GroupLimit({ group }: { group: AiGroup }) {
  const refresh = useRefreshAdminAi();
  const [value, setValue] = useState(group.dailyLimit === null ? '' : String(group.dailyLimit));
  const save = useAdminMutation(
    (limit: number | null) => setGroupAiLimit(group.id, limit),
    refresh,
  );
  const trimmed = value.trim();
  const parsed = trimmed === '' ? null : Number(trimmed);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 0);
  const changed = parsed !== group.dailyLimit;

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        inputMode="numeric"
        aria-label={`Лимит разборов в сутки: ${group.name}`}
        placeholder="общий"
        value={value}
        onChange={(event) => setValue(event.target.value.replace(/\D/g, ''))}
        className={`${compactInputClass} h-10 w-24 flex-none`}
      />
      {changed && valid && (
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate(parsed)}
          className={textButtonClass}
        >
          Сохранить
        </button>
      )}
      {save.isError && <span className="text-xs text-red-600">{toErrorMessage(save.error)}</span>}
    </div>
  );
}

/** Groups: whether the owner turned the AI on, today's use and the own daily limit of each. */
export function AiGroupsList({ groups }: { groups: AiGroup[] }) {
  if (groups.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Группы</h3>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {groups.map((group) => (
          <li key={group.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{group.name}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {group.enabled ? 'Включён владельцем' : 'Выключен владельцем'} · сегодня разобрано:{' '}
                {group.usedToday}
              </div>
            </div>
            <GroupLimit group={group} />
          </li>
        ))}
      </ul>
    </div>
  );
}
