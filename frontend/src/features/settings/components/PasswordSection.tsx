import { useState, type FormEvent } from 'react';
import { ApiError, NETWORK_ERROR_CODE } from '../../../shared/api/http.ts';
import { Button } from '../../../shared/ui/Button.tsx';
import { Field, inputClassName } from '../../../shared/ui/Field.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { changePassword } from '../api/password.api.ts';
import { SettingsSection } from './SettingsSection.tsx';

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

/** Password change: current, new and confirmation. After the change, other devices are signed out. */
export function PasswordSection() {
  const [values, setValues] = useState<Values>(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [show, setShow] = useState(false);
  const [state, setState] = useState<
    { kind: 'idle' } | { kind: 'saving' } | { kind: 'done' } | { kind: 'error'; message: string }
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
      setValues(EMPTY);
      setSubmitted(false);
      setState({ kind: 'done' });
    } catch (error) {
      setState({ kind: 'error', message: errorMessage(error) });
    }
  };

  const type = show ? 'text' : 'password';

  return (
    <SettingsSection
      title="Пароль"
      description="После смены пароля на других устройствах нужно будет войти заново"
    >
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

        {state.kind === 'done' && (
          <Notice variant="success">Пароль изменён. На других устройствах вход завершён</Notice>
        )}
        {state.kind === 'error' && <Notice variant="error">{state.message}</Notice>}

        <Button type="submit" loading={state.kind === 'saving'}>
          {state.kind === 'saving' ? 'Сохраняем…' : 'Сменить пароль'}
        </Button>
      </form>
    </SettingsSection>
  );
}
