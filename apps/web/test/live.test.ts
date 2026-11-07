import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session } from '../src/api';
import { dispatch, tables, useLiveReload, type DataEvent } from '../src/live';

const listeners = new Map<string, () => void>();
const doc = document as unknown as { hidden: boolean; addEventListener: unknown; removeEventListener: unknown };
doc.addEventListener = (type: string, fn: () => void) => listeners.set(type, fn);
doc.removeEventListener = () => {};

const event = (...names: string[]): DataEvent => ({ type: 'data', tables: names });

describe('useLiveReload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // outside a component: no unmount hook to register (the test doesn't unmount)
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    doc.hidden = false;
    // no random spread unless a test asks for it
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    session.me = null;
  });

  it('reloads once for a burst of matching events', () => {
    const load = vi.fn();
    useLiveReload(load, tables('spy_reports'));
    dispatch(event('spy_reports'));
    dispatch(event('galaxy_systems'));
    vi.advanceTimersByTime(500);
    dispatch(event('spy_reports', 'player_scores'));
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(load).toHaveBeenCalledTimes(1);
    dispatch(event('galaxy_systems'));
    vi.advanceTimersByTime(2000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reloads a hidden tab once it is shown again, and after a reconnect', () => {
    const load = vi.fn();
    useLiveReload(load, tables('expeditions'));
    doc.hidden = true;
    dispatch(event('expeditions'));
    vi.advanceTimersByTime(1000);
    expect(load).not.toHaveBeenCalled();
    doc.hidden = false;
    listeners.get('visibilitychange')!();
    expect(load).toHaveBeenCalledTimes(1);
    dispatch({ type: 'resync' });
    vi.advanceTimersByTime(1000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("spreads reloads for other members' syncs, not for own ones", () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    session.me = { user: { id: 7 } } as typeof session.me;
    const load = vi.fn();
    useLiveReload(load, tables('spy_reports'));
    dispatch({ ...event('spy_reports'), userId: 8 });
    vi.advanceTimersByTime(1700);
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(load).toHaveBeenCalledTimes(1);
    dispatch({ ...event('spy_reports'), userId: 7 });
    vi.advanceTimersByTime(1000);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
