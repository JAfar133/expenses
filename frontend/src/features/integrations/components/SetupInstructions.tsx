import { CopyField } from './CopyField.tsx';
import { IMPORT_PATH } from '../api/integrations.api.ts';

/** The address the phone calls: this site's address plus the import path. */
export const importUrl = () => `${window.location.origin}${IMPORT_PATH}`;

const code = 'rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs dark:bg-zinc-800';

/** Numbered steps for the iPhone automation. Shown inside the card (collapsed) and in the «Ключ создан» window. */
export function SetupInstructions({ showUrl = true }: { showUrl?: boolean }) {
  return (
    <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          Приложение «Команды» → «Автоматизация» → создайте личную автоматизацию → триггер
          «Уведомление», приложение IDBank, фильтр: заголовок содержит{' '}
          <span className={code}>GNUM</span>.
        </li>
        <li>Добавьте действие «Получить содержимое URL».</li>
        <li>Метод POST, URL как ниже.</li>
        <li>
          Заголовки: <span className={code}>Authorization</span> ={' '}
          <span className={code}>Bearer ваш_ключ</span>, <span className={code}>Content-Type</span>{' '}
          = <span className={code}>application/json</span>.
        </li>
        <li>
          Тело запроса JSON: <span className={code}>source</span> ={' '}
          <span className={code}>idbank</span>, <span className={code}>title</span> = переменная
          «Название уведомления», <span className={code}>body</span> = переменная «Текст
          уведомления». Это переменные Команд (их выбирают из списка), а не буквальный текст.
        </li>
        <li>
          Отключите «Запрашивать перед запуском», чтобы автоматизация работала при заблокированном
          телефоне.
        </li>
      </ol>
      {showUrl && <CopyField label="Адрес для запроса (URL)" value={importUrl()} />}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Работает, если iOS отдаёт Командам уведомления IDBank; проверьте на реальном уведомлении.
      </p>
    </div>
  );
}
