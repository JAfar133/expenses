import {
  ArchiveIcon,
  GaugeIcon,
  MergeIcon,
  PencilIcon,
  UndoIcon,
} from '../../../shared/ui/icons.tsx';
import { HintList } from '../../../shared/ui/HelpHint.tsx';
import { useState } from 'react';
import { currencyDigits } from '../../../shared/utils/conversion.ts';
import { formatAmount } from '../../../shared/utils/money.ts';
import type { Budget } from '../../budgets/api/budgets.api.ts';
import { useBudgets } from '../../budgets/hooks/useBudgets.ts';
import { periodWords } from '../../budgets/model/period.ts';
import { useConfig } from '../../expenses/hooks/useConfig.ts';
import { LimitDialog } from './LimitDialog.tsx';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import { createCategory, updateCategory, type GroupCategory } from '../api/group.api.ts';
import { MergeCategoryDialog } from './MergeCategoryDialog.tsx';
import { useGroupMutation } from '../hooks/useGroup.ts';
import { AddNameForm } from './AddNameForm.tsx';
import { EditableRow } from './EditableRow.tsx';
import { ErrorNotice } from './ErrorNotice.tsx';
import { ActionButton, EmptySlot, ListRow, RowActions } from './ListRow.tsx';

type CategoryPatch = {
  id: string;
  patch: { name?: string; archived?: boolean; mergeInto?: string };
};

/** Categories of the group: add, rename, archive and restore. */
export function CategoriesSection({ categories }: { categories: GroupCategory[] }) {
  const add = useGroupMutation(createCategory);
  const update = useGroupMutation(({ id, patch }: CategoryPatch) => updateCategory(id, patch));
  const [merging, setMerging] = useState<GroupCategory | null>(null);
  // The category being given a limit; `id: null` is the overall limit of the group
  const [limiting, setLimiting] = useState<{ id: string | null; label: string } | null>(null);
  const budgets = useBudgets().data;
  const config = useConfig().data;
  const currency = config?.currency ?? '';
  const digits = config ? currencyDigits(config.currency, config.baseCurrency) : 0;
  const limitOf = (categoryId: string | null) =>
    Array.isArray(budgets) ? budgets.find((budget) => budget.categoryId === categoryId) : undefined;
  const limitLine = (budget?: Budget) =>
    budget
      ? `лимит ${formatAmount(budget.limit, digits)} ${currency} · ${periodWords(budget.periodKind, budget.periodDay)}`
      : undefined;
  const limitAction = (categoryId: string | null, label: string) => {
    const budget = limitOf(categoryId);
    return (
      <ActionButton
        label={`Лимит: ${label}`}
        tone={budget ? 'default' : 'neutral'}
        onClick={() => setLimiting({ id: categoryId, label })}
        icon={<GaugeIcon />}
      />
    );
  };
  const active = categories.filter((category) => !category.archived);
  const archived = categories.filter((category) => category.archived);

  return (
    <SettingsSection
      title="Категории"
      hint={
        <HintList
          intro="Список категорий вашей группы. В форме траты можно выбрать только их."
          items={[
            [
              'Лимит',
              'сколько можно потратить по категории (или по всем) за период: месяц, месяц с выбранного числа или неделя. Участники видят полоски, но не меняют лимиты.',
              <GaugeIcon />,
            ],
            ['Изменить', 'новое название сразу меняется во всех прошлых тратах.', <PencilIcon />],
            [
              'В архив',
              'категория пропадёт из формы добавления; прошлые траты остаются, вернуть можно в любой момент.',
              <ArchiveIcon />,
            ],
            [
              'Объединить',
              'переносит все траты в другую категорию, а эту удаляет (удобно для дублей).',
              <MergeIcon />,
            ],
          ]}
        />
      }
    >
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {config && (
          <ListRow
            main={
              <>
                <span className="block font-medium">Все категории</span>
                {limitLine(limitOf(null)) && (
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    {limitLine(limitOf(null))}
                  </span>
                )}
              </>
            }
          >
            <RowActions>
              {limitAction(null, 'Все категории')}
              <EmptySlot />
              <EmptySlot />
              <EmptySlot />
            </RowActions>
          </ListRow>
        )}
        {active.map((category) => (
          <EditableRow
            key={category.id}
            name={category.name}
            meta={limitLine(limitOf(category.id))}
            leading={config && limitAction(category.id, category.name)}
            onRename={(name) => update.mutateAsync({ id: category.id, patch: { name } })}
          >
            {active.length > 1 ? (
              <ActionButton
                label={`Объединить: ${category.name}`}
                onClick={() => setMerging(category)}
                icon={<MergeIcon />}
              />
            ) : (
              <EmptySlot />
            )}
            <ActionButton
              label={`В архив: ${category.name}`}
              onClick={() => update.mutate({ id: category.id, patch: { archived: true } })}
              tone="danger"
              icon={<ArchiveIcon />}
            />
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
                main={<span className="block text-zinc-500">{category.name}</span>}
              >
                <RowActions>
                  <ActionButton
                    label={`Вернуть: ${category.name}`}
                    onClick={() => update.mutate({ id: category.id, patch: { archived: false } })}
                    tone="success"
                    icon={<UndoIcon />}
                  />
                </RowActions>
              </ListRow>
            ))}
          </ul>
        </details>
      )}
      <ErrorNotice mutations={[add, update]} />
      {limiting && (
        <LimitDialog
          label={limiting.label}
          categoryId={limiting.id}
          budget={limitOf(limiting.id)}
          currency={currency}
          digits={digits}
          onClose={() => setLimiting(null)}
        />
      )}
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
