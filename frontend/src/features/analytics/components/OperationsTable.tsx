import { formatMoney } from '../../../shared/utils/money.ts';
import type { OperationItem, SortColumn, SortDirection } from '../api/operations.api.ts';
import { ExcelStateBadge } from './ExcelStateBadge.tsx';

interface OperationsTableProps {
  items: OperationItem[];
  currency: string;
  sort: SortColumn;
  direction: SortDirection;
  onSort: (column: SortColumn) => void;
  canEdit: boolean;
  excelEnabled: boolean;
  /** Логин → имя для показа */
  authorLabel: (login: string) => string;
  /** Запись, с которой сейчас что-то делают (кнопки недоступны) */
  busyId?: string;
  onEdit: (item: OperationItem) => void;
  onDelete: (item: OperationItem) => void;
  onRestore: (item: OperationItem) => void;
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

/** Сумма с пометкой об исходной валюте, если расход вводили не в драммах. */
function Amount({ item, currency }: { item: OperationItem; currency: string }) {
  return (
    <span className="inline-flex flex-col items-end">
      <span className="font-medium tabular-nums">
        {formatMoney(item.amount)} {currency}
      </span>
      {item.original && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {formatMoney(item.original.amount)} {item.original.currency} · курс{' '}
          {formatMoney(item.original.rate, 6)}
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
      >
        Изменить
      </button>
      <button
        type="button"
        className={`${className} text-red-600 dark:text-red-400`}
        disabled={busy}
        onClick={() => onDelete(item)}
        aria-label={`Удалить запись: ${item.name}`}
      >
        Удалить
      </button>
    </span>
  );
}

const nameClass = (item: OperationItem) =>
  item.deletedAt ? 'text-zinc-400 line-through dark:text-zinc-500' : '';

/** Таблица операций: на широком экране таблицей с сортировкой по заголовкам, на телефоне карточками. */
export function OperationsTable(props: OperationsTableProps) {
  const { items, currency, sort, direction, onSort, canEdit, excelEnabled, authorLabel, busyId } =
    props;
  const actions = (item: OperationItem) => (
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
              {canEdit && (
                <th scope="col" className="py-2 text-right font-medium">
                  Действия
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-zinc-100 align-top dark:border-zinc-800">
                <td className="py-2.5 pr-4 tabular-nums whitespace-nowrap">
                  {formatDate(item.date)}
                </td>
                <td className="py-2.5 pr-4">{item.card}</td>
                <td className="py-2.5 pr-4">{item.category}</td>
                <th scope="row" className={`py-2.5 pr-4 font-normal ${nameClass(item)}`}>
                  {item.name}
                </th>
                <td className="py-2.5 pr-4 text-right whitespace-nowrap">
                  <Amount item={item} currency={currency} />
                </td>
                <td className="py-2.5 pr-4">{authorLabel(item.createdBy)}</td>
                <td className="py-2.5 pr-4">
                  <ExcelStateBadge
                    state={item.excelState}
                    error={item.excelError}
                    excelEnabled={excelEnabled}
                  />
                </td>
                {canEdit && <td className="py-2.5 text-right">{actions(item)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden" aria-label="Операции">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className={`truncate font-medium ${nameClass(item)}`}>{item.name}</div>
                <div className="text-sm text-zinc-500 dark:text-zinc-400">
                  {formatDate(item.date)} · {item.category} · {item.card}
                </div>
              </div>
              <Amount item={item} currency={currency} />
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
              {canEdit && actions(item)}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
