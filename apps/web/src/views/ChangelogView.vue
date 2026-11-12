<script setup lang="ts">
import BackLink from '../components/BackLink.vue';
import PageHeader from '../components/PageHeader.vue';
import { useAutoTour } from '../tours';
import { useI18n } from 'vue-i18n';
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CHANGELOG } from '../changelog';
import { currentLang, intlLocale } from '../i18n';
import { useStored } from '../composables';
import { session } from '../api';

/** AGPL-3.0 section 13: users of the hub get a way to the source code */
const SOURCE_URL = 'https://github.com/Neffez/pr0game-hub';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
/** opened inside a universe: the sidebar stays, no back link */
const inUni = computed(() => !!route.params.uni);
/** public `/about` without login: benefits only */
const aboutOnly = computed(() => route.meta.aboutOnly === true);
const standalone = computed(() => !inUni.value);

const backTo = computed(() => {
  if (aboutOnly.value) return session.me?.user ? '/' : '/login';
  if (standalone.value) return '/';
  return null;
});
const backLabel = computed(() => (aboutOnly.value && !session.me?.user ? t('requestAccess.toLogin') : t('common.back')));

const TABS = ['news', 'about'] as const;
type Tab = (typeof TABS)[number];
const storedTab = useStored<Tab>('changelog.tab', 'news');
const tab = computed<Tab>({
  get: () => {
    if (aboutOnly.value) return 'about';
    return TABS.includes(route.query.tab as Tab)
      ? (route.query.tab as Tab)
      : TABS.includes(storedTab.value)
        ? storedTab.value
        : 'news';
  },
  set: (v) => {
    if (aboutOnly.value) return;
    storedTab.value = v;
    router.replace({ query: { ...route.query, tab: v } });
  },
});

/** Sections on the About tab; item count matches `changelog.about.<id>.i0` … */
const ABOUT_SECTIONS = [
  { id: 'universe', count: 3 },
  { id: 'farm', count: 4 },
  { id: 'raids', count: 4 },
  { id: 'defense', count: 4 },
  { id: 'build', count: 3 },
  { id: 'alliance', count: 5 },
  { id: 'expo', count: 2 },
  { id: 'notify', count: 1 },
] as const;

const day = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

onMounted(() => {
  if (aboutOnly.value) return;
  if (!route.query.tab && storedTab.value !== 'news') router.replace({ query: { ...route.query, tab: storedTab.value } });
});
watch(
  () => route.query.tab,
  (q) => {
    if (aboutOnly.value) return;
    if (q === 'news' || q === 'about') storedTab.value = q;
  },
);

useAutoTour('changelog', () => !aboutOnly.value, tab);
</script>

<template>
  <div class="changelog" :class="{ standalone }">
    <BackLink v-if="backTo" :to="backTo" :label="backLabel" />
    <PageHeader :title="aboutOnly ? t('changelog.tabAbout') : t('changelog.title')" :tour="aboutOnly ? undefined : 'changelog'">
      <div v-if="!aboutOnly" class="seg">
        <button data-tour="changelog-tab-news" :class="{ active: tab === 'news' }" type="button" @click="tab = 'news'">
          {{ t('changelog.tabNews') }}
        </button>
        <button data-tour="changelog-tab-about" :class="{ active: tab === 'about' }" type="button" @click="tab = 'about'">
          {{ t('changelog.tabAbout') }}
        </button>
      </div>
    </PageHeader>

    <template v-if="tab === 'news'">
      <p class="muted">{{ t('changelog.intro') }}</p>
      <p class="muted"><a :href="SOURCE_URL" target="_blank" rel="noopener">{{ t('changelog.source') }}</a></p>
      <section v-for="d in CHANGELOG" :key="d.date" class="card">
        <h2>{{ day(d.date) }}</h2>
        <ul>
          <li v-for="(item, i) in d.items" :key="i">
            <span class="kind" :class="item.kind">{{ t(`changelog.${item.kind}`) }}</span>
            <span>{{ item[currentLang()] }}</span>
          </li>
        </ul>
      </section>
    </template>

    <article v-else class="about" data-tour="changelog-about">
      <section v-for="s in ABOUT_SECTIONS" :key="s.id" class="about-section card">
        <h2>{{ t(`changelog.about.${s.id}.title`) }}</h2>
        <ul>
          <li v-for="n in s.count" :key="n">{{ t(`changelog.about.${s.id}.i${n - 1}`) }}</li>
        </ul>
      </section>
      <p class="about-summary muted">{{ t('changelog.about.summary') }}</p>
    </article>
  </div>
</template>

<style scoped>
.changelog { max-width: 900px; }
.changelog.standalone { margin: 6vh auto; padding: 0 16px; }
.card h2 { margin: 0 0 10px; font-size: 16px; }
.about-section + .about-section { margin-top: 12px; }
.about-section ul { margin: 0; padding-left: 1.2em; list-style: disc; }
.about-section li { display: list-item; }
.about-section li + li { margin-top: 6px; }
.about-summary { margin-top: 16px; line-height: 1.45; }
ul { list-style: none; margin: 0; padding: 0; }
li { display: flex; gap: 10px; align-items: baseline; }
li + li { margin-top: 8px; }
.kind { flex: none; min-width: 64px; padding: 0 6px; border-radius: 4px; font-size: 11px; font-weight: 600; text-align: center; background: var(--surface-2); }
.kind.new { color: var(--pos); }
.kind.fix { color: var(--info); }
</style>
