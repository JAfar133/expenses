-- Правка и удаление расходов в приложении с переносом в Excel.
--
-- excel_snapshot: как строка этой записи выглядит в Excel прямо сейчас (дата, карта, категория, наименование, стоимость).
-- Пусто, если записи в Excel нет. По снимку сверка сопоставляет строки Excel с записями, поэтому правка в приложении
-- не выглядит как «удалённая старая + новая». Что нужно сделать с Excel, выводится из состояния:
--   снимка нет, запись активна        → дописать строку
--   снимок есть и отличается          → заменить строку
--   снимок есть, запись удалена       → убрать строку
ALTER TABLE expenses
  ADD COLUMN excel_snapshot jsonb,
  ADD COLUMN updated_by text;

-- Уже находящиеся в Excel активные записи: строка Excel равна текущим значениям
UPDATE expenses
   SET excel_snapshot = jsonb_build_object(
         'date', to_char(date, 'YYYY-MM-DD'),
         'card', card,
         'category', category,
         'name', name,
         'amount', amount)
 WHERE excel_status = 'synced' AND deleted_at IS NULL;

-- Журнал изменений: кто, когда и что поменял (значения до и после)
CREATE TABLE expense_changes (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_id  uuid        NOT NULL REFERENCES expenses (id) ON DELETE CASCADE,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  changed_by  text        NOT NULL,
  action      text        NOT NULL CHECK (action IN ('update', 'delete', 'restore')),
  before      jsonb,
  after       jsonb
);

CREATE INDEX expense_changes_expense_idx ON expense_changes (expense_id, id);
