import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError } from '../../../shared/api/http.ts';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { currencyDigits } from '../../../shared/utils/conversion.ts';
import { formatAmount, formatMoney } from '../../../shared/utils/money.ts';
import { useCurrentUser } from '../../auth/hooks/useAuth.ts';
import { fetchCards } from '../../expenses/api/expenses.api.ts';
import { toSaveErrorMessage } from '../../expenses/api/save-error-message.ts';
import { useSyncState } from '../../sync/hooks/useSyncState.ts';
import type { OperationItem, SortColumn } from '../api/operations.api.ts';
import { ItemsSection } from '../../items/components/ItemsSection.tsx';
import { ReceiptEditor } from '../../receipts/components/ReceiptEditor.tsx';
import { ReceiptViewer } from '../../receipts/components/ReceiptViewer.tsx';
import { useReceiptSettings } from '../../receipts/hooks/useReceiptSettings.ts';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { EditExpenseDialog } from '../components/EditExpenseDialog.tsx';
import { OperationsTable } from '../components/OperationsTable.tsx';
import { useAnalyticsReference } from '../hooks/useAnalyticsReference.ts';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency.tsx';
import { useFilterOptions } from '../hooks/useFilterOptions.ts';
import { useFilterState } from '../hooks/useFilterState.ts';
import { useExpenseActions, useOperations } from '../hooks/useOperations.ts';
import { toApiFilters } from '../model/filter-state.ts';
import {
  clampPage,
  nextSort,
  PAGE_SIZE,
  pageCount,
  parseSort,
  rangeLabel,
} from '../model/operations.ts';

/**
 * Cards a record can be moved to: those the user may add to (the cards list is already limited for a member)
 * and in the same currency (the server rejects the rest).
 */
function cardsForEditing(
  item: OperationItem,
  cards: { name: string; currency: string }[] | undefined,
  reporting: string,
): string[] {
  if (!cards) return [];
  const own = item.currency || reporting;
  return cards.filter((card) => card.currency === own).map((card) => card.name);
}

/** "Operations" tab: all records with sorting and pages; editors can edit, delete and restore. */
export default function OperationsPage() {
  const { state, today } = useFilterState();
  const [params, setParams] = useSearchParams();
  const { data: user } = useCurrentUser();
  const canEdit = user?.canEdit ?? false;
  const { currency, baseCurrency } = useAnalyticsReference();
  // The list total is in the display currency; the rows keep the card currency and the reporting amount
  const { code: displayCurrency } = useDisplayCurrency();
  const cards = useQuery({ queryKey: ['cards'], queryFn: fetchCards, staleTime: Infinity });
  const options = useFilterOptions();
  const excelEnabled = useSyncState().data?.enabled ?? true;
  const { update, remove, restore } = useExpenseActions();

  const { sort, direction } = parseSort(params.get('sort'), params.get('dir'));
  const requestedPage = Number(params.get('page') ?? 1);
  const page = Number.isInteger(requestedPage) && requestedPage >= 1 ? requestedPage : 1;

  const filters = { ...toApiFilters(state, today), currency: displayCurrency };
  const list = useOperations(filters, {
    sort,
    direction,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const [editing, setEditing] = useState<OperationItem>();
  const [deleting, setDeleting] = useState<OperationItem>();
  const [viewingReceipt, setViewingReceipt] = useState<OperationItem>();
  const receiptSettings = useReceiptSettings().data;
  const receiptAllowed = (item: OperationItem) =>
    !!receiptSettings?.enabled && receiptSettings.categories.includes(item.category);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string }>();

  const setPage = (next: number) =>
    setParams(
      (current) => {
        const merged = new URLSearchParams(current);
        if (next <= 1) merged.delete('page');
        else merged.set('page', String(next));
        return merged;
      },
      { replace: true },
    );

  // When filters or sorting change, go back to the first page
  const filterKey = JSON.stringify([filters, sort, direction]);
  const previousKey = useRef(filterKey);
  useEffect(() => {
    if (previousKey.current === filterKey) return;
    previousKey.current = filterKey;
    setPage(1);
    // setPage depends only on setParams
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // The page became empty (e.g. after deleting the last record): go to the last one
  const total = list.data?.total ?? 0;
  const lastPage = clampPage(page, total);
  useEffect(() => {
    if (list.data && lastPage !== page && !list.isPlaceholderData) setPage(lastPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data, lastPage, page]);

  const changeSort = (column: SortColumn) => {
    const next = nextSort({ sort, direction }, column);
    setParams(
      (current) => {
        const merged = new URLSearchParams(current);
        merged.set('sort', next.sort);
        merged.set('dir', next.direction);
        return merged;
      },
      { replace: true },
    );
  };

  const authorLabel = (login: string) =>
    options.authors.find((author) => author.value === login)?.label ?? login;

  const done = (text: string) => setNotice({ kind: 'success', text });
  const failed = (error: unknown) => setNotice({ kind: 'error', text: toSaveErrorMessage(error) });

  const busyId = update.isPending
    ? editing?.id
    : remove.isPending
      ? deleting?.id
      : restore.isPending
        ? restore.variables
        : undefined;

  const items = list.data?.items ?? [];

  return (
    <section className="space-y-4 rounded-2xl bg-white p-4 shadow-sm sm:p-5 dark:bg-zinc-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Все операции</h2>
        {list.data && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Записей: <strong className="font-semibold">{list.data.total}</strong> на{' '}
            <strong className="font-semibold">
              {formatAmount(list.data.totalAmount, currencyDigits(displayCurrency, baseCurrency))}{' '}
              {displayCurrency}
            </strong>
          </p>
        )}
      </div>

      {!canEdit && !items.some((item) => item.editable) && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Режим просмотра: править и удалять записи может только редактор.
        </p>
      )}

      {notice && (
        <div aria-live="polite">
          <Notice variant={notice.kind === 'success' ? 'success' : 'error'}>{notice.text}</Notice>
        </div>
      )}

      {list.isError ? (
        <Notice variant="error">
          {list.error instanceof ApiError ? list.error.message : 'Не удалось загрузить операции'}{' '}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => void list.refetch()}
          >
            Повторить
          </button>
        </Notice>
      ) : list.isPending ? (
        <p className="py-8 text-center text-sm text-zinc-500">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">
          Записей за выбранный период нет. Измените период или фильтры
        </p>
      ) : (
        <OperationsTable
          items={items}
          currency={currency}
          baseCurrency={baseCurrency}
          sort={sort}
          direction={direction}
          onSort={changeSort}
          canRestore={canEdit}
          excelEnabled={excelEnabled}
          authorLabel={authorLabel}
          busyId={busyId}
          onEdit={(item) => {
            update.reset();
            setEditing(item);
          }}
          onDelete={setDeleting}
          onViewReceipt={setViewingReceipt}
          onRestore={(item) =>
            restore.mutate(item.id, {
              onSuccess: () => done(`Запись «${item.name}» возвращена`),
              onError: failed,
            })
          }
        />
      )}

      {list.data && list.data.total > PAGE_SIZE && (
        <nav aria-label="Страницы" className="flex items-center justify-between gap-3 text-sm">
          <span className="text-zinc-500 dark:text-zinc-400">{rangeLabel(page, total)}</span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="h-10 rounded-lg border border-zinc-300 px-3 font-medium disabled:opacity-40 dark:border-zinc-700"
            >
              ‹ Назад
            </button>
            <span aria-live="polite">
              {page} / {pageCount(total)}
            </span>
            <button
              type="button"
              disabled={page >= pageCount(total)}
              onClick={() => setPage(page + 1)}
              className="h-10 rounded-lg border border-zinc-300 px-3 font-medium disabled:opacity-40 dark:border-zinc-700"
            >
              Вперёд ›
            </button>
          </span>
        </nav>
      )}

      {editing && (
        <EditExpenseDialog
          item={editing}
          cards={cardsForEditing(editing, cards.data, currency)}
          categories={options.activeCategories}
          currency={editing.currency || currency}
          baseCurrency={baseCurrency}
          saving={update.isPending}
          error={update.error}
          extra={
            <>
              <ReceiptEditor
                key={editing.id}
                expenseId={editing.id}
                hasReceipt={!!editing.hasReceipt}
                allowed={receiptAllowed(editing)}
              />
              <ItemsSection
                key={`items-${editing.id}`}
                item={editing}
                currency={editing.currency || currency}
                baseCurrency={baseCurrency}
                onChanged={(message) => {
                  done(message);
                  setEditing(undefined);
                }}
              />
            </>
          }
          onClose={() => setEditing(undefined)}
          onSave={(patch) =>
            update.mutate(
              { id: editing.id, patch },
              {
                onSuccess: () => {
                  done(`Запись «${patch.name ?? editing.name}» изменена`);
                  setEditing(undefined);
                },
              },
            )
          }
        />
      )}

      {viewingReceipt && (
        <ReceiptViewer expenseId={viewingReceipt.id} onClose={() => setViewingReceipt(undefined)} />
      )}

      {deleting && (
        <ConfirmDialog
          title="Удалить запись?"
          message={`«${deleting.name}», ${formatAmount(deleting.amount, currencyDigits(deleting.currency || currency, baseCurrency))} ${deleting.currency || currency}. Запись можно будет вернуть: включите «Показывать удалённые» в фильтрах. Из Excel строка будет убрана.`}
          confirmLabel="Удалить"
          busy={remove.isPending}
          onCancel={() => setDeleting(undefined)}
          onConfirm={() =>
            remove.mutate(deleting.id, {
              onSuccess: () => {
                done(`Запись «${deleting.name}» удалена`);
                setDeleting(undefined);
              },
              onError: (error) => {
                failed(error);
                setDeleting(undefined);
              },
            })
          }
        />
      )}
    </section>
  );
}
