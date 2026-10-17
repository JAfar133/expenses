import { CopyField } from './CopyField.tsx';
import { importUrl } from './SetupInstructions.tsx';

const code = 'rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs dark:bg-zinc-800';
const FIELDS: [string, string][] = [
  ['source', 'apple_wallet'],
  ['title', 'Транзакция → Имя'],
  ['body', 'Транзакция → Транзакция'],
  ['transaction', 'Транзакция → Транзакция'],
  ['merchant', 'Транзакция → Продавец'],
  ['amount', 'Транзакция → Сумма'],
  ['card', 'Транзакция → Карта, пропуск или проездной'],
  ['name', 'Транзакция → Имя'],
  ['receivedAt', 'Текущая дата (формат ISO 8601)'],
  ['device', 'Информация об устройстве (если есть)'],
];

/** Numbered steps for the Apple Wallet automation («Транзакция» trigger in «Команды»). */
export function WalletInstructions() {
  return (
    <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
      <ol className="list-decimal space-y-2 pl-5">
        <li>
          Приложение «Команды» → «Автоматизация» → «Транзакция»: любая категория, любой продавец,
          выбранные карты, «Запускать немедленно».
        </li>
        <li>Действие «Получить содержимое URL»: метод POST на этот адрес (ниже).</li>
        <li>
          Заголовок <span className={code}>Authorization</span> ={' '}
          <span className={code}>Bearer ваш_ключ</span>. Можно создать отдельный ключ «iPhone —
          Wallet»: так в журнале видно, откуда пришёл запрос.
        </li>
        <li>
          Заголовок <span className={code}>Content-Type</span> ={' '}
          <span className={code}>application/json</span>.
        </li>
        <li>
          Тело запроса JSON, поля:
          <ul className="mt-1 space-y-0.5">
            {FIELDS.map(([name, value]) => (
              <li key={name}>
                <span className={code}>{name}</span> = {value}
              </li>
            ))}
          </ul>
        </li>
      </ol>
      <CopyField label="Адрес для запроса Wallet (URL)" value={importUrl()} />
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Все значения — переменные Команд без обработки. Неизвестные и пустые поля сервер принимает и
        сохраняет в журнале; сначала посмотрите журнал, чтобы увидеть, что реально присылает Wallet.
      </p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Один и тот же адрес работает для IDBank и Wallet одновременно: если об одной покупке пришли
        оба сообщения, сервер объединит их в один расход.
      </p>
    </div>
  );
}
