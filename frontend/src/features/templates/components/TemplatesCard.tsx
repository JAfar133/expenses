import { useState } from 'react';
import { Link } from 'react-router';
import { ActionMenu, type MenuAction } from '../../../shared/ui/ActionMenu.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import {
  BoltIcon,
  ChipsIcon,
  EyeIcon,
  EyeOffIcon,
  PencilIcon,
  TrashIcon,
} from '../../../shared/ui/icons.tsx';
import { Toast } from '../../../shared/ui/Toast.tsx';
import { ApiError } from '../../../shared/api/http.ts';
import { ConfirmDialog } from '../../analytics/components/ConfirmDialog.tsx';
import { useCurrentUser } from '../../auth/hooks/useAuth.ts';
import { useBooleanPreference } from '../../preferences/hooks/usePreferences.ts';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import type { Template } from '../api/templates.api.ts';
import { useTemplateActions, useTemplates } from '../hooks/useTemplates.ts';
import {
  amountText,
  authorLine,
  previewTemplates,
  STRIP_SIZE,
  templateLabel,
} from '../model/available.ts';
import { reorderInSlots } from '../model/reorder.ts';
import { useSortableList } from '../hooks/useSortableList.ts';
import { DragHandle, MoveAnnouncer } from './DragHandle.tsx';
import { ChoiceSetting } from './ChoiceSetting.tsx';
import { TemplateDialog, type TemplateDraft } from './TemplateDialog.tsx';

const toDraft = (template: Template): TemplateDraft => ({ ...template });

/** «Шаблоны»: the user's own (order, share, change, remove) and the group's (show or hide, the owner changes). */
export function TemplatesCard() {
  const { data: user } = useCurrentUser();
  const { data: templates = [] } = useTemplates();
  const actions = useTemplateActions();
  const [hideGroup, setHideGroup] = useBooleanPreference('templates.hideGroup', false);
  const [strip, setStrip] = useBooleanPreference('templates.strip', true);
  const [editing, setEditing] = useState<TemplateDraft | null>(null);
  const [removing, setRemoving] = useState<Template | null>(null);
  const [sharing, setSharing] = useState<Template | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const isOwner = user?.role === 'owner';
  const group = templates.filter((template) => template.scope === 'group' && !template.pending);
  // The owner reviews every proposal; a member sees their own that still wait
  const proposals = templates.filter((template) => template.pending);
  const preview = previewTemplates(templates, hideGroup);
  const shownIds = preview.shown.map((template) => template.id);

  /** The dropped order of the shown rows goes back into the slots of the whole list (hidden ones keep theirs). */
  const drop = (ids: string[]) => {
    const active = templates.filter((template) => !template.pending);
    const ordered = ids
      .map((id) => active.find((template) => template.id === id))
      .filter((template): template is Template => template !== undefined);
    actions.reorder.mutate(reorderInSlots(active, ordered).map((template) => template.id));
  };
  const sortable = useSortableList({
    ids: shownIds,
    labelOf: (id) => templates.find((template) => template.id === id)?.name ?? '',
    onDrop: drop,
  });
  const failure = [
    actions.reorder,
    actions.update,
    actions.hide,
    actions.remove,
    actions.share,
    actions.approve,
  ].find((mutation) => mutation.isError)?.error;

  const edit: (template: Template) => MenuAction = (template) => ({
    label: 'Изменить',
    icon: <PencilIcon />,
    onSelect: () => setEditing(toDraft(template)),
  });
  const remove = (template: Template, label = 'Удалить'): MenuAction => ({
    label,
    icon: <TrashIcon />,
    tone: 'danger',
    onSelect: () => setRemoving(template),
  });

  const menuOf = (template: Template): MenuAction[] => {
    if (template.pending) {
      // The owner reviews proposals on the group page; an author changes or takes back their own
      return template.editable && !isOwner ? [edit(template), remove(template, 'Отозвать')] : [];
    }
    if (template.scope === 'group') {
      return template.editable ? [edit(template), remove(template)] : [];
    }
    return [
      edit(template),
      ...(template.sharedStatus === null
        ? [
            {
              label: isOwner ? 'Опубликовать в группе' : 'Предложить группе',
              onSelect: () => setSharing(template),
            },
          ]
        : []),
      remove(template),
    ];
  };

  /** What the second line says about a template besides its category and amount. */
  const noteOf = (template: Template): string => {
    if (template.pending && template.unavailable) return ' · категория в архиве';
    if (template.pending) return template.mine || !isOwner ? ' · ждёт решения владельца' : '';
    if (template.scope === 'personal' && template.sharedStatus === 'proposed') {
      return ' · предложен группе';
    }
    if (template.scope === 'personal' && template.sharedStatus === 'active')
      return ' · есть в группе';
    return '';
  };

  const rowText = (template: Template) => (
    <>
      <div className="truncate font-medium">{templateLabel(template)}</div>
      <div className="truncate text-sm text-zinc-500 dark:text-zinc-400">
        {template.scope === 'group' && !template.pending && (
          <span className="mr-1.5 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
            Группа
          </span>
        )}
        {template.category} · {amountText(template)}
        {noteOf(template)}
      </div>
      {template.scope === 'group' && (
        <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
          {authorLine(template, user?.displayName)}
        </div>
      )}
    </>
  );

  /** A row of the list. `sortable`: it has a drag handle; `reason`: it is not offered, and why. */
  const row = (template: Template, options: { sortable?: boolean; reason?: string } = {}) => {
    const menu = menuOf(template);
    const dim = template.hidden || options.reason ? ' opacity-60' : '';
    return (
      <li
        key={template.id}
        {...sortable.rowProps(template.id)}
        className="flex items-center gap-2 border-b border-zinc-100 bg-white py-1.5 last:border-0 dark:border-zinc-800 dark:bg-zinc-900"
      >
        {options.sortable && (
          <DragHandle
            {...sortable.handleProps(template.id)}
            aria-label={`Переместить шаблон: ${template.name}`}
            title="Перетащите, чтобы изменить порядок (он только ваш)"
          />
        )}
        {/* The whole name area opens the edit window when the template may be changed */}
        {template.editable ? (
          <button
            type="button"
            aria-label={`Изменить шаблон: ${template.name}`}
            onClick={() => setEditing(toDraft(template))}
            className={'min-h-11 min-w-0 flex-1 text-left' + dim}
          >
            {rowText(template)}
          </button>
        ) : (
          <div className={'min-w-0 flex-1' + dim}>{rowText(template)}</div>
        )}
        {options.reason && !(template.scope === 'group' && options.reason === 'скрыт вами') && (
          <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
            {options.reason}
          </span>
        )}
        {template.scope === 'group' && !template.pending && (
          <button
            type="button"
            aria-pressed={!template.hidden}
            aria-label={`Показывать «${template.name}»`}
            onClick={() => actions.hide.mutate({ id: template.id, hidden: !template.hidden })}
            className={
              'relative flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition before:absolute before:inset-x-0 before:-inset-y-1 before:content-[""] ' +
              (template.hidden
                ? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300')
            }
          >
            <span className="[&>svg]:size-4">{template.hidden ? <EyeOffIcon /> : <EyeIcon />}</span>
            {template.hidden ? 'Скрыт' : 'Виден'}
          </button>
        )}
        <ActionMenu label={`Действия: ${template.name}`} actions={menu} />
      </li>
    );
  };

  /** A label between the parts of the list: where the templates are shown. */
  const label = (text: string, key: string) => (
    <li
      key={key}
      role="presentation"
      className="mt-2 border-b border-zinc-200 pt-1 pb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase first:mt-0 dark:border-zinc-700 dark:text-zinc-400"
    >
      {text}
    </li>
  );

  const heading = (text: string) => (
    <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
      {text}
    </h3>
  );

  const byId = new Map(preview.shown.map((template) => [template.id, template]));
  const orderedShown = sortable.order
    .map((id) => byId.get(id))
    .filter((template): template is Template => template !== undefined);
  return (
    <SettingsSection
      title="Шаблоны"
      description="Частые траты одним нажатием"
      compact
      action={
        <button
          type="button"
          onClick={() => setEditing({})}
          className="h-9 rounded-full bg-indigo-600 px-3.5 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          + Новый
        </button>
      }
    >
      <p className="-mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Порядок ваш: перетащите шаблон, чтобы поменять. По умолчанию сверху шаблоны группы, а новые
        групповые встают наверх
      </p>
      {failure && (
        <Notice variant="error">
          {failure instanceof ApiError ? failure.message : 'Не удалось выполнить действие'}
        </Notice>
      )}

      {templates.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Шаблонов пока нет. Создайте шаблон здесь или в меню «⋯» у операции
        </p>
      )}
      {(orderedShown.length > 0 || preview.tail.length > 0) && (
        <ul>
          {orderedShown.flatMap((template, index) => [
            ...(index === 0
              ? [
                  label(
                    strip ? 'Над формой' : 'В списке «Быстрые траты» (значок ⚡)',
                    'label-first',
                  ),
                ]
              : []),
            ...(strip && index === STRIP_SIZE
              ? [label('Только в списке «Все»', 'label-rest')]
              : []),
            row(template, { sortable: true }),
          ])}
          {preview.tail.length > 0 && label('Не показываются', 'label-tail')}
          {preview.tail.map(({ template, reason }) => row(template, { reason }))}
        </ul>
      )}
      {group.length > 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Шаблоны группы видят все участники. Скрыть можно только у себя
        </p>
      )}
      <MoveAnnouncer text={sortable.announcement} />
      {isOwner && proposals.length > 0 && (
        <p className="text-sm">
          <Link to="/group" className="font-medium text-indigo-600 dark:text-indigo-400">
            {proposalsText(proposals.length)} решения → Группа
          </Link>
        </p>
      )}
      {!isOwner && proposals.length > 0 && (
        <div>
          {heading('Ждут решения владельца')}
          <ul>{proposals.map((template) => row(template))}</ul>
        </div>
      )}

      <div className="space-y-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        <h3 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          Как показывать
        </h3>
        <ChoiceSetting
          title="Над формой «Добавить»"
          value={strip ? 'chips' : 'icon'}
          onChange={(value) => setStrip(value === 'chips')}
          choices={[
            { value: 'chips', label: 'Кнопки', icon: <ChipsIcon /> },
            { value: 'icon', label: 'Только значок ⚡', icon: <BoltIcon size={24} /> },
          ]}
          helper={
            strip
              ? 'Три первых шаблона показаны кнопками над полями формы, остальные в списке «Все»'
              : 'Над формой остаётся только значок ⚡, шаблоны открываются по нажатию'
          }
          preview={<StripPreview chips={strip} />}
        />
        {group.length > 0 && (
          <ChoiceSetting
            title="Шаблоны группы"
            value={hideGroup ? 'hide' : 'show'}
            onChange={(value) => setHideGroup(value === 'hide')}
            choices={[
              { value: 'show', label: 'Показывать', icon: <EyeIcon /> },
              { value: 'hide', label: 'Скрыть все', icon: <EyeOffIcon /> },
            ]}
            helper={
              hideGroup
                ? 'Групповые шаблоны не показываются нигде, остаются только ваши. Вернуть их можно здесь же'
                : 'Групповые шаблоны доступны наравне с вашими'
            }
          />
        )}
      </div>

      {sharing && (
        <ConfirmDialog
          title={isOwner ? 'Опубликовать в группе?' : 'Предложить группе?'}
          message={
            isOwner
              ? `Опубликовать «${sharing.name}» для всей группы? Её увидят все участники, а изменить её сможете вы и автор`
              : `Предложить «${sharing.name}» группе? Владелец группы решит, включить ли шаблон`
          }
          confirmLabel={isOwner ? 'Опубликовать' : 'Предложить'}
          busy={actions.share.isPending}
          onCancel={() => setSharing(null)}
          onConfirm={() =>
            actions.share.mutate(sharing.id, {
              onSuccess: (result) =>
                setToast(
                  (result?.status ?? (isOwner ? 'active' : 'proposed')) === 'active'
                    ? 'Шаблон опубликован в группе'
                    : 'Предложение отправлено владельцу',
                ),
              onSettled: () => setSharing(null),
            })
          }
        />
      )}
      {toast && <Toast onDismiss={() => setToast(null)}>{toast}</Toast>}
      {editing && <TemplateDialog draft={editing} onClose={() => setEditing(null)} />}
      {removing && (
        <ConfirmDialog
          title="Удалить шаблон?"
          message={`Шаблон «${removing.name}» исчезнет из списка. Созданные по нему расходы останутся.`}
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

/** A tiny non-interactive picture of the strip: three chips or one bolt chip. */
function StripPreview({ chips }: { chips: boolean }) {
  const chip = 'h-5 rounded-full bg-zinc-200 dark:bg-zinc-700';
  return (
    <div aria-hidden="true" className="flex shrink-0 items-center gap-1">
      {chips ? (
        <>
          <span className={chip + ' w-8'} />
          <span className={chip + ' w-8'} />
          <span className={chip + ' w-8'} />
        </>
      ) : (
        <span className={chip + ' flex w-8 items-center justify-center text-indigo-600'}>
          <BoltIcon size={12} />
        </span>
      )}
    </div>
  );
}

/** «1 предложение ждёт», «2 предложения ждут», «5 предложений ждут» */
const proposalsText = (count: number) => {
  const last = count % 10;
  const teen = count % 100 >= 11 && count % 100 <= 14;
  if (last === 1 && !teen) return `${count} предложение ждёт`;
  if (last >= 2 && last <= 4 && !teen) return `${count} предложения ждут`;
  return `${count} предложений ждут`;
};
