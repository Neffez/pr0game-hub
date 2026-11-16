-- API tokens choose read or read/write at creation; tokens created before stay read-only
ALTER TABLE api_tokens ADD COLUMN can_write INTEGER NOT NULL DEFAULT 0;
