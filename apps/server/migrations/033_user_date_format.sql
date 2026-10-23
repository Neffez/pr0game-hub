-- Date format of the hub per user ('auto' follows the language)
ALTER TABLE users ADD COLUMN date_format TEXT NOT NULL DEFAULT 'auto' CHECK (date_format IN ('auto', 'dmy.', 'dmy/', 'ymd'));
