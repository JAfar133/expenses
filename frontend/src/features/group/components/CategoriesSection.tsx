import { HelpHint } from '../../../shared/ui/HelpHint.tsx';
import { useState } from 'react';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import { createCategory, updateCategory, type GroupCategory } from '../api/group.api.ts';
import { MergeCategoryDialog } from './MergeCategoryDialog.tsx';
import { useGroupMutation } from '../hooks/useGroup.ts';
import { AddNameForm } from './AddNameForm.tsx';
import { EditableName } from './EditableName.tsx';
import { ErrorNotice } from './ErrorNotice.tsx';
import { smallButtonClass } from './styles.ts';

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
      hint="Список категорий вашей группы. В форме траты можно выбрать только их."
    >
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {active.map((category) => (
          <li key={category.id} className="flex flex-wrap items-center justify-between gap-2 py-1">
            <EditableName
              name={category.name}
              hint="Новое название сразу меняется во всех прошлых тратах."
              onRename={(name) => update.mutateAsync({ id: category.id, patch: { name } })}
            />
            <button
              type="button"
              aria-label={`В архив: ${category.name}`}
              className={smallButtonClass}
              onClick={() => update.mutate({ id: category.id, patch: { archived: true } })}
            >
              В архив
            </button>
            <HelpHint>
              Категория пропадёт из формы добавления. Прошлые траты с ней останутся как есть.
              Архивную категорию можно вернуть.
            </HelpHint>
            {active.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label={`Объединить: ${category.name}`}
                  className={smallButtonClass}
                  onClick={() => setMerging(category)}
                >
                  Объединить
                </button>
                <HelpHint>
                  Переносит все траты в другую категорию, а эту удаляет. Удобно для дублей вроде
                  «бытавуха» и «бытовые расходы».
                </HelpHint>
              </>
            )}
          </li>
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
              <li key={category.id} className="flex items-center justify-between gap-2 py-1">
                <span className="truncate text-zinc-500">{category.name}</span>
                <button
                  type="button"
                  aria-label={`Вернуть: ${category.name}`}
                  className={smallButtonClass}
                  onClick={() => update.mutate({ id: category.id, patch: { archived: false } })}
                >
                  Вернуть
                </button>
              </li>
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
