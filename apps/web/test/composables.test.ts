import { describe, expect, it } from 'vitest';
import { nextTick, ref } from 'vue';
import { useLoader, useProgressive, useSort } from '../src/composables';

describe('useSort', () => {
  const rows = ref([
    { name: 'b', points: 5 },
    { name: 'a', points: null },
    { name: 'c', points: 10 },
  ]);
  const sort = useSort(rows, (r, key) => (key === 'name' ? r.name : r.points), 'points');

  it('sorts descending first, empty values always last', () => {
    expect(sort.sorted.value.map((r) => r.name)).toEqual(['c', 'b', 'a']);
    sort.sortBy('points');
    expect(sort.sorted.value.map((r) => r.name)).toEqual(['b', 'c', 'a']);
    expect(sort.direction('points')).toBe('asc');
    expect(sort.direction('name')).toBe(null);
  });

  it('a new key starts descending again', () => {
    sort.sortBy('name');
    expect(sort.sorted.value.map((r) => r.name)).toEqual(['c', 'b', 'a']);
    expect(sort.descending.value).toBe(true);
  });
});

describe('useLoader', () => {
  it('applies only the answer to the newest request', async () => {
    const pending: ((v: string) => void)[] = [];
    const { data, load } = useLoader(() => new Promise<string>((resolve) => pending.push(resolve)));
    const first = load();
    const second = load();
    pending[1]('new');
    pending[0]('old');
    expect(await second).toBe('new');
    expect(await first).toBeUndefined();
    expect(data.value).toBe('new');
  });

  it('keeps a failure in error instead of throwing', async () => {
    const { data, error, load } = useLoader(() => Promise.reject(new Error('down')));
    expect(await load()).toBeUndefined();
    expect(error.value).toBe('down');
    expect(data.value).toBeNull();
  });
});

describe('useProgressive', () => {
  it('shows the first step and starts over when the list changes', async () => {
    const list = ref(Array.from({ length: 10 }, (_, i) => i));
    const { shown, more } = useProgressive(list, 4);
    expect(shown.value).toEqual([0, 1, 2, 3]);
    expect(more.value).toBe(true);
    list.value = [9, 8];
    await nextTick();
    expect(shown.value).toEqual([9, 8]);
    expect(more.value).toBe(false);
  });
});
