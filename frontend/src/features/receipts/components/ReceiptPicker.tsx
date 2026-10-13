import { useEffect, useMemo } from 'react';
import { CameraIcon, CloseIcon } from '../../../shared/ui/icons.tsx';
import { usePhotoFile } from '../hooks/usePhotoFile.ts';
import { PhotoInput } from './PhotoInput.tsx';

interface ReceiptPickerProps {
  photo: Blob | null;
  onChange: (photo: Blob | null) => void;
}

/** An optional photo of the receipt under the expense form: a button, then a thumbnail with a «remove» cross. */
export function ReceiptPicker({ photo, onChange }: ReceiptPickerProps) {
  const file = usePhotoFile(onChange);
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  return (
    <div className="space-y-2">
      <PhotoInput inputRef={file.input} onChange={(event) => void file.onChange(event)} />
      {preview ? (
        <div className="relative inline-block">
          <img
            src={preview}
            alt="Фото чека"
            className="h-20 rounded-lg border border-zinc-200 object-cover dark:border-zinc-700"
          />
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
      {file.error && <p className="text-sm text-red-600 dark:text-red-400">{file.error}</p>}
    </div>
  );
}
