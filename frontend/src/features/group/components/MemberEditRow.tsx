import { useState } from 'react';
import { HelpHint } from '../../../shared/ui/HelpHint.tsx';
import { PencilIcon } from '../../../shared/ui/icons.tsx';
import { Modal } from '../../../shared/ui/Modal.tsx';
import { setMemberEditMinutes } from '../api/group.api.ts';
import { useGroupMutation } from '../hooks/useGroup.ts';
import { ErrorNotice } from './ErrorNotice.tsx';
import { LinkRow } from './LinkRow.tsx';
import { compactSelectClass } from './styles.ts';

const OPTIONS: [number, string][] = [
  [0, 'Выключено'],
  [15, '15 минут'],
  [60, '1 час'],
  [1440, '24 часа'],
  [10080, 'Неделя'],
];

/** How long a member may edit or delete their own record: a row with the value; the choice is in a small window. */
export function MemberEditRow({ minutes }: { minutes: number }) {
  const save = useGroupMutation(setMemberEditMinutes);
  const [open, setOpen] = useState(false);
  const label = OPTIONS.find(([value]) => value === minutes)?.[1] ?? `${minutes} мин`;

  return (
    <>
      <LinkRow
        icon={<PencilIcon />}
        title="Правка своих трат участниками"
        description="Как долго после добавления"
        value={label}
        onOpen={() => {
          save.reset();
          setOpen(true);
        }}
      />
      {open && (
        <Modal title="Правка своих трат участниками" onClose={() => setOpen(false)}>
          <div className="space-y-3 pb-2">
            <div className="relative flex items-center gap-1">
              <span className="text-sm">Как долго после добавления</span>
              <HelpHint>
                Сколько времени после добавления участник может сам изменить или удалить свою трату
                (только по картам, где ему разрешено добавлять). «Выключено»: исправлять может
                только владелец. Все правки записываются в журнал изменений.
              </HelpHint>
            </div>
            <select
              aria-label="Сколько времени участник может править свои траты"
              value={minutes}
              disabled={save.isPending}
              onChange={(event) => save.mutate(Number(event.target.value))}
              className={`${compactSelectClass} h-11 w-full`}
            >
              {OPTIONS.map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
            <ErrorNotice mutations={[save]} />
          </div>
        </Modal>
      )}
    </>
  );
}
