import type { ChangeEvent, RefObject } from 'react';

/** The hidden file input behind a «Прикрепить»-style button: any image, the phone offers the camera or the gallery. */
export function PhotoInput({
  inputRef,
  onChange,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      aria-label="Выбрать фото чека"
      tabIndex={-1}
      onChange={onChange}
      className="sr-only"
    />
  );
}
