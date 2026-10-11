import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../../shared/api/http.ts';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { fetchCurrentUser } from '../../auth/api/auth.api.ts';
import { CURRENT_USER_KEY } from '../../auth/hooks/useAuth.ts';
import { listUsers, setUserRights } from '../api/users.api.ts';
import { SettingsSection } from './SettingsSection.tsx';

const USERS_KEY = ['users'];

/** Права пользователей: кто может править и удалять записи. Блок виден только тем, у кого это право есть. */
export function UsersSection() {
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: USERS_KEY, queryFn: listUsers, retry: false });

  const change = useMutation({
    retry: false,
    mutationFn: ({ username, canEdit }: { username: string; canEdit: boolean }) =>
      setUserRights(username, canEdit),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: USERS_KEY });
      // Могли изменить собственные права: интерфейс должен это учесть сразу
      queryClient.setQueryData(CURRENT_USER_KEY, await fetchCurrentUser());
    },
  });

  if (!users.data) return null;

  return (
    <SettingsSection
      title="Права пользователей"
      description="Кто может править и удалять записи. Последнего редактора лишить права нельзя"
    >
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {users.data.map((user) => (
          <li key={user.username} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="truncate font-medium">{user.displayName}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{user.username}</div>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={user.canEdit}
                disabled={change.isPending}
                aria-label={`Может править и удалять: ${user.displayName}`}
                onChange={(event) =>
                  change.mutate({ username: user.username, canEdit: event.target.checked })
                }
                className="size-5 accent-indigo-600"
              />
              Правка и удаление
            </label>
          </li>
        ))}
      </ul>
      {change.isError && (
        <Notice variant="error">
          {change.error instanceof ApiError ? change.error.message : 'Не удалось изменить права'}
        </Notice>
      )}
    </SettingsSection>
  );
}
