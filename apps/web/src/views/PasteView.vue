<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue';
import UniverseJson from '../components/UniverseJson.vue';
import Hint from '../components/Hint.vue';
import SyncPanel from '../components/SyncPanel.vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <PageHeader :title="t('paste.title')">
    <template #hint>
      <Hint>
        <p>{{ t('paste.hint1') }}</p>
        <p>{{ t('paste.hint2') }}</p>
      </Hint>
    </template>
  </PageHeader>
  <SyncPanel />

  <UniverseJson />
</template>
