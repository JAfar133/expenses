import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { BellIcon, EyeIcon, EyeOffIcon } from '../../../shared/ui/icons.tsx';
import { ConfirmDialog } from '../../analytics/components/ConfirmDialog.tsx';
import { useCurrentUser } from '../../auth/hooks/useAuth.ts';
import { ApiError } from '../../../shared/api/http.ts';
import type { PushDevice } from '../../push/api/push.api.ts';
import {
  useNotificationSettings,
  usePushActions,
  usePushStatus,
} from '../../push/hooks/usePush.ts';
import { shortDay } from '../../push/model/format.ts';
import { ChoiceSetting } from '../../templates/components/ChoiceSetting.tsx';
import { SettingsSection } from './SettingsSection.tsx';

const SECTION = 'text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400';

const Steps = ({ children }: { children: ReactNode }) => (
  <ol className="list-decimal space-y-1.5 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
    {children}
  </ol>
);

const primary =
  'h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60';
const secondary =
  'h-11 rounded-xl border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800';

/** «Уведомления»: this device, the list of devices, what to send and what the lock screen may show. */
export function NotificationsCard() {
  const { data: user } = useCurrentUser();
  const push = usePushStatus();
  const actions = usePushActions(push.refresh);
  const { query: settings, save } = useNotificationSettings();
  const [removing, setRemoving] = useState<PushDevice | null>(null);
  const [testResult, setTestResult] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const { hash } = useLocation();

  // A link from the bell comes here
  useEffect(() => {
    if (hash === '#notifications') root.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [hash]);

  const devices = push.devices.data ?? [];
  const isOwner = user?.role === 'owner';
  const types = settings.data?.push.types;
  const hideAmounts = settings.data?.push.hideAmounts ?? false;

  const serverOff = push.status === 'server-off';
  const failure =
    actions.enable.error ?? actions.disableThisDevice.error ?? actions.removeDevice.error;

  const deviceBlock = () => {
    switch (push.status) {
      case 'loading':
        return <p className="text-sm text-zinc-500">Проверяем это устройство…</p>;
      case 'needs-install':
        return (
          <div className="space-y-2">
            <p className="text-sm font-medium">
              На iPhone уведомления работают только в приложении с экрана «Домой»
            </p>
            <Steps>
              <li>Откройте сайт в Safari и нажмите «Поделиться».</li>
              <li>Выберите «На экран Домой».</li>
              <li>Откройте приложение с экрана «Домой».</li>
              <li>Вернитесь сюда: Настройки → Уведомления.</li>
            </Steps>
          </div>
        );
      case 'unsupported':
        return <p className="text-sm">Этот браузер не поддерживает уведомления</p>;
      case 'denied':
        return (
          <div className="space-y-2">
            <p className="text-sm font-medium">Уведомления запрещены для этого сайта</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              iPhone: Настройки → Уведомления → Расходы → «Разрешить уведомления». Другие браузеры:
              значок замка в адресной строке → Уведомления → Разрешить. Потом вернитесь сюда.
            </p>
          </div>
        );
      case 'off':
        return (
          <div className="space-y-2">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              На этом устройстве уведомления выключены.
            </p>
            <button
              type="button"
              disabled={actions.enable.isPending || !push.publicKey}
              // The permission prompt needs a tap: the request starts right here
              onClick={() => push.publicKey && actions.enable.mutate(push.publicKey)}
              className={primary}
            >
              Включить уведомления на этом устройстве
            </button>
          </div>
        );
      default:
        return (
          <div className="space-y-2">
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              Уведомления включены на этом устройстве
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                disabled={actions.test.isPending}
                onClick={() =>
                  actions.test.mutate(push.deviceId ?? undefined, {
                    onSuccess: ({ sent }) =>
                      setTestResult(
                        sent > 0
                          ? `Отправлено на ${sent} ${sent === 1 ? 'устройство' : 'устройств'}`
                          : 'Не удалось отправить: устройств нет',
                      ),
                    onError: (error) =>
                      setTestResult(
                        error instanceof ApiError
                          ? error.message
                          : 'Не удалось отправить тестовое уведомление',
                      ),
                  })
                }
                className={secondary}
              >
                Отправить тестовое
              </button>
              <button
                type="button"
                disabled={actions.disableThisDevice.isPending}
                onClick={() => actions.disableThisDevice.mutate(push.deviceId)}
                className={secondary}
              >
                Отключить на этом устройстве
              </button>
            </div>
            {testResult && (
              <p role="status" className="text-sm text-zinc-600 dark:text-zinc-300">
                {testResult}
              </p>
            )}
          </div>
        );
    }
  };

  return (
    <div id="notifications" ref={root}>
      <SettingsSection
        title="Уведомления"
        description="Расходы из банка и ошибки приходят на телефон, даже когда приложение закрыто"
        compact
      >
        {serverOff ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            Уведомления на телефон не настроены на сервере
          </p>
        ) : (
          <>
            <section className="space-y-2" aria-label="Это устройство">
              <h3 className={SECTION}>Это устройство</h3>
              {deviceBlock()}
              {failure && <Notice variant="error">{failure.message}</Notice>}
            </section>

            <section className="space-y-2" aria-label="Устройства">
              <h3 className={SECTION}>Устройства</h3>
              {devices.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Ни одно устройство не подключено
                </p>
              ) : (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {devices.map((device) => {
                    const mine = device.id === push.deviceId;
                    return (
                      <li key={device.id} className="flex items-center gap-3 py-2.5">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
                          <BellIcon />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium">{device.label}</span>
                            {mine && (
                              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                                это устройство
                              </span>
                            )}
                            {device.failures > 0 && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                не отвечает
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400">
                            подключено {shortDay(device.createdAt)} ·{' '}
                            {device.lastSuccessAt
                              ? `последнее уведомление ${shortDay(device.lastSuccessAt)}`
                              : 'ещё не получало'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setRemoving(device)}
                          aria-label={`Отключить: ${device.label}`}
                          className="h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                        >
                          Отключить
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="space-y-4" aria-label="Что присылать">
              <h3 className={SECTION}>Что присылать</h3>
              {types && (
                <>
                  <TypeChoice
                    title="Расходы из банка и Wallet"
                    on={types.expense_imported}
                    explainOn="Придёт уведомление, когда расход добавлен автоматически"
                    explainOff="Не присылаем. В колокольчике расходы останутся"
                    onChange={(value) =>
                      save.mutate({ push: { types: { expense_imported: value } } })
                    }
                  />
                  {isOwner && (
                    <TypeChoice
                      title="Ошибки импорта"
                      on={types.import_problem}
                      explainOn="Придёт уведомление, когда запрос из банка не создал расход"
                      explainOff="Не присылаем. Ошибки видны в колокольчике и в журнале запросов"
                      onChange={(value) =>
                        save.mutate({ push: { types: { import_problem: value } } })
                      }
                    />
                  )}
                  <TypeChoice
                    title="Распознанные чеки"
                    on={types.receipt_parsed}
                    explainOn="Придёт уведомление, когда чек, который вы отправили, распознан"
                    explainOff="Не присылаем: вы и так видите результат сами"
                    onChange={(value) =>
                      save.mutate({ push: { types: { receipt_parsed: value } } })
                    }
                  />
                </>
              )}
              {settings.isError && <Notice variant="error">Не удалось загрузить настройки</Notice>}
              {save.isError && <Notice variant="error">Не удалось сохранить настройку</Notice>}
            </section>

            <section className="space-y-2" aria-label="Приватность">
              <h3 className={SECTION}>Приватность</h3>
              <ChoiceSetting
                title="Что видно на экране блокировки"
                value={hideAmounts ? 'hide' : 'show'}
                onChange={(value) => save.mutate({ push: { hideAmounts: value === 'hide' } })}
                choices={[
                  { value: 'show', label: 'Показывать суммы', icon: <EyeIcon /> },
                  { value: 'hide', label: 'Скрывать суммы', icon: <EyeOffIcon /> },
                ]}
                helper={
                  hideAmounts
                    ? 'Так будет выглядеть: «Расход добавлен — Из Wallet»'
                    : 'Так будет выглядеть: «Расход добавлен — 2 150 AMD · Food Court 7 · Visa Digital · из Wallet»'
                }
              />
            </section>
          </>
        )}

        {removing && (
          <ConfirmDialog
            title="Отключить устройство?"
            message={`Уведомления перестанут приходить на «${removing.label}»`}
            confirmLabel="Отключить"
            busy={actions.removeDevice.isPending}
            onCancel={() => setRemoving(null)}
            onConfirm={() =>
              actions.removeDevice.mutate(
                { id: removing.id, thisDevice: removing.id === push.deviceId },
                { onSettled: () => setRemoving(null) },
              )
            }
          />
        )}
      </SettingsSection>
    </div>
  );
}

function TypeChoice({
  title,
  on,
  explainOn,
  explainOff,
  onChange,
}: {
  title: string;
  on: boolean;
  explainOn: string;
  explainOff: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <ChoiceSetting
      title={title}
      value={on ? 'on' : 'off'}
      onChange={(value) => onChange(value === 'on')}
      choices={[
        { value: 'on', label: 'Присылать', icon: <BellIcon /> },
        { value: 'off', label: 'Не присылать', icon: <EyeOffIcon /> },
      ]}
      helper={on ? explainOn : explainOff}
    />
  );
}
