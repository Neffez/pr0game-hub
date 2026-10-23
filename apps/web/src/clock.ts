import { computed, onScopeDispose, readonly, ref, type Ref } from 'vue';

/**
 * Ticking time without rendering whole pages every second: a page reads the clock only in computeds whose value
 * rarely changes (`upcoming`, counts, keys), the visible seconds come from `<Ticker>` / `<Countdown>`, which render
 * only themselves.
 */
export const nowSec = () => Math.floor(Date.now() / 1000);

/** One shared second clock; runs while at least one component uses it. */
const tick = ref(nowSec());
let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;

/** The shared second clock (call in `setup`; it stops when the last user is unmounted). */
export function useClock(): Readonly<Ref<number>> {
  if (users++ === 0) {
    tick.value = nowSec();
    timer = setInterval(() => (tick.value = nowSec()), 1000);
  }
  onScopeDispose(() => {
    if (--users === 0) clearInterval(timer);
  });
  return readonly(tick);
}

/**
 * Items of `list` whose time is still ahead of `clock`, in their order. The array only changes when the list
 * changes or an item runs out, not on every tick, so whatever renders it is not rendered again every second.
 */
export function upcoming<T>(list: Ref<T[]>, time: (x: T) => number, clock: Readonly<Ref<number>>) {
  const key = computed(() => list.value.map((x) => (time(x) > clock.value ? 1 : 0)).join(''));
  return computed(() => {
    const k = key.value;
    return list.value.filter((_, i) => k[i] === '1');
  });
}
