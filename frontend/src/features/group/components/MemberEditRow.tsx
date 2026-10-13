import { HelpHint } from '../../../shared/ui/HelpHint.tsx';
import { setMemberEditMinutes } from '../api/group.api.ts';
import { useGroupMutation } from '../hooks/useGroup.ts';
import { ErrorNotice } from './ErrorNotice.tsx';
import { SettingRow } from './SettingRow.tsx';
import { compactSelectClass } from './styles.ts';

const OPTIONS: [number, string][] = [
  [0, 'Выключено'],
  [15, '15 минут'],
  [60, '1 час'],
  [1440, '24 часа'],
  [10080, 'Неделя'],
];

/** How long a member may edit or delete their own record; saved as soon as the choice changes. */
export function MemberEditRow({ minutes }: { minutes: number }) {
  const save = useGroupMutation(setMemberEditMinutes);

  return (
    <SettingRow
      title="Правка своих трат участниками"
      description="Как долго после добавления"
      below={<ErrorNotice mutations={[save]} />}
    >
      <HelpHint>
        Сколько времени после добавления участник может сам изменить или удалить свою трату (только
        по картам, где ему разрешено добавлять). «Выключено»: исправлять может только владелец. Все
        правки записываются в журнал изменений.
      </HelpHint>
      <select
        aria-label="Сколько времени участник может править свои траты"
        value={minutes}
        disabled={save.isPending}
        onChange={(event) => save.mutate(Number(event.target.value))}
        className={`${compactSelectClass} h-11 sm:h-10`}
      >
        {OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </SettingRow>
  );
}
