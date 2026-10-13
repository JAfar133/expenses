import type { AccessLevel, GroupCard, GroupMember } from '../api/group.api.ts';

export type AccessChoice = AccessLevel | 'none';

/** Builds the full access map for the PUT: members with «none» are omitted, owners are never listed. */
export function buildAccessMap(
  card: GroupCard,
  members: GroupMember[],
  change: { username: string; choice: AccessChoice },
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
