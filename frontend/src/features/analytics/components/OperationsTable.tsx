import { Fragment, useState } from 'react';
import { formatShortDateTime } from '../../admin/model/backup.ts';
import { currencyDigits } from '../../../shared/utils/conversion.ts';
import { formatAmount, formatMoney } from '../../../shared/utils/money.ts';
import type { OperationItem, SortColumn, SortDirection } from '../api/operations.api.ts';
import { AiMark } from '../../ai/components/AiMark.tsx';
import { ParsingBadge } from '../../ai/components/ParsingBadge.tsx';
import { ItemsCount } from '../../items/components/ItemsCount.tsx';
import { ItemsPanel } from '../../items/components/ItemsPanel.tsx';
import { ReceiptBadge } from '../../receipts/components/ReceiptBadge.tsx';
import { ExcelStateBadge } from './ExcelStateBadge.tsx';

interface OperationsTableProps {
  items: OperationItem[];
  /** Reporting currency (also the fallback for a record without its own currency) */
  currency: string;
  /** Drams: their amounts have no decimals */
  baseCurrency: string;
  sort: SortColumn;
  direction: SortDirection;
  onSort: (column: SortColumn) => void;
  /** The user may restore deleted records (owner) */
  canRestore: boolean;
  excelEnabled: boolean;
  /** Login to display name */
  authorLabel: (login: string) => string;
  /** Record currently being acted on (buttons disabled) */
  busyId?: string;
  onEdit: (item: OperationItem) => void;
  onDelete: (item: OperationItem) => void;
  onRestore: (item: OperationItem) => void;
  onViewReceipt?: (item: OperationItem) => void;
}

const COLUMNS: { id: SortColumn; label: string; numeric?: boolean }[] = [
  { id: 'date', label: 'Дата' },
  { id: 'card', label: 'Карта' },
  { id: 'category', label: 'Категория' },
  { id: 'name', label: 'Наименование' },
  { id: 'amount', label: 'Стоимость', numeric: true },
  { id: 'createdBy', label: 'Добавил' },
];

const formatDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/**
 * Amount in the card currency; a note of what was typed if it was another currency, and the reporting amount
 * if it differs from the card currency.
 */
function Amount({
  item,
  currency,
  baseCurrency,
}: {
  item: OperationItem;
  currency: string;
  baseCurrency: string;
}) {
  const own = item.currency || currency;
  const showReporting =
    item.reportingAmount !== undefined &&
    item.reportingCurrency !== undefined &&
    item.reportingCurrency !== own;

  return (
    <span className="inline-flex flex-col items-end">
      <span className="font-medium tabular-nums whitespace-nowrap">
        {formatAmount(item.amount, currencyDigits(own, baseCurrency))} {own}
      </span>
      {item.original && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {formatMoney(item.original.amount)} {item.original.currency}
          {item.original.currency !== baseCurrency &&
            ` · курс ${formatMoney(item.original.rate, 6)}`}
        </span>
      )}
      {showReporting && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          ≈{' '}
          {formatAmount(
            item.reportingAmount!,
            currencyDigits(item.reportingCurrency!, baseCurrency),
          )}{' '}
          {item.reportingCurrency}
        </span>
      )}
    </span>
  );
}

function Actions({
  item,
  busy,
  onEdit,
  onDelete,
  onRestore,
}: Pick<OperationsTableProps, 'onEdit' | 'onDelete' | 'onRestore'> & {
  item: OperationItem;
  busy: boolean;
}) {
  // A member's record can be edited until a deadline: shown as a tooltip only, to keep the screen simple
  const hint = item.editableUntil
    ? `Можно исправить до ${formatShortDateTime(item.editableUntil)}`
    : undefined;
  const className =
    'h-9 rounded-lg px-3 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800';

  if (item.deletedAt) {
    return (
      <button
        type="button"
        className={`${className} text-indigo-600 dark:text-indigo-400`}
        disabled={busy}
        onClick={() => onRestore(item)}
        aria-label={`Вернуть запись: ${item.name}`}
      >
        Вернуть
      </button>
    );
  }
  return (
    <span className="inline-flex gap-1">
      <button
        type="button"
        className={`${className} text-indigo-600 dark:text-indigo-400`}
        disabled={busy}
        onClick={() => onEdit(item)}
        aria-label={`Изменить запись: ${item.name}`}
        title={hint}
      >
        Изменить
      </button>
      <button
        type="button"
        className={`${className} text-red-600 dark:text-red-400`}
        disabled={busy}
        onClick={() => onDelete(item)}
        aria-label={`Удалить запись: ${item.name}`}
        title={hint}
      >
        Удалить
      </button>
    </span>
  );
}

/** Which rows have their positions opened. The table and the phone cards keep their own state. */
function useOpenRows() {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return { open, toggle };
}

/** Under the name: the parsing status and the muted «3 позиции ▾» button. */
function RowExtras({
  item,
  open,
  onToggle,
}: {
  item: OperationItem;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <ParsingBadge expenseId={item.id} />
      {!!item.itemsCount && <ItemsCount count={item.itemsCount} open={open} onToggle={onToggle} />}
    </>
  );
}

const nameClass = (item: OperationItem) =>
  item.deletedAt ? 'text-zinc-400 line-through dark:text-zinc-500' : '';

/** Operations table: on wide screens a table sortable by headers, on phones cards. */
export function OperationsTable(props: OperationsTableProps) {
  const {
    items,
    currency,
    baseCurrency,
    sort,
    direction,
    onSort,
    canRestore,
    excelEnabled,
    authorLabel,
    busyId,
  } = props;
  const tableRows = useOpenRows();
  const cardRows = useOpenRows();
  const panelOf = (item: OperationItem) => (
    <ItemsPanel
      expenseId={item.id}
      currency={item.currency || currency}
      baseCurrency={baseCurrency}
      operationAmount={item.amount}
    />
  );
  // Actions follow the server's verdict per record: `editable` (live records), restore only for the owner
  const hasActions = (item: OperationItem) => (item.deletedAt ? canRestore : item.editable);
  const showActions = items.some(hasActions);
  const actions = (item: OperationItem) =>
    hasActions(item) && (
      <Actions
        item={item}
        busy={busyId === item.id}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
        onRestore={props.onRestore}
      />
    );

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table
          aria-label="Операции"
          className="w-full min-w-[56rem] border-collapse text-left text-sm"
        >
          <thead>
            <tr className="border-b border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              {COLUMNS.map((column) => {
                const active = sort === column.id;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className={`py-2 pr-4 font-medium ${column.numeric ? 'text-right' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => onSort(column.id)}
                      className="inline-flex items-center gap-1 rounded px-1 hover:text-zinc-900 dark:hover:text-zinc-100"
                    >
                      {column.label}
                      <span aria-hidden="true" className={active ? '' : 'opacity-0'}>
                        {direction === 'asc' ? '↑' : '↓'}
                      </span>
                    </button>
                  </th>
                );
              })}
              <th scope="col" className="py-2 pr-4 font-medium">
                Excel
              </th>
              {showActions && (
                <th scope="col" className="py-2 text-right font-medium">
                  Действия
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <Fragment key={item.id}>
                <tr className="border-b border-zinc-100 align-top dark:border-zinc-800">
                  <td className="py-2.5 pr-4 tabular-nums whitespace-nowrap">
                    {formatDate(item.date)}
                  </td>
                  <td className="py-2.5 pr-4">{item.card}</td>
                  <td className="py-2.5 pr-4">{item.category}</td>
                  <th scope="row" className={`py-2.5 pr-4 font-normal ${nameClass(item)}`}>
                    {/* The camera sits in a flex line with the name: an inline-flex button in a table cell would sit on the
                      text baseline and push the row apart */}
                    <div className="flex items-center gap-1">
                      <span>{item.name}</span>
                      {item.nameSource === 'ai' && <AiMark />}
                      {item.hasReceipt && props.onViewReceipt && (
                        <ReceiptBadge onClick={() => props.onViewReceipt?.(item)} />
                      )}
                    </div>
                    <RowExtras
                      item={item}
                      open={tableRows.open.has(item.id)}
                      onToggle={() => tableRows.toggle(item.id)}
                    />
                  </th>
                  <td className="py-2.5 pr-4 text-right whitespace-nowrap">
                    <Amount item={item} currency={currency} baseCurrency={baseCurrency} />
                  </td>
                  <td className="py-2.5 pr-4">{authorLabel(item.createdBy)}</td>
                  <td className="py-2.5 pr-4">
                    <ExcelStateBadge
                      state={item.excelState}
                      error={item.excelError}
                      excelEnabled={excelEnabled}
                    />
                  </td>
                  {showActions && <td className="py-2.5 text-right">{actions(item)}</td>}
                </tr>
                {tableRows.open.has(item.id) && (
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    <td colSpan={COLUMNS.length + 1 + (showActions ? 1 : 0)} className="pb-3">
                      {panelOf(item)}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden" aria-label="Операции">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className={`flex items-center gap-1 font-medium ${nameClass(item)}`}>
                  <span className="truncate">{item.name}</span>
                  {item.nameSource === 'ai' && <AiMark />}
                  {item.hasReceipt && props.onViewReceipt && (
                    <ReceiptBadge onClick={() => props.onViewReceipt?.(item)} />
                  )}
                </div>
                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                  {formatDate(item.date)} · {item.category} · {item.card}
                </div>
                <RowExtras
                  item={item}
                  open={cardRows.open.has(item.id)}
                  onToggle={() => cardRows.toggle(item.id)}
                />
              </div>
              <Amount item={item} currency={currency} baseCurrency={baseCurrency} />
            </div>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
              <div className="space-y-1">
                <ExcelStateBadge
                  state={item.excelState}
                  error={item.excelError}
                  excelEnabled={excelEnabled}
                />
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Добавил: {authorLabel(item.createdBy)}
                </div>
              </div>
              {actions(item)}
            </div>
            {cardRows.open.has(item.id) && panelOf(item)}
          </li>
        ))}
      </ul>
    </>
  );
}
