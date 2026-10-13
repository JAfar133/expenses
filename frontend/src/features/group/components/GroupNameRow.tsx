import { useState, type FormEvent } from 'react';
import { PencilIcon } from '../../../shared/ui/icons.tsx';
import { renameGroup } from '../api/group.api.ts';
import { useGroupMutation } from '../hooks/useGroup.ts';
import { ErrorNotice } from './ErrorNotice.tsx';
import { SettingRow } from './SettingRow.tsx';
import { compactInputClass, textButtonClass } from './styles.ts';

/** The name of the group: text with a pencil; the field opens on a click, not always. */
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
      // The error is shown under the row; stay in the editor
    }
  }

  return (
    <SettingRow
      title="Название группы"
      description="Его видят все участники"
      below={
        <>
          {editing && (
            <form onSubmit={(event) => void submit(event)} className="flex flex-wrap gap-2">
              <input
                autoFocus
                aria-label="Новое название группы"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                className={`${compactInputClass} w-full sm:w-auto sm:flex-1`}
              />
              <button type="submit" className={textButtonClass}>
                Сохранить
              </button>
              <button type="button" onClick={() => setEditing(false)} className={textButtonClass}>
                Отмена
              </button>
            </form>
          )}
          <ErrorNotice mutations={[rename]} />
        </>
      }
    >
      <span className="max-w-40 truncate text-sm font-medium sm:max-w-64">{name}</span>
      <button
        type="button"
        aria-label="Изменить название группы"
        title="Изменить название группы"
        onClick={() => {
          setValue(name);
          setEditing(true);
        }}
        className="flex size-10 items-center justify-center rounded-lg text-indigo-600 hover:bg-indigo-50 sm:size-9 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
      >
        <PencilIcon />
      </button>
    </SettingRow>
  );
}
