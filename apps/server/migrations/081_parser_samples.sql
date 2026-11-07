-- Pages members sent to the hub's admins because the hub found nothing in them (explained paste, backlog E-4).
-- Anonymized before they are stored (scripts, form values, session tokens and the sender's names removed); kept for
-- the retention of raw syncs.
CREATE TABLE parser_samples (
  id INTEGER PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- explanation code and page (explainNoData)
  code TEXT NOT NULL,
  page TEXT,
  note TEXT,
  html_gz BLOB,
  text_gz BLOB,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX parser_samples_created ON parser_samples (created_at);
