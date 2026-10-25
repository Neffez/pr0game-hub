<script setup lang="ts">
import Icon from '../components/Icon.vue';
import Hint from '../components/Hint.vue';
import PlanetActions from '../components/PlanetActions.vue';
import PlayerLink from '../components/PlayerLink.vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { activeClaims, remaining } from '../claims';
import { useUni, vStack } from '../composables';
import { coords, dateTime } from '../format';

/** Targets claimed by members of the alliance, the own ones first. */
const { t } = useI18n();
const { uni, ctx } = useUni();

const rows = computed(() => {
  const me = ctx.value?.me.id;
  return [...activeClaims.value].sort((a, b) => Number(b.user_id === me) - Number(a.user_id === me) || a.expires_at - b.expires_at);
});
const browseLink = (c: { g: number; s: number }) => ({ path: `/${uni.value}/browse`, query: { g: c.g, s: c.s } });
</script>

<template>
  <h1>
    {{ t('nav.targets') }}
    <Hint>{{ t('claims.hint') }}</Hint>
  </h1>
  <div v-if="!rows.length" class="card muted">{{ t('claims.none') }}</div>
  <div v-else class="card table-wrap">
    <table v-stack class="data">
      <thead>
        <tr>
          <th>{{ t('claims.target') }}</th>
          <th>{{ t('common.player') }}</th>
          <th>{{ t('claims.kind') }}</th>
          <th>{{ t('claims.member') }}</th>
          <th>{{ t('claims.left') }}</th>
          <th>{{ t('claims.note') }}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in rows" :key="c.id">
          <td>
            <RouterLink class="mono" :to="browseLink(c)">{{ coords(c.g, c.s, c.p) }}</RouterLink>
            <Icon v-if="c.planet_type === 'moon'" name="moon" :size="12" :label="t('common.moon')" /> <span class="muted">{{ c.planet_name ?? '' }}</span>
          </td>
          <td><PlayerLink v-if="c.player_id" :id="c.player_id" :name="c.player_name ?? '?'" /></td>
          <td>{{ t(`claims.kinds.${c.kind}`) }}</td>
          <td>{{ c.member }}</td>
          <td :title="dateTime(c.expires_at)">{{ remaining(c) }}</td>
          <td class="m-wide">{{ c.note ?? '' }}</td>
          <td><PlanetActions :g="c.g" :s="c.s" :p="c.p" :type="c.planet_type" /></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
