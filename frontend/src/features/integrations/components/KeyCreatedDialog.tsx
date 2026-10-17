import { Modal } from '../../../shared/ui/Modal.tsx';
import { WarningIcon } from '../../../shared/ui/icons.tsx';
import { CopyField } from './CopyField.tsx';
import { SetupInstructions, importUrl } from './SetupInstructions.tsx';

/**
 * «Ключ создан»: the only place the full key is ever shown. The key lives in the state of the parent while this
 * window is open; closing it drops the key (the server keeps only a hash, the list keeps the masked prefix).
 */
export function KeyCreatedDialog({ apiKey, onClose }: { apiKey: string; onClose: () => void }) {
  return (
    <Modal title="Ключ создан" onClose={onClose}>
      <div className="space-y-4">
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
        >
          <span className="mt-0.5 shrink-0">
            <WarningIcon />
          </span>
          Ключ показывается один раз. Сохраните его сейчас
        </div>
        <CopyField label="API-ключ" value={apiKey} />
        <CopyField label="Адрес для запроса (URL)" value={importUrl()} />
        <h3 className="text-sm font-semibold">Как настроить автоматизацию на iPhone</h3>
        <SetupInstructions showUrl={false} />
        <button
          type="button"
          onClick={onClose}
          className="h-11 w-full rounded-xl bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Готово, ключ сохранён
        </button>
      </div>
    </Modal>
  );
}
