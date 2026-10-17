import { formatMoney } from '../../../shared/utils/money.ts';
import type { Template } from '../api/templates.api.ts';

/** How many chips the row above the form shows; the rest are behind «Все». */
export const STRIP_SIZE = 3;

/**
 * A personal template and its group copy are the same button. The list carries no link between them, so they are
 * matched by what they do: the same name, category, expense name, amount, currency and card.
 */
const sameTemplate = (a: Template, b: Template) =>
  a.name === b.name &&
  a.category === b.category &&
  a.expenseName === b.expenseName &&
  a.amount === b.amount &&
  a.currency === b.currency &&
  a.card === b.card;

/** Why a template is not offered to the user. */
export type HiddenReason =
  'скрыт вами' | 'скрыты все групповые' | 'категория в архиве' | 'заменён групповым';

export interface TemplatePreview {
  /** What the user can tap, in the order of the strip: the user's own order, as the server sends it */
  shown: Template[];
  /** What is left out, with the reason */
  tail: { template: Template; reason: HiddenReason }[];
}

/**
 * Sorts the user's templates into those they can tap now and the rest with a reason. The order is the user's own
 * (the server sends it: by default group templates first, then personal ones). Proposals are not templates yet. A personal template that is shared and
 * active is not offered again while its group copy is usable for the user (if they hide the group copy, or all
 * group templates, the personal one comes back).
 */
export const previewTemplates = (templates: Template[], hideGroup: boolean): TemplatePreview => {
  const ordered = templates.filter((template) => !template.pending);
  const usableGroup = ordered.filter(
    (template) =>
      template.scope === 'group' && !template.unavailable && !template.hidden && !hideGroup,
  );
  const preview: TemplatePreview = { shown: [], tail: [] };
  for (const template of ordered) {
    const reason: HiddenReason | null = template.unavailable
      ? 'категория в архиве'
      : template.scope === 'group' && hideGroup
        ? 'скрыты все групповые'
        : template.hidden
          ? 'скрыт вами'
          : template.scope === 'personal' &&
              template.sharedStatus === 'active' &&
              usableGroup.some((copy) => sameTemplate(template, copy))
            ? 'заменён групповым'
            : null;
    if (reason) preview.tail.push({ template, reason });
    else preview.shown.push(template);
  }
  return preview;
};

/** Templates the user can tap now, in the user's own order. */
export const usableTemplates = (templates: Template[], hideGroup: boolean): Template[] =>
  previewTemplates(templates, hideGroup).shown;

/** The text of a button: the emoji, if there is one, and the name. */
export const templateLabel = (template: Template): string =>
  template.emoji ? `${template.emoji} ${template.name}` : template.name;

/** Whether the user already has a template for this category and expense name (no need to offer another). */
export const hasTemplateFor = (templates: Template[], category: string, name: string): boolean =>
  templates.some(
    (template) =>
      template.category === category &&
      template.expenseName.trim().toLowerCase() === name.trim().toLowerCase(),
  );

/** «1 200 AMD», or «сумма?» for a template without an amount. */
export const amountText = (template: Template): string =>
  template.amount === null
    ? 'сумма?'
    : `${formatMoney(template.amount)} ${template.currency ?? ''}`.trim();

/** «17 окт.»; the year only when it is not the current one. */
export function shortDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat('ru', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
    .format(date)
    .replace(/\s?г\.$/, '');
}

/**
 * The muted line of a group template: «Автор: Настя · изменил Миша, 17 окт.». The user's own are «ваш шаблон»
 * and «вы»; the editor is left out when the template was never changed.
 */
export function authorLine(template: Template, selfName?: string, now = new Date()): string {
  const base = template.mine ? 'ваш шаблон' : `Автор: ${template.author}`;
  if (!template.updatedBy) return base;
  const date = template.updatedAt ? shortDate(template.updatedAt, now) : '';
  if (template.updatedBy === template.author) {
    return date ? `${base} · изменён ${date}` : `${base} · изменён`;
  }
  const who = template.updatedBy === selfName ? 'изменили вы' : `изменил ${template.updatedBy}`;
  return `${base} · ${date ? `${who}, ${date}` : who}`;
}
