import type { AccessLevel, GroupCard, GroupMember } from '../api/group.api.ts';
import { compactSelectClass } from './styles.ts';

type Choice = AccessLevel | 'none';

/** Builds the full access map for the PUT: members with "none" are omitted. */
export function buildAccessMap(
  card: GroupCard,
  members: GroupMember[],
  change: { username: string; choice: Choice },
): Record<string, AccessLevel> {
  const map: Record<string, AccessLevel> = {};
  for (const member of members) {
    if (member.role === 'owner') continue;
    const current = card.access.find((entry) => entry.userId === member.userId)?.level;
    const choice = member.username === change.username ? change.choice : (current ?? 'none');
    if (choice !== 'none') map[member.username] = choice;
  }
  return map;
}

interface CardAccessProps {
  card: GroupCard;
  members: GroupMember[];
  disabled?: boolean;
  onChange: (access: Record<string, AccessLevel>) => void;
}

/** Access of non-owner members to a card; a change is saved immediately. */
export function CardAccess({ card, members, disabled, onChange }: CardAccessProps) {
  const others = members.filter((member) => member.role !== 'owner');
  if (others.length === 0) return null;

  return (
    <ul className="space-y-2 pb-2 pl-1">
      {others.map((member) => {
        const level = card.access.find((entry) => entry.userId === member.userId)?.level;
        return (
          <li key={member.userId} className="flex items-center justify-between gap-3 text-sm">
            <label htmlFor={`access-${card.id}-${member.userId}`} className="min-w-0 truncate">
              {member.displayName}
            </label>
            <select
              id={`access-${card.id}-${member.userId}`}
              aria-label={`Доступ к карте «${card.name}»: ${member.displayName}`}
              value={level ?? 'none'}
              disabled={disabled}
              className={compactSelectClass}
              onChange={(event) =>
                onChange(
                  buildAccessMap(card, members, {
                    username: member.username,
                    choice: event.target.value as Choice,
                  }),
                )
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
  );
}
