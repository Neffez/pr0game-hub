-- Revision of a build order for optimistic concurrency (ETag / If-Match): raised on every client write and on the
-- automatic assignment of a planned planet, not when a sync only stores steps seen done.
ALTER TABLE build_orders ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
