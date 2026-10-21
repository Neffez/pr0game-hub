-- UI language of the hub per user
ALTER TABLE users ADD COLUMN lang TEXT NOT NULL DEFAULT 'de' CHECK (lang IN ('de', 'en'));
