import { useState, type FormEvent } from 'react';
import { UsersIcon } from '../../../shared/ui/icons.tsx';
import { Modal } from '../../../shared/ui/Modal.tsx';
import { renameGroup } from '../api/group.api.ts';
import { useGroupMutation } from '../hooks/useGroup.ts';
import { ErrorNotice } from './ErrorNotice.tsx';
import { LinkRow } from './LinkRow.tsx';
import { compactInputClass } from './styles.ts';

/** The name of the group: a row with the value; a tap opens a small window with the field and «Сохранить». */
export function GroupNameRow({ name }: { name: string }) {
  const rename = useGroupMutation(renameGroup);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) return setEditing(false);
    try {
      await rename.mutateAsync(trimmed);
      setEditing(false);
    } catch {
      // The error is shown in the window
    }
  }

  return (
    <>
      <LinkRow
        icon={<UsersIcon />}
        title="Название группы"
        description="Его видят все участники"
        value={name}
        onOpen={() => {
          setValue(name);
          rename.reset();
          setEditing(true);
        }}
      />
      {editing && (
        <Modal title="Название группы" onClose={() => setEditing(false)}>
          <form onSubmit={(event) => void submit(event)} className="space-y-3 pb-2">
            <input
              aria-label="Новое название группы"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className={`${compactInputClass} w-full`}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Его видят все участники</p>
            <button
              type="submit"
              disabled={rename.isPending || value.trim() === ''}
              className="h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Сохранить
            </button>
            <ErrorNotice mutations={[rename]} />
          </form>
        </Modal>
      )}
    </>
  );
}
