import { useState } from 'react';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { Switch } from '../../../shared/ui/Switch.tsx';
import { compactInputClass, textButtonClass } from '../../group/components/styles.ts';
import { toErrorMessage } from '../../group/model/error-message.ts';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import { updateAdminAi, type AdminAi } from '../api/admin.api.ts';
import { useAdminAi, useRefreshAdminAi } from '../hooks/useAdminAi.ts';
import { useAdminMutation } from '../hooks/useAdminMutation.ts';
import { AiGroupsList } from './AiGroupsList.tsx';
import { AiKeyForm } from './AiKeyForm.tsx';

/** A text setting with its own «Сохранить», shown only when the value changed. */
function TextSetting({
  label,
  value,
  numeric = false,
  onSave,
}: {
  label: string;
  value: string;
  numeric?: boolean;
  onSave: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const changed = text.trim() !== value && text.trim() !== '';
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium" htmlFor={`ai-${label}`}>
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={`ai-${label}`}
          type="text"
          inputMode={numeric ? 'numeric' : 'text'}
          value={text}
          onChange={(event) =>
            setText(numeric ? event.target.value.replace(/\D/g, '') : event.target.value)
          }
          className={compactInputClass}
        />
        {changed && (
          <button type="button" onClick={() => onSave(text.trim())} className={textButtonClass}>
            Сохранить
          </button>
        )}
      </div>
    </div>
  );
}

function AiBody({ ai }: { ai: AdminAi }) {
  const refresh = useRefreshAdminAi();
  const update = useAdminMutation(updateAdminAi, refresh);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium">Разбор чеков включён</div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Выключатель для всей установки; владелец группы включает разбор для своей группы
          </p>
        </div>
        <Switch
          checked={ai.enabled}
          label="Включить ИИ для установки"
          disabled={update.isPending}
          onChange={(enabled) => update.mutate({ enabled })}
        />
      </div>

      <AiKeyForm ai={ai} />

      <TextSetting label="Модель" value={ai.model} onSave={(model) => update.mutate({ model })} />
      <TextSetting
        label="Разборов в сутки на группу"
        value={String(ai.dailyLimit)}
        numeric
        onSave={(dailyLimit) => update.mutate({ dailyLimit: Number(dailyLimit) })}
      />

      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Использовано: сегодня {ai.usage.today}, за 30 дней {ai.usage.month}, ошибок за 30 дней{' '}
        {ai.usage.errorsMonth}
      </p>
      {update.isError && <Notice variant="error">{toErrorMessage(update.error)}</Notice>}

      <AiGroupsList groups={ai.groups} />
    </div>
  );
}

/** The «ИИ (Gemini)» block of the administration page. */
export function AdminAiSection() {
  const ai = useAdminAi();

  return (
    <SettingsSection
      title="ИИ (Gemini)"
      hint="Название, дата и позиции чека заполняются по фото. Ключ хранится на сервере и в ответах не возвращается."
    >
      {ai.isError && <Notice variant="error">{toErrorMessage(ai.error)}</Notice>}
      {ai.data && <AiBody ai={ai.data} />}
    </SettingsSection>
  );
}
