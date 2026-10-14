import type { ChangeEvent, RefObject } from 'react';

/** The hidden file input behind a «Прикрепить»-style button: any image, the phone offers the camera or the gallery. */
export function PhotoInput({
  inputRef,
  onChange,
  capture,
  label = 'Выбрать фото чека',
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Open the rear camera of the phone at once instead of offering the gallery */
  capture?: 'environment';
  label?: string;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      capture={capture}
      aria-label={label}
      tabIndex={-1}
      onChange={onChange}
      className="sr-only"
    />
  );
}
