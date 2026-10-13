import { useState } from 'react';
import { ChevronRightSmallIcon } from '../../../shared/ui/icons.tsx';
import { Modal } from '../../../shared/ui/Modal.tsx';
import { compactInputClass } from '../../group/components/styles.ts';
import { toErrorMessage } from '../../group/model/error-message.ts';
import { updateAdminAi, type AdminAi } from '../api/admin.api.ts';
import { useRefreshAdminAi } from '../hooks/useAdminAi.ts';
import { useAdminMutation } from '../hooks/useAdminMutation.ts';
import { AiKeySheet } from './AiKeyForm.tsx';

function SettingRow({
  label,
  value,
  onOpen,
}: {
  label: string;
  value: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-12 w-full items-center gap-3 px-3 text-left text-sm"
    >
      <span className="flex-1">{label}</span>
      <span className="truncate text-zinc-500 dark:text-zinc-400">{value}</span>
      <span aria-hidden="true" className="shrink-0 text-zinc-400">
        <ChevronRightSmallIcon />
      </span>
    </button>
  );
}

interface ValueSheetProps {
  title: string;
  hint: string;
  initial: string;
  numeric?: boolean;
  onSave: (value: string) => void;
  onClose: () => void;
  pending: boolean;
  error: unknown;
}

/** A small window to edit one value: a field and «Сохранить». */
function ValueSheet({
  title,
  hint,
  initial,
  numeric,
  onSave,
  onClose,
  pending,
  error,
}: ValueSheetProps) {
  const [value, setValue] = useState(initial);
  const valid = value.trim() !== '';
  return (
    <Modal title={title} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onSave(value.trim());
        }}
        className="space-y-3 pb-2"
      >
        <input
          aria-label={title}
          type="text"
          inputMode={numeric ? 'numeric' : 'text'}
          value={value}
          onChange={(event) =>
            setValue(numeric ? event.target.value.replace(/\D/g, '') : event.target.value)
          }
          className={`${compactInputClass} w-full`}
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
        <button
          type="submit"
          disabled={!valid || pending}
          className="h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-500"
        >
          Сохранить
        </button>
        {error != null && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {toErrorMessage(error)}
          </p>
        )}
      </form>
    </Modal>
  );
}

type Editing = 'model' | 'limit' | 'key' | null;

interface AiSettingsListProps {
  ai: AdminAi;
  /** Set from outside («Заменить» opens the key window) */
  editing: Editing;
  onEdit: (value: Editing) => void;
}

/** The settings in one tinted frame: «Модель — …», «Лимит чеков в сутки — …», «API-ключ — …»; a tap opens a window. */
export function AiSettingsList({ ai, editing, onEdit }: AiSettingsListProps) {
  const refresh = useRefreshAdminAi();
  const update = useAdminMutation(updateAdminAi, async () => {
    await refresh();
    onEdit(null);
  });

  return (
    <>
      <div className="divide-y divide-zinc-200 rounded-xl bg-zinc-50 dark:divide-zinc-700 dark:bg-zinc-800/40">
        <SettingRow label="Модель" value={ai.model} onOpen={() => onEdit('model')} />
        <SettingRow
          label="Лимит чеков в сутки"
          value={String(ai.dailyLimit)}
          onOpen={() => onEdit('limit')}
        />
        <SettingRow
          label="API-ключ"
          value={ai.keyConfigured ? `…${ai.keyHint ?? ''}` : 'не задан'}
          onOpen={() => onEdit('key')}
        />
      </div>
      {editing === 'model' && (
        <ValueSheet
          title="Модель"
          hint="Идентификатор Gemini, по умолчанию gemini-3.8-flash"
          initial={ai.model}
          onSave={(model) => update.mutate({ model })}
          onClose={() => onEdit(null)}
          pending={update.isPending}
          error={update.error}
        />
      )}
      {editing === 'limit' && (
        <ValueSheet
          title="Лимит чеков в сутки"
          hint="Сколько чеков группа может разобрать за сутки"
          initial={String(ai.dailyLimit)}
          numeric
          onSave={(limit) => update.mutate({ dailyLimit: Number(limit) })}
          onClose={() => onEdit(null)}
          pending={update.isPending}
          error={update.error}
        />
      )}
      {editing === 'key' && <AiKeySheet ai={ai} onClose={() => onEdit(null)} />}
    </>
  );
}
