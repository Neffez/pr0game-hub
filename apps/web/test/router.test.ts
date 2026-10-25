// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { router } from '../src/router';

describe('routes', () => {
  it("opens a raid plan's page by its id, the settlement below it", () => {
    expect(router.resolve('/u7/raid-planner/7').matched.at(-1)?.path).toBe(String.raw`/:uni/raid-planner/:id(\d+)`);
    expect(router.resolve('/u7/raid-planner/7/loot').matched.at(-1)?.path).toBe('/:uni/raid-planner/:id/loot');
    expect(router.resolve('/u7/raid-planner').matched.at(-1)?.path).toBe('/:uni/raid-planner');
  });
});
