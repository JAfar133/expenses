import { HintList } from '../../../shared/ui/HelpHint.tsx';
import { useState } from 'react';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import { createCategory, updateCategory, type GroupCategory } from '../api/group.api.ts';
import { MergeCategoryDialog } from './MergeCategoryDialog.tsx';
import { useGroupMutation } from '../hooks/useGroup.ts';
import { AddNameForm } from './AddNameForm.tsx';
import { EditableRow } from './EditableRow.tsx';
import { ErrorNotice } from './ErrorNotice.tsx';
import { ActionButton, ListRow, RowActions } from './ListRow.tsx';

type CategoryPatch = {
  id: number;
  patch: { name?: string; archived?: boolean; mergeInto?: number };
};

/** Categories of the group: add, rename, archive and restore. */
export function CategoriesSection({ categories }: { categories: GroupCategory[] }) {
  const add = useGroupMutation(createCategory);
  const update = useGroupMutation(({ id, patch }: CategoryPatch) => updateCategory(id, patch));
  const [merging, setMerging] = useState<GroupCategory | null>(null);
  const active = categories.filter((category) => !category.archived);
  const archived = categories.filter((category) => category.archived);

  return (
    <SettingsSection
      title="Категории"
      hint={
        <HintList
          intro="Список категорий вашей группы. В форме траты можно выбрать только их."
          items={[
            ['Изменить', 'новое название сразу меняется во всех прошлых тратах.'],
            [
              'В архив',
              'категория пропадёт из формы добавления; прошлые траты остаются, вернуть можно в любой момент.',
            ],
            [
              'Объединить',
              'переносит все траты в другую категорию, а эту удаляет (удобно для дублей).',
            ],
          ]}
        />
      }
    >
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {active.map((category) => (
          <EditableRow
            key={category.id}
            name={category.name}
            onRename={(name) => update.mutateAsync({ id: category.id, patch: { name } })}
          >
            {active.length > 1 && (
              <ActionButton
                aria-label={`Объединить: ${category.name}`}
                onClick={() => setMerging(category)}
              >
                Объединить
              </ActionButton>
            )}
            <ActionButton
              tone="danger"
              aria-label={`В архив: ${category.name}`}
              onClick={() => update.mutate({ id: category.id, patch: { archived: true } })}
            >
              В архив
            </ActionButton>
          </EditableRow>
        ))}
      </ul>
      <AddNameForm
        label="Новая категория"
        placeholder="Новая категория"
        busy={add.isPending}
        onAdd={(name) => add.mutateAsync(name)}
      />
      {archived.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-zinc-500">
            Архив категорий ({archived.length})
          </summary>
          <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
            {archived.map((category) => (
              <ListRow
                key={category.id}
                main={<span className="block truncate text-zinc-500">{category.name}</span>}
              >
                <RowActions>
                  <ActionButton
                    aria-label={`Вернуть: ${category.name}`}
                    onClick={() => update.mutate({ id: category.id, patch: { archived: false } })}
                  >
                    Вернуть
                  </ActionButton>
                </RowActions>
              </ListRow>
            ))}
          </ul>
        </details>
      )}
      <ErrorNotice mutations={[add, update]} />
      {merging && (
        <MergeCategoryDialog
          category={merging}
          targets={active.filter((category) => category.id !== merging.id)}
          busy={update.isPending}
          onCancel={() => setMerging(null)}
          onMerge={async (targetId) => {
            try {
              await update.mutateAsync({ id: merging.id, patch: { mergeInto: targetId } });
            } catch {
              // The error is shown below the list
            }
            setMerging(null);
          }}
        />
      )}
    </SettingsSection>
  );
}
