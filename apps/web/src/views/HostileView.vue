<script setup lang="ts">
import Hint from '../components/Hint.vue';
import { onMounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import RangePicker from '../components/RangePicker.vue';
import { useLoader, useStored, useUni, vStack } from '../composables';
import { tables, useLiveReload } from '../live';
import { ago, coords, dateTime } from '../format';

const { t } = useI18n();
const { uni } = useUni();
const days = useStored('hostile.days', 7);

const { data, error, load } = useLoader<any>(() => uniApi(uni.value, `/hostile?from=${Math.floor(Date.now() / 1000) - days.value * 86400}`));
onMounted(load);
useLiveReload(load, tables('hostile_spying'));
watch(days, load);
</script>

<template>
  <h1>{{ t('nav.hostile') }} <Hint>{{ t('hostile.hint') }}</Hint></h1>
  <div class="card row">
    <RangePicker v-model="days" />
  </div>
  <div v-if="error" class="error">{{ error }}</div>
  <template v-if="data">
    <h2>{{ t('hostile.whoSpies') }}</h2>
    <div class="table-wrap" style="max-height: 40vh; margin-bottom: 14px">
      <table v-stack class="data">
        <thead><tr><th>{{ t('common.player') }}</th><th class="num">{{ t('hostile.count') }}</th><th class="num">{{ t('hostile.victims') }}</th><th>{{ t('hostile.last') }}</th></tr></thead>
        <tbody>
          <tr v-for="s in data.bySpy" :key="s.from_player">
            <td>{{ s.from_player }}</td>
            <td class="num">{{ s.count }}</td>
            <td class="num">{{ s.victims }}</td>
            <td class="small">{{ ago(s.last) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <h2>{{ t('hostile.history') }}</h2>
    <div class="table-wrap">
      <table v-stack class="data">
        <thead><tr><th>{{ t('common.time') }}</th><th>{{ t('hostile.spy') }}</th><th>{{ t('common.from') }}</th><th>{{ t('hostile.target') }}</th><th>{{ t('hostile.member') }}</th></tr></thead>
        <tbody>
          <tr v-for="h in data.list" :key="h.id">
            <td class="small">{{ dateTime(h.time) }}</td>
            <td>{{ h.from_player }}</td>
            <td class="mono">{{ coords(h.from_g, h.from_s, h.from_p) }}{{ h.from_type === 'moon' ? ' ' + t('game.moonShort') : '' }} <span class="muted">{{ h.from_planet }}</span></td>
            <td class="mono">{{ coords(h.target_g, h.target_s, h.target_p) }}{{ h.target_type === 'moon' ? ' ' + t('game.moonShort') : '' }} <span class="muted">{{ h.target_planet }}</span></td>
            <td>{{ h.username }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </template>
</template>
