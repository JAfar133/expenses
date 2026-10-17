import { Link } from 'react-router';
import { Modal } from '../../../shared/ui/Modal.tsx';
import type { Template } from '../api/templates.api.ts';
import { amountText, templateLabel } from '../model/available.ts';

interface TemplatesSheetProps {
  templates: Template[];
  onApply: (template: Template) => void;
  /** Open the template in the form instead of creating the expense at once */
  onOpenInForm: (template: Template) => void;
  onClose: () => void;
}

/** One flat list in the user's own order (the same as the strip over the form). */
function TemplateList({ templates, onApply, onOpenInForm }: Omit<TemplatesSheetProps, 'onClose'>) {
  if (templates.length === 0) return null;
  return (
    <ul>
      {templates.map((template) => (
        <li
          key={template.id}
          className="flex items-center gap-2 border-b border-zinc-100 last:border-0 dark:border-zinc-800"
        >
          <button
            type="button"
            onClick={() => onApply(template)}
            className="min-h-14 min-w-0 flex-1 py-2 text-left"
          >
            <span className="block truncate font-semibold">{templateLabel(template)}</span>
            <span className="block truncate text-sm text-zinc-500 dark:text-zinc-400">
              {template.scope === 'group' && (
                <span className="mr-1.5 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  Группа
                </span>
              )}
              {template.category} · {amountText(template)}
            </span>
          </button>
          {template.amount !== null && (
            <>
              <button
                type="button"
                onClick={() => onApply(template)}
                aria-label={`${template.name}: добавить сразу`}
                className="h-10 shrink-0 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-500"
              >
                Добавить
              </button>
              <button
                type="button"
                onClick={() => onOpenInForm(template)}
                aria-label={`${template.name}: открыть в форме`}
                className="h-10 shrink-0 rounded-lg px-2.5 text-sm font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950"
              >
                В форму
              </button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** «Быстрые траты»: every template the user can use, in the user's own order. */
export function TemplatesSheet({ templates, onApply, onOpenInForm, onClose }: TemplatesSheetProps) {
  const choose = (action: (template: Template) => void) => (template: Template) => {
    onClose();
    action(template);
  };
  const common = { onApply: choose(onApply), onOpenInForm: choose(onOpenInForm) };

  return (
    <Modal title="Быстрые траты" onClose={onClose}>
      <TemplateList templates={templates} {...common} />
      <Link
        to="/settings/templates"
        onClick={onClose}
        className="mt-3 inline-block py-2 text-sm font-medium text-indigo-600 dark:text-indigo-300"
      >
        Настроить шаблоны
      </Link>
    </Modal>
  );
}
