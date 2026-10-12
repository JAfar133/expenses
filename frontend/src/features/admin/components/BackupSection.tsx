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
  /** Color of the icon (and of the text for a problem) */
  tone: string;
  text: ReactNode;
  /** Small grey labels after the text (size, OneDrive) */
  chips?: ReactNode;
  /** A muted second line (the file name) */
  sub?: string;
}

const CHIP =
  'rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300';
const CHIP_RED =
  'rounded-md bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-600 dark:bg-red-950/50 dark:text-red-400';

/** The state: only the check mark is green, the date is plain text, size and OneDrive are small labels. */
function toLine(backup: AdminBackup): Line {
  const { state, lastSuccess, lastRun } = backup;

  if (state === 'ok' && lastSuccess) {
    return {
      icon: <CheckIcon />,
      tone: GREEN,
      text: <span className="font-medium">{formatShortDateTime(lastSuccess.at)}</span>,
      chips: (
        <>
          <span className={CHIP}>{formatSize(lastSuccess.sizeBytes)}</span>
          {lastSuccess.remote === 'ok' && <span className={CHIP}>OneDrive</span>}
          {lastSuccess.remote === 'failed' && <span className={CHIP_RED}>OneDrive ✗</span>}
        </>
      ),
      sub: lastSuccess.file,
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
            <div className="flex items-start gap-2 text-sm">
              <span className={`mt-0.5 shrink-0 ${line.tone}`}>{line.icon}</span>
              <div className="min-w-0">
                <p
                  className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${line.chips ? '' : `font-medium ${line.tone}`}`}
                >
                  {line.text}
                  {line.chips}
                </p>
                {line.sub && <p className={`mt-0.5 break-all text-xs ${GREY}`}>{line.sub}</p>}
              </div>
            </div>
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
