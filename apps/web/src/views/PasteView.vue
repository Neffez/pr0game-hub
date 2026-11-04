<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue';
import UniverseJson from '../components/UniverseJson.vue';
import Hint from '../components/Hint.vue';
import SyncPanel from '../components/SyncPanel.vue';
import { useI18n } from 'vue-i18n';
import { useAutoTour } from '../tours';

const { t } = useI18n();
useAutoTour('paste', true);
</script>

<template>
  <PageHeader :title="t('paste.title')" tour="paste">
    <template #hint>
      <Hint>
        <p>{{ t('paste.hint1') }}</p>
        <p>{{ t('paste.hint2') }}</p>
      </Hint>
    </template>
  </PageHeader>
  <div data-tour="paste-sync"><SyncPanel /></div>

  <div data-tour="paste-json"><UniverseJson /></div>
</template>
