-- Alliance goals (sync incentives): the group's targets as JSON, null = the defaults (see repo/goals.ts).
ALTER TABLE groups ADD COLUMN goals TEXT;
