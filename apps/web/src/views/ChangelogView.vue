<script setup lang="ts">
import BackLink from '../components/BackLink.vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { CHANGELOG } from '../changelog';
import { currentLang, intlLocale } from '../i18n';

const { t } = useI18n();
/** opened inside a universe: the sidebar stays, no back link */
const inUni = !!useRoute().params.uni;

const day = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
</script>

<template>
  <div class="changelog" :class="{ standalone: !inUni }">
    <BackLink v-if="!inUni" to="/" :label="t('common.back')" />
    <h1>{{ t('changelog.title') }}</h1>
    <p class="muted">{{ t('changelog.intro') }}</p>
    <section v-for="d in CHANGELOG" :key="d.date" class="card">
      <h2>{{ day(d.date) }}</h2>
      <ul>
        <li v-for="(item, i) in d.items" :key="i">
          <span class="kind" :class="item.kind">{{ t(`changelog.${item.kind}`) }}</span>
          <span>{{ item[currentLang()] }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.changelog { max-width: 900px; }
.changelog.standalone { margin: 6vh auto; padding: 0 16px; }
.card h2 { margin: 0 0 10px; font-size: 16px; }
ul { list-style: none; margin: 0; padding: 0; }
li { display: flex; gap: 10px; align-items: baseline; }
li + li { margin-top: 8px; }
.kind { flex: none; min-width: 64px; padding: 0 6px; border-radius: 4px; font-size: 11px; font-weight: 600; text-align: center; background: var(--surface-2); }
.kind.new { color: var(--pos); }
.kind.fix { color: var(--info); }
</style>
