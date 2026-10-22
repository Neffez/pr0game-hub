<script setup lang="ts">
import UniverseJson from '../components/UniverseJson.vue';
import Hint from '../components/Hint.vue';
import SyncPanel from '../components/SyncPanel.vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<template>
  <h1>
    {{ t('paste.title') }}
    <Hint>
      <p>{{ t('paste.hint1') }}</p>
      <p>{{ t('paste.hint2') }}</p>
    </Hint>
  </h1>
  <SyncPanel />

  <UniverseJson />
</template>
