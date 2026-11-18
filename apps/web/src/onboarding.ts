import { ref, type Ref } from 'vue';
import { uniApi } from './api';
import type { Onboarding } from './apiTypes';
import { useStored } from './composables';

/** Onboarding checklist of the viewer (server: repo/onboarding.ts), shared by its card and the overview's sync section head. */
export const onboarding = ref<Onboarding | null>(null);
let loadedFor = '';

export async function loadOnboarding(uni: string): Promise<void> {
  if (loadedFor !== uni) onboarding.value = null;
  loadedFor = uni;
  try {
    const res = await uniApi<Onboarding>(uni, '/onboarding');
    if (loadedFor === uni) onboarding.value = res;
  } catch {
    /* the card simply stays away */
  }
}

/** The member hid the checklist (per device and universe); one ref per universe, shared by everyone who reads it. */
const hidden = new Map<string, Ref<boolean>>();
export function onboardingHidden(uni: string): Ref<boolean> {
  let r = hidden.get(uni);
  if (!r) hidden.set(uni, (r = useStored<boolean>(`onboarding.hidden.${uni}`, false)));
  return r;
}
