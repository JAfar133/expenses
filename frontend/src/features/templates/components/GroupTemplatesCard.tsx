import { useState } from 'react';
import { ApiError } from '../../../shared/api/http.ts';
import { ActionMenu, type MenuAction } from '../../../shared/ui/ActionMenu.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { PencilIcon, PlusIcon, TrashIcon } from '../../../shared/ui/icons.tsx';
import { ConfirmDialog } from '../../analytics/components/ConfirmDialog.tsx';
import { useCurrentUser } from '../../auth/hooks/useAuth.ts';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import type { Template } from '../api/templates.api.ts';
import { useTemplateActions, useTemplates } from '../hooks/useTemplates.ts';
import { amountText, authorLine, templateLabel } from '../model/available.ts';
import { useSortableList } from '../hooks/useSortableList.ts';
import { DragHandle, MoveAnnouncer } from './DragHandle.tsx';
import { TemplateDialog, type TemplateDraft } from './TemplateDialog.tsx';

const heading = (text: string) => (
  <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
    {text}
  </h3>
);

/** «Шаблоны группы» on the owner's page: review the members' proposals, manage the group's templates. */
export function GroupTemplatesCard() {
  const { data: user } = useCurrentUser();
  const { data: templates = [] } = useTemplates();
  const actions = useTemplateActions();
  const [editing, setEditing] = useState<TemplateDraft | null>(null);
  const [removing, setRemoving] = useState<Template | null>(null);

  const proposals = templates.filter((template) => template.scope === 'group' && template.pending);
  const active = templates.filter((template) => template.scope === 'group' && !template.pending);
  const failure = [actions.reorderGroup, actions.approve, actions.remove].find(
    (mutation) => mutation.isError,
  )?.error;

  const sortable = useSortableList({
    ids: active.map((template) => template.id),
    labelOf: (id) => active.find((template) => template.id === id)?.name ?? '',
    onDrop: (ids) => actions.reorderGroup.mutate(ids),
  });
  const orderedActive = sortable.order
    .map((id) => active.find((template) => template.id === id))
    .filter((template): template is Template => template !== undefined);

  const edit = (template: Template): MenuAction => ({
    label: 'Изменить',
    icon: <PencilIcon />,
    onSelect: () => setEditing({ ...template }),
  });

  const menuOf = (template: Template): MenuAction[] => {
    if (template.pending) return [edit(template)];
    return [
      edit(template),
      {
        label: 'Удалить',
        icon: <TrashIcon />,
        tone: 'danger' as const,
        onSelect: () => setRemoving(template),
      },
    ];
  };

  const row = (template: Template, sortableRow = false) => (
    <li
      key={template.id}
      {...sortable.rowProps(template.id)}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-100 bg-white py-2 last:border-0 dark:border-zinc-800 dark:bg-zinc-900"
    >
      {sortableRow && (
        <DragHandle
          {...sortable.handleProps(template.id)}
          aria-label={`Переместить шаблон: ${template.name}`}
          title="Перетащите, чтобы изменить порядок по умолчанию"
        />
      )}
      <button
        type="button"
        aria-label={`Изменить шаблон: ${template.name}`}
        onClick={() => setEditing({ ...template })}
        className="min-h-11 min-w-0 flex-1 basis-40 text-left"
      >
        <div className="truncate font-medium">{templateLabel(template)}</div>
        <div className="truncate text-sm text-zinc-500 dark:text-zinc-400">
          {template.category} · {amountText(template)}
          {template.unavailable && ' · категория в архиве'}
        </div>
        <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
          {authorLine(template, user?.displayName)}
        </div>
      </button>
      {template.pending && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={`Включить «${template.name}»`}
            disabled={actions.approve.isPending}
            onClick={() => actions.approve.mutate(template.id)}
            className="h-11 rounded-full bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            Включить
          </button>
          <button
            type="button"
            aria-label={`Отклонить «${template.name}»`}
            disabled={actions.remove.isPending}
            onClick={() => actions.remove.mutate(template.id)}
            className="h-11 rounded-full bg-zinc-100 px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-200 disabled:opacity-60 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            Отклонить
          </button>
        </div>
      )}
      <ActionMenu label={`Действия: ${template.name}`} actions={menuOf(template)} />
    </li>
  );

  return (
    <SettingsSection
      title={
        proposals.length > 0
          ? `Шаблоны группы · ${proposals.length} ${proposals.length === 1 ? 'новый' : 'новых'}`
          : 'Шаблоны группы'
      }
      description="Быстрые траты для всех участников. Каждый может скрыть их у себя в личных настройках"
      compact
      action={
        <button
          type="button"
          onClick={() => setEditing({ scope: 'group' })}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-indigo-200 px-3 text-sm font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
        >
          <PlusIcon />
          Новый
        </button>
      }
    >
      {failure && (
        <Notice variant="error">
          {failure instanceof ApiError ? failure.message : 'Не удалось выполнить действие'}
        </Notice>
      )}
      {proposals.length > 0 && (
        <div>
          {heading('Предложения участников')}
          <ul>{proposals.map((template) => row(template))}</ul>
        </div>
      )}
      <div>
        {proposals.length > 0 && heading('Шаблоны группы')}
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Порядок по умолчанию. Если участник расставил шаблоны сам, новые групповые встанут у него
          наверх
        </p>
        {active.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Групповых шаблонов пока нет. Создайте свой или включите предложение участника
          </p>
        ) : (
          <ul>{orderedActive.map((template) => row(template, true))}</ul>
        )}
      </div>

      <MoveAnnouncer text={sortable.announcement} />
      {editing && (
        <TemplateDialog draft={editing} fixedScope="group" onClose={() => setEditing(null)} />
      )}
      {removing && (
        <ConfirmDialog
          title="Удалить шаблон?"
          message={`Шаблон «${removing.name}» исчезнет у всей группы. Созданные по нему расходы останутся.`}
          confirmLabel="Удалить"
          busy={actions.remove.isPending}
          onCancel={() => setRemoving(null)}
          onConfirm={() =>
            actions.remove.mutate(removing.id, { onSettled: () => setRemoving(null) })
          }
        />
      )}
    </SettingsSection>
  );
}
