import { Notice } from '../../../shared/ui/Notice.tsx';
import { CheckIcon, CloseIcon, PauseIcon, RefreshIcon } from '../../../shared/ui/icons.tsx';
import { toErrorMessage } from '../../group/model/error-message.ts';
import { formatDateTime } from '../../group/model/format.ts';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import type { AdminBackup } from '../api/admin.api.ts';
import { hasBackupProblem, useAdminBackup } from '../hooks/useAdminBackup.ts';
import { REMOTE_TEXT, RUN_ERROR_TEXT, STATE_TEXT, formatAge, formatSize } from '../model/backup.ts';

const TONES = {
  ok: { icon: <CheckIcon />, className: 'text-green-700 dark:text-green-400' },
  problem: { icon: <CloseIcon />, className: 'text-red-600 dark:text-red-400' },
  unknown: { icon: <PauseIcon />, className: 'text-zinc-500 dark:text-zinc-400' },
};

function StatusLine({ backup }: { backup: AdminBackup }) {
  const tone =
    backup.state === 'ok'
      ? TONES.ok
      : hasBackupProblem(backup.state)
        ? TONES.problem
        : TONES.unknown;
  const text =
    backup.state === 'unknown' && !backup.configured
      ? 'Не настроено на сервере'
      : STATE_TEXT[backup.state];

  return (
    <p className={`flex items-center gap-2 font-medium ${tone.className}`}>
      {tone.icon}
      {text}
    </p>
  );
}

function Details({ backup }: { backup: AdminBackup }) {
  const { lastSuccess, lastRun } = backup;
  return (
    <div className="space-y-2 text-sm">
      {lastSuccess && (
        <div>
          <p>
            Последняя копия: {formatDateTime(lastSuccess.at)}
            {backup.ageHours !== null && ` (${formatAge(backup.ageHours)})`}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {lastSuccess.file} · {formatSize(lastSuccess.sizeBytes)}
          </p>
          <p>Копия в OneDrive: {REMOTE_TEXT[lastSuccess.remote]}</p>
        </div>
      )}
      {lastRun && (
        <p>
          Последний запуск: {formatDateTime(lastRun.at)} —{' '}
          {lastRun.ok
            ? 'успешно'
            : `ошибка: ${RUN_ERROR_TEXT[lastRun.error] ?? RUN_ERROR_TEXT.unexpected}`}
        </p>
      )}
    </div>
  );
}

/** State of the nightly database backup. Read-only: the copies themselves are made by a script on the server. */
export function BackupSection() {
  const query = useAdminBackup();
  const backup = query.data;

  return (
    <SettingsSection
      title="Бэкап базы"
      hint={`Показывает, когда в последний раз успешно сделана копия базы и чем закончился последний запуск. Бэкап делает скрипт на сервере каждую ночь; здесь только состояние, сами копии приложение не трогает. Красный статус — копии нет дольше ${backup?.maxAgeHours ?? 26} часов или последний запуск завершился ошибкой.`}
    >
      {backup && hasBackupProblem(backup.state) && (
        <Notice variant="error">
          Проверьте на сервере: ./scripts/backup-db.sh и лог ~/backups/backup.log
        </Notice>
      )}
      {query.isError && <Notice variant="error">{toErrorMessage(query.error)}</Notice>}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          {backup && <StatusLine backup={backup} />}
          {backup && <Details backup={backup} />}
        </div>
        <button
          type="button"
          aria-label="Обновить"
          title="Обновить"
          aria-busy={query.isFetching}
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-indigo-600 hover:bg-indigo-50 disabled:opacity-60 sm:size-9 dark:text-indigo-300 dark:hover:bg-indigo-950/60"
        >
          <span className={query.isFetching ? 'animate-spin' : undefined}>
            <RefreshIcon />
          </span>
        </button>
      </div>
    </SettingsSection>
  );
}
