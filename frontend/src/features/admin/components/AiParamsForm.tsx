import { useState } from 'react';
import { AccordionItem } from '../../../shared/ui/AccordionItem.tsx';
import { compactInputClass, textButtonClass } from '../../group/components/styles.ts';
import { toErrorMessage } from '../../group/model/error-message.ts';
import { updateAdminAi, type AdminAi } from '../api/admin.api.ts';
import { useRefreshAdminAi } from '../hooks/useAdminAi.ts';
import { useAdminMutation } from '../hooks/useAdminMutation.ts';

/** Step 2, folded away: the model and the common daily limit, one small form with one «Сохранить». */
export function AiParamsForm({ ai }: { ai: AdminAi }) {
  const refresh = useRefreshAdminAi();
  const [model, setModel] = useState(ai.model);
  const [limit, setLimit] = useState(String(ai.dailyLimit));
  const save = useAdminMutation(updateAdminAi, refresh);
  const parsedLimit = Number(limit);
  const valid = model.trim() !== '' && limit !== '' && Number.isInteger(parsedLimit);
  const changed = model.trim() !== ai.model || parsedLimit !== ai.dailyLimit;

  return (
    <AccordionItem
      title="Дополнительно"
      summary={`Модель ${ai.model} · лимит ${ai.dailyLimit} в сутки на группу`}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && changed) save.mutate({ model: model.trim(), dailyLimit: parsedLimit });
        }}
        className="space-y-3"
      >
        <div className="space-y-1">
          <label htmlFor="ai-model" className="block text-sm font-medium">
            Модель
          </label>
          <input
            id="ai-model"
            type="text"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            className={`${compactInputClass} w-full`}
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Идентификатор Gemini, по умолчанию gemini-3.8-flash
          </p>
        </div>
        <div className="space-y-1">
          <label htmlFor="ai-limit" className="block text-sm font-medium">
            Лимит
          </label>
          <input
            id="ai-limit"
            type="text"
            inputMode="numeric"
            value={limit}
            onChange={(event) => setLimit(event.target.value.replace(/\D/g, ''))}
            className={`${compactInputClass} w-32 flex-none`}
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Сколько чеков группа может разобрать за сутки
          </p>
        </div>
        <button
          type="submit"
          disabled={!valid || !changed || save.isPending}
          className={`${textButtonClass} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          Сохранить
        </button>
        {save.isError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {toErrorMessage(save.error)}
          </p>
        )}
      </form>
    </AccordionItem>
  );
}
