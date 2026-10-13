import { Modal } from '../../../shared/ui/Modal.tsx';
import {
  setCardAccess,
  type AccessLevel,
  type GroupCard,
  type GroupMember,
} from '../api/group.api.ts';
import { useGroupMutation } from '../hooks/useGroup.ts';
import { buildAccessMap, type AccessChoice } from '../model/access.ts';
import { ErrorNotice } from './ErrorNotice.tsx';
import { compactSelectClass } from './styles.ts';

interface MemberAccessDialogProps {
  member: GroupMember;
  members: GroupMember[];
  cards: GroupCard[];
  onClose: () => void;
}

/** What a member may do with each card: nothing, only look, or add expenses. A change is saved at once. */
export function MemberAccessDialog({ member, members, cards, onClose }: MemberAccessDialogProps) {
  const save = useGroupMutation(
    ({ card, access }: { card: GroupCard; access: Record<string, AccessLevel> }) =>
      setCardAccess(card.id, access),
  );
  const active = cards.filter((card) => !card.archived);

  return (
    <Modal title={`Доступ к картам: ${member.displayName}`} onClose={onClose}>
      <div className="space-y-4">
        {active.length === 0 && <p className="text-sm text-zinc-500">Карт пока нет</p>}
        <ul className="space-y-3">
          {active.map((card) => {
            const level = card.access.find((entry) => entry.userId === member.userId)?.level;
            return (
              <li key={card.id} className="grid grid-cols-2 items-center gap-3 text-sm">
                <label htmlFor={`access-${card.id}`} className="min-w-0 truncate font-medium">
                  {card.name}
                </label>
                <select
                  id={`access-${card.id}`}
                  aria-label={`Доступ к карте «${card.name}»: ${member.displayName}`}
                  value={level ?? 'none'}
                  disabled={save.isPending}
                  className={`${compactSelectClass} h-11 w-full min-w-0`}
                  onChange={(event) =>
                    save.mutate({
                      card,
                      access: buildAccessMap(card, members, {
                        username: member.username,
                        choice: event.target.value as AccessChoice,
                      }),
                    })
                  }
                >
                  <option value="none">нет доступа</option>
                  <option value="view">только смотреть</option>
                  <option value="edit">добавлять</option>
                </select>
              </li>
            );
          })}
        </ul>
        <ErrorNotice mutations={[save]} />
        <button
          type="button"
          onClick={onClose}
          className="h-11 w-full rounded-xl border border-zinc-300 text-sm font-medium dark:border-zinc-700"
        >
          Готово
        </button>
      </div>
    </Modal>
  );
}
