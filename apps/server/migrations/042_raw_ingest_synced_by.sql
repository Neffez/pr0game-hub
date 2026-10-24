-- Member who pasted a sync for another member (user_id is the member the data counts for), NULL for own syncs.
ALTER TABLE raw_ingests ADD COLUMN synced_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
