import type { Database } from '../../infrastructure/database/database.ts';
import type { NotificationsService } from './notifications.service.ts';

/** Tells the group (except the newcomer) that a person has joined: «Настя присоединилась к группе «Семья»». */
export async function announceMemberJoined(
  database: Database,
  notifications: Pick<NotificationsService, 'emit'>,
  event: { username: string; groupId: string },
): Promise<void> {
  const [row] = await database.query<{ user_id: string; name: string; group_name: string }>(
    `SELECT u.id AS user_id, COALESCE(u.custom_display_name, u.display_name) AS name, g.name AS group_name
       FROM users u, groups g WHERE u.username = $1 AND g.id = $2`,
    [event.username, event.groupId],
  );
  if (!row) return;
  await notifications.emit({
    type: 'member_joined',
    title: 'Новый участник',
    body: `${row.name} теперь в группе «${row.group_name}»`,
    privateBody: 'В группу вступил новый участник',
    link: '/group/members',
    data: { userId: row.user_id, groupName: row.group_name },
    dedupeKey: `member_joined:${row.user_id}:${event.groupId}`,
    audience: { type: 'group', groupId: event.groupId, exceptUserId: row.user_id },
  });
}
