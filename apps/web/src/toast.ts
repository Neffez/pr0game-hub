import { ref } from 'vue';

/** Short feedback after an own action ("Saved", "Plan created"), shown with the live hints (LiveToasts). */
export interface Notice {
  id: number;
  text: string;
  kind: 'ok' | 'warn';
}

export const notices = ref<Notice[]>([]);
let nextId = 0;

export function dismissNotice(id: number) {
  notices.value = notices.value.filter((n) => n.id !== id);
}

/** Shows `text` for a few seconds (at most three at a time); warnings stay a bit longer. */
export function toast(text: string, kind: Notice['kind'] = 'ok') {
  if (!text) return;
  const notice = { id: ++nextId, text, kind };
  notices.value = [...notices.value.slice(-2), notice];
  setTimeout(() => dismissNotice(notice.id), kind === 'warn' ? 8000 : 3500);
}
