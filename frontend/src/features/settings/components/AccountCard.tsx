import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '../../../shared/ui/Button.tsx';
import { Field, inputClassName } from '../../../shared/ui/Field.tsx';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { SelectBox, selectPadding } from '../../../shared/ui/SelectBox.tsx';
import { setAppTimezone } from '../../../shared/utils/date.ts';
import { ANALYTICS_KEY } from '../../analytics/hooks/useAnalytics.ts';
import { updateProfile, type AuthUser } from '../../auth/api/auth.api.ts';
import { CURRENT_USER_KEY } from '../../auth/hooks/useAuth.ts';
import { fetchCards } from '../../expenses/api/expenses.api.ts';
import { toSaveErrorMessage } from '../../expenses/api/save-error-message.ts';
import { DEFAULT_CHOICE, DEVICE_CHOICE, timezoneChoices } from '../model/popular-timezones.ts';
import { deviceTimezone } from '../model/timezones.ts';
import { SettingsSection } from './SettingsSection.tsx';

const fieldClass = `${inputClassName} h-11`;

/** What the time zone choice means for the account: «default» resets it, «device» takes the zone of this device. */
function timezoneTarget(choice: string): string | null {
  if (choice === DEFAULT_CHOICE) return null;
  return choice === DEVICE_CHOICE ? deviceTimezone() : choice;
}

/** Account: the name, the default card and the time zone are editable; the login is shown as plain text. */
export function AccountCard({ user }: { user: AuthUser }) {
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
  const target = timezoneTarget(values.timezone);
  const changes = {
    ...(name !== user.displayName && name ? { displayName: name } : {}),
    ...(values.card !== user.card ? { card: values.card } : {}),
    // «default» is always a change (it clears the personal zone); another choice only if it differs
    ...(target === null || target !== user.timezone ? { timezone: target } : {}),
  };
  const nameError = !name ? 'Введите имя' : undefined;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (nameError || Object.keys(changes).length === 0) return;
    save.mutate(changes);
  };

  const cardNames = cards.data?.map((card) => card.name) ?? [];
  // A default card that no longer exists (renamed, archived, set in the server config) is not offered: the form falls
  // back to the first card, and the choice shows that instead of a card the person cannot use
  const cardIsStale = cards.data !== undefined && !cardNames.includes(values.card);
  const zones = timezoneChoices(user.timezone, deviceTimezone(), user.defaultTimezone);

  return (
    <SettingsSection title="Аккаунт" compact>
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

        <div className="space-y-1.5">
          <div className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Логин</div>
          <div className="text-base">{user.username}</div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Не изменяется</p>
        </div>

        <Field label="Карта по умолчанию" htmlFor="profile-card">
          <SelectBox>
            <select
              id="profile-card"
              className={`${fieldClass} ${selectPadding}`}
              value={cardIsStale ? '' : values.card}
              onChange={(event) => set('card')(event.target.value)}
            >
              {cardIsStale && (
                <option value="" disabled>
                  Не выбрана (будет первая карта)
                </option>
              )}
              {cardNames.map((card) => (
                <option key={card} value={card}>
                  {card}
                </option>
              ))}
            </select>
          </SelectBox>
          {cardIsStale && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Карта по умолчанию не выбрана. Шаблоны и новые расходы будут использовать первую
              доступную карту
            </p>
          )}
        </Field>

        <Field label="Часовой пояс" htmlFor="profile-timezone">
          <SelectBox>
            <select
              id="profile-timezone"
              className={`${fieldClass} ${selectPadding}`}
              value={values.timezone}
              onChange={(event) => set('timezone')(event.target.value)}
            >
              {zones.map((zone) => (
                <option key={zone.value} value={zone.value}>
                  {zone.label}
                </option>
              ))}
            </select>
          </SelectBox>
          <p className="pt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Сегодня определяется по этому часовому поясу
          </p>
        </Field>

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
