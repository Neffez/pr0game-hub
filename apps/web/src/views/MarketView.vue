<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { uniApi } from '../api';
import Hint from '../components/Hint.vue';
import Icon from '../components/Icon.vue';
import { useLoader, useUni, vStack, type MarketRate } from '../composables';
import { tables, useLiveReload } from '../live';
import { clockTime, dateTime, duration, fmt, name, rateText, timeWithAge } from '../format';
import { toast } from '../toast';

/** Resource market: the group's rate (synced or set by hand) and the open offers of the latest marketplace sync. */
interface Offer {
  id: number;
  offerId: number | null;
  give: { res: Res; amount: number };
  want: { res: Res; amount: number };
  ratio: number | null;
  ally: boolean;
  endsAt: number;
  firstSeen: number;
}
type Res = 'm' | 'k' | 'd';

const RES_ID: Record<Res, number> = { m: 901, k: 902, d: 903 };

const { t } = useI18n();
const { uni, ctx } = useUni();
const { data, error, load } = useLoader(() =>
  uniApi<{ rate: MarketRate | null; rates: MarketRate[]; syncedAt: number | null; syncedBy: string | null; offers: Offer[] }>(uni.value, '/market'),
);
onMounted(load);
useLiveReload(load, tables('market_rates', 'market_offers'));

/** countdowns of the offers */
const now = ref(Math.floor(Date.now() / 1000));
const timer = setInterval(() => (now.value = Math.floor(Date.now() / 1000)), 1000);
onBeforeUnmount(() => clearInterval(timer));

const m = ref<number | null>(null);
const k = ref<number | null>(null);
watch(
  () => data.value?.rate,
  (r) => {
    m.value = r ? Math.round(r.m * 100) / 100 : null;
    k.value = r ? Math.round(r.k * 100) / 100 : null;
  },
  { immediate: true },
);
const busy = ref(false);
const valid = computed(() => !!m.value && m.value > 0 && m.value <= 100 && !!k.value && k.value > 0 && k.value <= 100);
async function save() {
  if (!valid.value) return;
  busy.value = true;
  try {
    const rate = await uniApi<MarketRate>(uni.value, '/market/rate', { method: 'PUT', body: { m: m.value, k: k.value } });
    if (ctx.value) ctx.value.marketRate = rate;
    toast(t('market.saved'));
    await load();
  } catch (e) {
    toast((e as Error).message, 'warn');
  } finally {
    busy.value = false;
  }
}

const sourceLabel = (r: MarketRate) => t(`market.source.${r.source}`);
const resName = (res: Res) => name(RES_ID[res]);
/** the offer's exchange rate at the current rate (offered value / asked value in deuterium) */
function ratio(o: Offer): number | null {
  const r = data.value?.rate;
  if (!r) return o.ratio;
  const per: Record<Res, number> = { m: r.m, k: r.k, d: 1 };
  return o.give.amount / per[o.give.res] / (o.want.amount / per[o.want.res]);
}
/** green above, red below the market rate, by the shown two decimals */
function tone(o: Offer) {
  const r = ratio(o);
  if (r == null) return '';
  const shown = Math.round(r * 100);
  return shown > 100 ? 'pos' : shown < 100 ? 'neg' : '';
}
const offers = computed(() => (data.value?.offers ?? []).filter((o) => o.endsAt > now.value));
</script>

<template>
  <PageHeader :title="t('nav.market')">
    <template #hint>
      <Hint>
        <p>{{ t('market.hint1') }}</p>
        <p>{{ t('market.hint2') }}</p>
        <p>{{ t('market.hint3') }}</p>
      </Hint>
    </template>
  </PageHeader>

  <div v-if="error" class="error">{{ error }}</div>
  <template v-else-if="data">
    <div class="card">
      <h2 class="mt-0">{{ t('market.rate') }}</h2>
      <template v-if="data.rate">
        <p class="rate mono">{{ rateText(data.rate.m, data.rate.k) }}</p>
        <p class="muted small">
          {{ name(901) }} : {{ name(902) }} : {{ name(903) }} ·
          {{ t('market.asOf', { source: sourceLabel(data.rate), time: timeWithAge(data.rate.time), by: data.rate.by ?? '?' }) }}
        </p>
      </template>
      <p v-else class="muted">{{ t('market.noRate') }}</p>
      <form class="row set" @submit.prevent="save">
        <label>{{ name(901) }} <input v-model.number="m" type="number" step="0.01" min="0.01" max="100" required /></label>
        <label>{{ name(902) }} <input v-model.number="k" type="number" step="0.01" min="0.01" max="100" required /></label>
        <span class="muted">{{ name(903) }} 1</span>
        <button class="primary" :disabled="busy || !valid">{{ t('market.set') }}</button>
      </form>
      <details v-if="data.rates.length > 1" class="history">
        <summary class="small muted">{{ t('market.history') }}</summary>
        <table class="data" style="width: auto">
          <tbody>
            <tr v-for="r in data.rates" :key="`${r.time}-${r.source}`">
              <td class="small">{{ dateTime(r.time) }}</td>
              <td class="mono">{{ rateText(r.m, r.k) }}</td>
              <td class="small muted">{{ sourceLabel(r) }}</td>
              <td class="small muted">{{ r.by ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </div>

    <div class="card">
      <h2 class="mt-0">{{ t('market.offers') }}</h2>
      <p v-if="data.syncedAt" class="muted small">{{ t('market.syncedAt', { time: timeWithAge(data.syncedAt), by: data.syncedBy ?? '?' }) }}</p>
      <p v-if="!data.syncedAt" class="muted">{{ t('market.notSynced') }}</p>
      <p v-else-if="!offers.length" class="muted">{{ t('market.noOffers') }}</p>
      <div v-else class="table-wrap flat offers">
        <table v-stack="3" class="data">
          <thead>
            <tr>
              <th class="num">{{ t('market.give') }}</th>
              <th />
              <th class="num">{{ t('market.want') }}</th>
              <th class="num">{{ t('market.ratio') }}</th>
              <th>{{ t('market.ends') }}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in offers" :key="o.id">
              <td class="num">{{ fmt(o.give.amount) }} {{ resName(o.give.res) }}</td>
              <td class="faint"><Icon name="arrowRight" :size="12" /></td>
              <td class="num">{{ fmt(o.want.amount) }} {{ resName(o.want.res) }}</td>
              <td class="num" :class="tone(o)">{{ fmt(ratio(o), 2) }}</td>
              <td class="small nowrap">{{ clockTime(new Date(o.endsAt * 1000)) }} <span class="muted">({{ duration(o.endsAt - now) }})</span></td>
              <td class="small muted">{{ o.ally ? t('market.ally') : '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </template>
</template>

<style scoped>
.rate { font-size: 22px; margin: 4px 0; }
.set { margin-top: 12px; gap: 10px; }
.set input { width: 90px; }
.history { margin-top: 12px; }
.history table { margin-top: 6px; }
.offers { width: fit-content; max-width: 100%; }
.offers table { width: auto; }
</style>
