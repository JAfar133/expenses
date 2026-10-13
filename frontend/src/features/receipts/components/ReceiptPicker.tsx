import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CameraIcon, CloseIcon } from '../../../shared/ui/icons.tsx';
import { usePhotoFile } from '../hooks/usePhotoFile.ts';
import { ReceiptViewer } from './ReceiptViewer.tsx';
import { PhotoInput } from './PhotoInput.tsx';

interface ReceiptPickerProps {
  photo: Blob | null;
  onChange: (photo: Blob | null) => void;
  /** Next to the thumbnail: what the AI makes of the receipt (only where it reads receipts) */
  status?: ReactNode;
}

/**
 * «Фото чека» under the category: a button to attach a photo; then a thumbnail with a cross on it, the status card
 * at its right and «Заменить фото» under them.
 */
export function ReceiptPicker({ photo, onChange, status }: ReceiptPickerProps) {
  const file = usePhotoFile(onChange);
  const [viewing, setViewing] = useState(false);
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);
  // The address dies with the photo: the viewer closes with it
  useEffect(() => setViewing(false), [photo]);

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Фото чека</div>
      <PhotoInput inputRef={file.input} onChange={(event) => void file.onChange(event)} />
      {preview ? (
        <>
          <div className="flex items-start gap-3">
            <div className="relative shrink-0">
              <button
                type="button"
                aria-label="Посмотреть чек"
                title="Посмотреть чек"
                onClick={() => setViewing(true)}
                className="block min-h-11 min-w-11 cursor-pointer"
              >
                <img
                  src={preview}
                  alt="Фото чека"
                  className="h-20 rounded-lg border border-zinc-200 object-cover dark:border-zinc-700"
                />
              </button>
              <button
                type="button"
                aria-label="Убрать фото"
                title="Убрать фото"
                onClick={() => onChange(null)}
                className="absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full bg-zinc-800 text-white shadow dark:bg-zinc-200 dark:text-zinc-900"
              >
                <CloseIcon />
              </button>
            </div>
            {status && <div className="min-w-0 flex-1">{status}</div>}
          </div>
          <button
            type="button"
            disabled={file.busy}
            onClick={file.open}
            className="text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300"
          >
            {file.busy ? 'Обрабатываем фото…' : 'Заменить фото'}
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={file.busy}
          onClick={file.open}
          className="flex h-10 items-center gap-2 rounded-lg border border-dashed border-zinc-300 px-3 text-sm text-zinc-600 hover:border-indigo-400 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300"
        >
          <CameraIcon />
          {file.busy ? 'Обрабатываем фото…' : 'Прикрепить фото чека'}
        </button>
      )}
      {viewing && preview && <ReceiptViewer src={preview} onClose={() => setViewing(false)} />}
      {file.error && <p className="text-sm text-red-600 dark:text-red-400">{file.error}</p>}
    </div>
  );
}
