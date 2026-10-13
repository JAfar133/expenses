import { emptyDraft, type DraftItem } from '../model/draft-items.ts';
import { ItemsEditor } from './ItemsEditor.tsx';

interface ReceiptItemsFieldProps {
  value: DraftItem[];
  onChange: (value: DraftItem[]) => void;
  error?: string;
}

/**
 * Under the «Добавить» form: one quiet link. The editor exists only while there are rows,
 * so a closed editor takes no room (deleting the last row closes it).
 */
export function ReceiptItemsField({ value, onChange, error }: ReceiptItemsFieldProps) {
  return (
    <div className="space-y-2">
      {value.length === 0 ? (
        <button
          type="button"
          onClick={() => onChange([emptyDraft()])}
          className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          + Позиции чека
        </button>
      ) : (
        <>
          <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Позиции чека</div>
          <ItemsEditor value={value} onChange={onChange} />
        </>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
