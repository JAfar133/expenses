import { useState, type FormEvent } from 'react';
import { ApiError, NETWORK_ERROR_CODE } from '../../../shared/api/http.ts';
import { Button } from '../../../shared/ui/Button.tsx';
import { Field, inputClassName } from '../../../shared/ui/Field.tsx';
import { Modal } from '../../../shared/ui/Modal.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { changePassword } from '../api/password.api.ts';

/** Length hint; the server does the final check (its minimum is configurable). */
const MIN_LENGTH = 8;

type Values = { current: string; next: string; repeat: string };
const EMPTY: Values = { current: '', next: '', repeat: '' };

/** Form validation before submit. */
export function validatePassword({
  current,
  next,
  repeat,
}: Values): Partial<Record<keyof Values, string>> {
  const errors: Partial<Record<keyof Values, string>> = {};
  if (!current) errors.current = 'Введите текущий пароль';
  if (!next) errors.next = 'Введите новый пароль';
  else if (next.length < MIN_LENGTH) errors.next = `Не короче ${MIN_LENGTH} символов`;
  else if (next === current) errors.next = 'Новый пароль совпадает с текущим';
  if (next && repeat !== next) errors.repeat = 'Пароли не совпадают';
  return errors;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === NETWORK_ERROR_CODE) {
      return 'Не получили ответ сервера. Проверьте соединение и попробуйте ещё раз';
    }
    return error.message;
  }
  return 'Не удалось сменить пароль. Попробуйте позже';
}

interface ChangePasswordDialogProps {
  /** Called after a successful change, the window closes itself through it */
  onChanged: () => void;
  onClose: () => void;
}

/** The password change window: current, new and repeat. After the change, other devices are signed out. */
export function ChangePasswordDialog({ onChanged, onClose }: ChangePasswordDialogProps) {
  const [values, setValues] = useState<Values>(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [show, setShow] = useState(false);
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'saving' } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const errors = submitted ? validatePassword(values) : {};
  const set = (field: keyof Values) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    if (state.kind !== 'saving') setState({ kind: 'idle' });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(validatePassword(values)).length > 0 || state.kind === 'saving') return;

    setState({ kind: 'saving' });
    try {
      await changePassword(values.current, values.next);
      onChanged();
    } catch (error) {
      setState({ kind: 'error', message: errorMessage(error) });
    }
  };

  const type = show ? 'text' : 'password';

  return (
    <Modal title="Изменить пароль" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field label="Текущий пароль" htmlFor="password-current" error={errors.current}>
          <input
            id="password-current"
            type={type}
            autoComplete="current-password"
            className={inputClassName}
            value={values.current}
            aria-invalid={!!errors.current}
            onChange={(event) => set('current')(event.target.value)}
          />
        </Field>
        <Field label="Новый пароль" htmlFor="password-new" error={errors.next}>
          <input
            id="password-new"
            type={type}
            autoComplete="new-password"
            className={inputClassName}
            value={values.next}
            aria-invalid={!!errors.next}
            onChange={(event) => set('next')(event.target.value)}
          />
        </Field>
        <Field label="Повторите новый пароль" htmlFor="password-repeat" error={errors.repeat}>
          <input
            id="password-repeat"
            type={type}
            autoComplete="new-password"
            className={inputClassName}
            value={values.repeat}
            aria-invalid={!!errors.repeat}
            onChange={(event) => set('repeat')(event.target.value)}
          />
        </Field>

        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={show}
            onChange={(event) => setShow(event.target.checked)}
            className="size-5 accent-indigo-600"
          />
          Показать пароли
        </label>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          После смены пароля на других устройствах нужно будет войти заново
        </p>

        {state.kind === 'error' && <Notice variant="error">{state.message}</Notice>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-12 rounded-xl border border-zinc-300 px-4 text-base font-medium dark:border-zinc-700"
          >
            Отмена
          </button>
          <Button type="submit" loading={state.kind === 'saving'} className="sm:w-auto sm:px-6">
            {state.kind === 'saving' ? 'Сохраняем…' : 'Сохранить новый пароль'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
