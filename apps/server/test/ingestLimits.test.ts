import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/auth.js';
import { INGEST_LIMITS, takeIngestSlot } from '../src/routes/ingest.js';

describe('ingest rate limit', () => {
  it('caps pastes per user within a minute', () => {
    const at = Date.now();
    for (let i = 0; i < INGEST_LIMITS.perUserPerMinute; i++) takeIngestSlot(1, 1, at);
    expect(() => takeIngestSlot(1, 1, at)).toThrow(HttpError);
    try {
      takeIngestSlot(1, 1, at);
    } catch (e) {
      expect((e as HttpError).code).toBe('ingest_rate_limit');
    }
    expect(() => takeIngestSlot(2, 2, at)).not.toThrow();
  });
});
