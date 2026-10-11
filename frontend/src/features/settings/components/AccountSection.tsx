import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { setAppTimezone } from '../../../shared/utils/date.ts';
import { Button } from '../../../shared/ui/Button.tsx';
import { Field, inputClassName } from '../../../shared/ui/Field.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { updateProfile, type AuthUser } from '../../auth/api/auth.api.ts';
import { CURRENT_USER_KEY } from '../../auth/hooks/useAuth.ts';
import { ANALYTICS_KEY } from '../../analytics/hooks/useAnalytics.ts';
import { fetchCards } from '../../expenses/api/expenses.api.ts';
import { toSaveErrorMessage } from '../../expenses/api/save-error-message.ts';
import { deviceTimezone, timezoneOptions } from '../model/timezones.ts';
import { SettingsSection } from './SettingsSection.tsx';

const fieldClass = `${inputClassName} h-11`;

/** Account: name, default card and time zone are editable; login and permissions are shown for reference. */
export function AccountSection({ user }: { user: AuthUser }) {
  const queryClient = useQueryClient();
  const cards = useQuery({ queryKey: ['cards'], queryFn: fetchCards, staleTime: Infinity });

  const [values, setValues] = useState({
    displayName: user.displayName,
    card: user.card,
    timezone: user.timezone,
  });
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    retry: false,
    mutationFn: updateProfile,
    onSuccess: (updated) => {
      queryClient.setQueryData(CURRENT_USER_KEY, updated);
      // "Today" depends on the time zone: analytics data must be refetched
      setAppTimezone(updated.timezone);
      void queryClient.invalidateQueries({ queryKey: ANALYTICS_KEY });
      setValues({
        displayName: updated.displayName,
        card: updated.card,
        timezone: updated.timezone,
      });
      setSaved(true);
    },
  });

  const set = (field: keyof typeof values) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setSaved(false);
    save.reset();
  };

  const name = values.displayName.trim();
  const changes = {
    ...(name !== user.displayName && name ? { displayName: name } : {}),
    ...(values.card !== user.card ? { card: values.card } : {}),
    ...(values.timezone !== user.timezone ? { timezone: values.timezone } : {}),
  };
  const nameError = !name ? 'Введите имя' : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (nameError || Object.keys(changes).length === 0) return;
    save.mutate(changes);
  };

  const options = timezoneOptions(values.timezone);
  const cardOptions = cards.data?.includes(values.card)
    ? cards.data
    : [values.card, ...(cards.data ?? [])];

  return (
    <SettingsSection
      title="Аккаунт"
      description="Имя, карта по умолчанию и часовой пояс можно менять. Логин не меняется"
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field label="Имя" htmlFor="profile-name" error={nameError}>
          <input
            id="profile-name"
            type="text"
            autoComplete="name"
            maxLength={40}
            className={fieldClass}
            value={values.displayName}
            aria-invalid={!!nameError}
            onChange={(event) => set('displayName')(event.target.value)}
          />
        </Field>

        <Field label="Логин" htmlFor="profile-login">
          <input
            id="profile-login"
            type="text"
            readOnly
            className={`${fieldClass} bg-zinc-50 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400`}
            value={user.username}
          />
        </Field>

        <Field label="Карта по умолчанию" htmlFor="profile-card">
          <select
            id="profile-card"
            className={fieldClass}
            value={values.card}
            onChange={(event) => set('card')(event.target.value)}
          >
            {cardOptions.map((card) => (
              <option key={card} value={card}>
                {card}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Часовой пояс" htmlFor="profile-timezone">
          <select
            id="profile-timezone"
            className={fieldClass}
            value={values.timezone}
            onChange={(event) => set('timezone')(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => set('timezone')(deviceTimezone())}
              className="h-9 rounded-lg border border-zinc-300 px-3 text-sm hover:border-indigo-400 dark:border-zinc-700"
            >
              Как на этом устройстве
            </button>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate({ timezone: null })}
              className="h-9 rounded-lg border border-zinc-300 px-3 text-sm hover:border-indigo-400 disabled:opacity-60 dark:border-zinc-700"
            >
              По умолчанию
            </button>
          </div>
          <p className="pt-1 text-xs text-zinc-500 dark:text-zinc-400">
            По нему определяется «сегодня» в анализе и в форме расхода
          </p>
        </Field>

        <div className="space-y-1 text-sm">
          <div className="text-zinc-500 dark:text-zinc-400">Права</div>
          <div className="font-medium">
            {user.canEdit ? 'Просмотр, правка и удаление записей' : 'Просмотр'}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Права меняют пользователи с правом правки (блок «Права пользователей»)
          </p>
        </div>

        {saved && <Notice variant="success">Изменения сохранены</Notice>}
        {save.isError && <Notice variant="error">{toSaveErrorMessage(save.error)}</Notice>}

        <Button
          type="submit"
          loading={save.isPending}
          disabled={Object.keys(changes).length === 0 || !!nameError}
        >
          {save.isPending ? 'Сохраняем…' : 'Сохранить'}
        </Button>
      </form>
    </SettingsSection>
  );
}
