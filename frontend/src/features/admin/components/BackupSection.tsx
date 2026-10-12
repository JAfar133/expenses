import type { ReactNode } from 'react';
import { Notice } from '../../../shared/ui/Notice.tsx';
import { CheckIcon, CloseIcon, PauseIcon, RefreshIcon } from '../../../shared/ui/icons.tsx';
import { toErrorMessage } from '../../group/model/error-message.ts';
import { SettingsSection } from '../../settings/components/SettingsSection.tsx';
import type { AdminBackup } from '../api/admin.api.ts';
import { hasBackupProblem, useAdminBackup } from '../hooks/useAdminBackup.ts';
import { RUN_ERROR_TEXT, formatAge, formatShortDateTime, formatSize } from '../model/backup.ts';

const RED = 'text-red-600 dark:text-red-400';
const GREEN = 'text-green-700 dark:text-green-400';
const GREY = 'text-zinc-500 dark:text-zinc-400';

interface Line {
  icon: ReactNode;
  tone: string;
  text: ReactNode;
}

/** The whole state in one short line. */
function toLine(backup: AdminBackup): Line {
  const { state, lastSuccess, lastRun } = backup;

  if (state === 'ok' && lastSuccess) {
    return {
      icon: <CheckIcon />,
      tone: GREEN,
      text: (
        <>
          {formatShortDateTime(lastSuccess.at)} · {lastSuccess.file} ·{' '}
          {formatSize(lastSuccess.sizeBytes)}
          {lastSuccess.remote === 'ok' && ' · OneDrive'}
          {lastSuccess.remote === 'failed' && <span className={RED}> · OneDrive ✗</span>}
        </>
      ),
    };
  }
  if (state === 'stale') {
    return {
      icon: <CloseIcon />,
      tone: RED,
      text: lastSuccess
        ? `Нет свежей копии · последняя ${formatShortDateTime(lastSuccess.at)} (${formatAge(backup.ageHours)})`
        : 'Копий нет',
    };
  }
  if (state === 'failed') {
    const reason = RUN_ERROR_TEXT[lastRun?.error ?? ''] ?? RUN_ERROR_TEXT.unexpected;
    return {
      icon: <CloseIcon />,
      tone: RED,
      text: `Ошибка запуска: ${reason}${lastSuccess ? ` · последняя копия ${formatShortDateTime(lastSuccess.at)}` : ''}`,
    };
  }
  return {
    icon: <PauseIcon />,
    tone: GREY,
    text: backup.configured ? 'Нет данных' : 'Не настроено',
  };
}

/** State of the nightly database backup. Read-only: the copies themselves are made by a script on the server. */
export function BackupSection() {
  const query = useAdminBackup();
  const backup = query.data;
  const line = backup && toLine(backup);

  return (
    <SettingsSection
      title="Бэкап базы"
      hint={`Состояние ночного бэкапа базы. Красное: нет свежей копии (дольше ${backup?.maxAgeHours ?? 26} ч) или последний запуск закончился ошибкой.`}
    >
      {query.isError && <Notice variant="error">{toErrorMessage(query.error)}</Notice>}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {line && (
            <p className={`flex items-start gap-2 text-sm font-medium ${line.tone}`}>
              <span className="mt-0.5 shrink-0">{line.icon}</span>
              <span className="min-w-0">{line.text}</span>
            </p>
          )}
          {backup && hasBackupProblem(backup.state) && (
            <p className={`mt-1 pl-7 text-xs ${GREY}`}>
              Проверьте на сервере: ./scripts/backup-db.sh · лог ~/backups/backup.log
            </p>
          )}
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
