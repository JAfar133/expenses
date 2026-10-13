import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toSaveErrorMessage } from '../../expenses/api/save-error-message.ts';
import { parseDecimal } from '../../../shared/utils/money.ts';
import { acceptAi, parseReceipt } from '../../ai/api/ai.api.ts';
import { useAiAvailable } from '../../ai/hooks/useAiStatus.ts';
import { useReceiptSettings } from '../../receipts/hooks/useReceiptSettings.ts';
import { ITEMS_KEY, parseFailureMessage } from '../../ai/model/parse-runner.ts';
import { ANALYTICS_KEY } from '../../analytics/hooks/useAnalytics.ts';
import type { OperationItem } from '../../analytics/api/operations.api.ts';
import type { ExpenseItem } from '../api/items.api.ts';
import { useItems, useSaveItems } from '../hooks/useItems.ts';
import { draftsToInputs, itemsToDrafts, type DraftItem } from '../model/draft-items.ts';
import { DISCREPANCY_HINT, discrepancyNote, sumItems } from '../model/items-sum.ts';
import { ItemsEditor } from './ItemsEditor.tsx';

const buttonClass =
  'h-10 rounded-lg border border-zinc-300 px-3 text-sm font-medium hover:border-indigo-400 disabled:opacity-60 dark:border-zinc-700';

interface ItemsSectionProps {
  item: OperationItem;
  /** Currency of the card: the amount of the operation and the prices are in it */
  currency: string;
  baseCurrency: string;
  /** The record itself changed on the server (AI parsed again, generated data accepted): the window closes */
  onChanged: (message: string) => void;
}

/** «Позиции» in the edit window: the list with the editor, the AI marks and what to do with the generated. */
export function ItemsSection(props: ItemsSectionProps) {
  const items = useItems(props.item.id);
  if (items.isPending) return <p className="text-sm text-zinc-500">Загрузка позиций…</p>;
  if (items.isError) {
    return <p className="text-sm text-zinc-500">Не удалось загрузить позиции</p>;
  }
  // The rows start again from the server list after every save
  return <ItemsForm key={items.dataUpdatedAt} {...props} saved={items.data} />;
}

function ItemsForm({
  item,
  currency,
  baseCurrency,
  saved,
  onChanged,
}: ItemsSectionProps & { saved: ExpenseItem[] }) {
  const queryClient = useQueryClient();
  // The AI reads receipts only in the categories the owner allowed it in
  const aiSettings = useReceiptSettings().data;
  const aiAvailable =
    useAiAvailable() &&
    (aiSettings?.aiCategories === undefined || aiSettings.aiCategories.includes(item.category));
  const [drafts, setDrafts] = useState<DraftItem[]>(() => itemsToDrafts(saved));
  const [problem, setProblem] = useState<string>();
  const [offered, setOffered] = useState(false);
  const save = useSaveItems(item.id);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ANALYTICS_KEY });
    void queryClient.invalidateQueries({ queryKey: ITEMS_KEY(item.id) });
  };

  const parse = useMutation({
    retry: false,
    mutationFn: (replace: boolean) => parseReceipt(item.id, replace),
    onSuccess: (result, replace) => {
      refresh();
      if (result.itemsOffered && !replace) return setOffered(true);
      onChanged('Чек разобран ИИ');
    },
  });
  const accept = useMutation({
    retry: false,
    mutationFn: () => acceptAi(item.id),
    onSuccess: () => {
      refresh();
      onChanged('Сгенерированное принято');
    },
  });

  const hasAi =
    saved.some((row) => row.source === 'ai') ||
    item.nameSource === 'ai' ||
    item.dateSource === 'ai';
  const filled = drafts.filter((row) => row.name.trim() || row.price.trim() || row.quantity.trim());
  const sum = sumItems(filled.map((row) => ({ price: parseDecimal(row.price) ?? 0 })));
  const note = filled.length > 0 ? discrepancyNote(item.amount, sum, currency, baseCurrency) : null;
  const changed = JSON.stringify(drafts) !== JSON.stringify(itemsToDrafts(saved));
  const failure = [save, parse, accept].find((mutation) => mutation.isError)?.error;

  const submit = () => {
    const result = draftsToInputs(drafts);
    if ('error' in result) return setProblem(result.error);
    setProblem(undefined);
    save.mutate(result.items);
  };

  return (
    <section aria-label="Позиции" className="space-y-2">
      <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Позиции</div>
      <ItemsEditor value={drafts} onChange={setDrafts} />
      {note && (
        <p title={DISCREPANCY_HINT} className="text-xs text-zinc-500 dark:text-zinc-400">
          {note}
        </p>
      )}
      {(problem || failure != null) && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {problem ?? (parse.isError ? parseFailureMessage(failure) : toSaveErrorMessage(failure))}
        </p>
      )}
      {offered && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
          <span>В чеке есть позиции, которых нет в списке.</span>
          <button
            type="button"
            disabled={parse.isPending}
            onClick={() => parse.mutate(true)}
            className={buttonClass}
          >
            Заменить позиции из чека
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {changed && (
          <button type="button" disabled={save.isPending} onClick={submit} className={buttonClass}>
            {save.isPending ? 'Сохраняем…' : 'Сохранить позиции'}
          </button>
        )}
        {aiAvailable && item.hasReceipt && (
          <button
            type="button"
            disabled={parse.isPending}
            onClick={() => parse.mutate(false)}
            className={buttonClass}
          >
            {parse.isPending ? 'Разбираем…' : 'Разобрать чек заново'}
          </button>
        )}
        {hasAi && (
          <button
            type="button"
            disabled={accept.isPending}
            onClick={() => accept.mutate()}
            className={buttonClass}
          >
            Принять сгенерированное
          </button>
        )}
      </div>
    </section>
  );
}
