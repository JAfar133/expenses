import { useState } from 'react';
import { Modal } from '../../../shared/ui/Modal.tsx';
import { createInvitation, type IssuedLink, type MemberRole } from '../api/group.api.ts';
import { useGroupMutation } from '../hooks/useGroup.ts';
import { ErrorNotice } from './ErrorNotice.tsx';
import { LinkPanel } from './LinkPanel.tsx';
import { compactSelectClass } from './styles.ts';

/** «Пригласить»: choose the role, create the invitation, then copy the one-time link. */
export function InviteDialog({ onClose }: { onClose: () => void }) {
  const [role, setRole] = useState<MemberRole>('member');
  const [issued, setIssued] = useState<IssuedLink | null>(null);
  const create = useGroupMutation(async (chosen: MemberRole) => {
    setIssued(await createInvitation(chosen));
  });

  return (
    <Modal title="Пригласить в группу" onClose={onClose}>
      <div className="space-y-4">
        {!issued && (
          <>
            <div className="space-y-1.5">
              <label
                htmlFor="invite-role"
                className="block text-sm font-medium text-zinc-600 dark:text-zinc-400"
              >
                Роль приглашённого
              </label>
              <select
                id="invite-role"
                value={role}
                onChange={(event) => setRole(event.target.value as MemberRole)}
                className={`${compactSelectClass} h-12 w-full`}
              >
                <option value="member">Участник</option>
                <option value="owner">Владелец</option>
              </select>
              {role === 'owner' && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Второй владелец получает те же права, что и вы.
                </p>
              )}
              {role === 'member' && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Получит доступ ко всем текущим картам, потом вы можете сузить его.
                </p>
              )}
            </div>
            <ErrorNotice mutations={[create]} />
          </>
        )}
        {issued && (
          <LinkPanel title="Ссылка-приглашение" token={issued.token} expiresAt={issued.expiresAt} />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-xl border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700"
          >
            {issued ? 'Готово' : 'Отмена'}
          </button>
          {!issued && (
            <button
              type="button"
              disabled={create.isPending}
              onClick={() => create.mutate(role)}
              className="h-11 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              Создать приглашение
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
