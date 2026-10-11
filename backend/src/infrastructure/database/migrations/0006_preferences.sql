-- Настройки интерфейса пользователя (виды графиков и т.п.): хранятся на сервере, чтобы выбор был один на всех устройствах.
ALTER TABLE users ADD COLUMN preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
