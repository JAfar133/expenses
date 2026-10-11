-- Мягкое удаление: запись, пропавшая из Excel, помечается удалённой, но остаётся в базе.
-- Так любую ошибку (например, подмену Excel старой копией) можно исправить.
ALTER TABLE expenses
  ADD COLUMN deleted_at     timestamptz,
  -- Почему запись удалена: excel — строку удалили или изменили в Excel при синхронизации
  ADD COLUMN deleted_reason text,
  ADD CONSTRAINT expenses_deleted_consistent CHECK ((deleted_at IS NULL) = (deleted_reason IS NULL));

-- Активные записи (не удалённые): по ним строятся списки и категории
CREATE INDEX expenses_active_date_idx ON expenses (date DESC) WHERE deleted_at IS NULL;
