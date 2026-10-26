/* Battle simulator UI. The battles run in ./worker.js on Battlerust (@pr0hub/battle), glue in ../src/battle.ts. */
import { decodeShare, encodeShare } from '@pr0hub/battle';
import {
  COMBAT_TECHS,
  DEFENSE_IDS,
  DRIVE_TECHS,
  MAX_RUNS,
  MAX_SLOTS,
  SHIP_IDS,
  applySpyReport,
  balance,
  battleSetup,
  defaultDebrisTo,
  cleanState,
  elementName,
  emptySlot,
  emptyState,
  fightingSlots,
  shareFromState,
  simSettings,
  slotFlight,
  stateFromShare,
} from '../src/battle.ts';
import { DEFAULT_UNI, parseAmount } from '../src/core.ts';
import { TEXTS } from './i18n.js';
import { $, $$, applyTexts, bindLang, bindShare, bindTips, clearHash, esc, fmtNum, initTexts, lang, load, store, t, toast } from '../shared/shell.js';
import { BATTLE_LAYOUT_DEFAULTS, BATTLE_UNI_DEFAULTS, LS_UNI, UNI_HASH, fieldsetsHtml, openDialog, syncUniInputs, uniFieldGroups, uniSummary } from '../shared/uni.js';

var LS_STATE = 'pr0bs.state.v1';
var LS_TABS = 'pr0bs.tabs.v1';
var MAX_TABS = 12;
var SPEEDS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
/* recycler capacity for the debris field */
var RECYCLER = 20000;

var S = emptyState();
var U = Object.assign({}, DEFAULT_UNI, BATTLE_LAYOUT_DEFAULTS, BATTLE_UNI_DEFAULTS);
/* selected slot per side */
var active = {att: 0, def: 0};
var spyMsg = null;
/* running job (of one tab), the active tab's last result and whether its inputs changed since */
var worker = null;
var job = null;
var last = null;
var stale = false;
/* independent simulations: {id, name, state, last, stale}; results stay in memory only */
var TABS = [];
var activeTab = null;
var tabSeq = 0;
var closedTab = null;

/* ---------- helpers ---------- */

function num(n) { return fmtNum(Math.round(n || 0)); }

function pad(n) { return n < 10 ? '0' + n : String(n); }

function fmtDur(seconds) {
  seconds = Math.max(0, Math.round(seconds));
  var days = Math.floor(seconds / 86400);
  var rest = seconds % 86400;
  var clock = pad(Math.floor(rest / 3600)) + ':' + pad(Math.floor((rest % 3600) / 60)) + ':' + pad(rest % 60);
  return days > 0 ? days + 'd ' + clock : clock;
}

/* Short amounts: 1,2 Mio / 633k. */
function short(n) {
  var a = Math.abs(n);
  var dec = function (v) { return lang() === 'de' ? String(v).replace('.', ',') : String(v); };
  if (a >= 1e9) return dec(Math.round(n / 1e8) / 10) + (lang() === 'de' ? ' Mrd' : 'B');
  if (a >= 1e6) return dec(Math.round(n / 1e5) / 10) + (lang() === 'de' ? ' Mio' : 'M');
  if (a >= 1e4) return Math.round(n / 1e3) + 'k';
  return num(n);
}

function pct(share) { return Math.round(share * 100) + ' %'; }

/* Signed amount for the balance: +1.234 / −1.234, nothing as a dash. */
function signed(n) {
  var r = Math.round(n);
  if (!r) return '—';
  return (r > 0 ? '+' : '−') + fmtNum(Math.abs(r));
}

function avgRange(r) { return r.min === r.max ? num(r.avg) : num(r.avg) + ' (' + num(r.min) + '–' + num(r.max) + ')'; }

function kpi(label, value, sub, cls) {
  return '<div class="kpi ' + (cls || '') + '"><span class="kpi-label">' + esc(label) + '</span>'
    + '<span class="kpi-value">' + esc(value) + '</span>'
    + (sub ? '<span class="kpi-sub">' + esc(sub) + '</span>' : '') + '</div>';
}

function fmtCoords(c) { return c ? c.join(':') : ''; }

function parseCoordsText(text) {
  var m = String(text).trim().match(/^\[?(\d{1,2})\s*[:.\s]\s*(\d{1,3})\s*[:.\s]\s*(\d{1,2})\]?$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function slotLabel(side, i) {
  if (side === 'def' && i === 0) return t('planet');
  return (side === 'att' ? t('attackerShort') : t('defenderShort')) + ' ' + (i + 1);
}

function slots(side) { return side === 'att' ? S.attackers : S.defenders; }

/* Universe values by hash key, for the share link. */
function uniHash() {
  var out = {};
  Object.keys(UNI_HASH).forEach(function (key) { if (U[key] !== undefined) out[UNI_HASH[key]] = Number(U[key]); });
  return out;
}

function persist() {
  store(LS_TABS, {active: TABS.indexOf(activeTab), tabs: TABS.map(function (tab) { return {name: tab.name, state: tab.state}; })});
  store(LS_UNI, Object.assign({}, load(LS_UNI) || {}, U));
}

/* ---------- tabs ---------- */

function newTab(state, name) {
  tabSeq += 1;
  return {id: 't' + tabSeq, name: name || null, state: state, last: null, stale: false};
}

function tabAutoName(tab) {
  return tab.state.target ? '→ ' + fmtCoords(tab.state.target) : t('tabSim', {n: TABS.indexOf(tab) + 1});
}

function renderCalcTabs() {
  var html = TABS.map(function (tab) {
    return '<div class="ctab' + (tab === activeTab ? ' active' : '') + '" data-tab="' + tab.id + '">'
      + '<button type="button" class="ctab-main" role="tab" aria-selected="' + (tab === activeTab) + '" title="' + esc(t('tabRename')) + '">'
      + '<span class="ctab-name"></span><span class="ctab-sum"></span></button>'
      + (TABS.length > 1 ? '<button type="button" class="ctab-close" aria-label="' + esc(t('tabClose')) + '" title="' + esc(t('tabClose')) + '">×</button>' : '')
      + '</div>';
  }).join('');
  if (TABS.length < MAX_TABS) {
    html += '<button type="button" class="ctab-add" id="addTab" title="' + esc(t('tabNew')) + '" aria-label="' + esc(t('tabNewAria')) + '">+</button>';
  }
  $('#calcTabs').innerHTML = html;
  updateCalcTabs();
}

/* Name and key result (the attacker's win chance) of each tab. */
function updateCalcTabs() {
  TABS.forEach(function (tab) {
    var el = $('#calcTabs [data-tab="' + tab.id + '"]');
    if (!el) return;
    var name = el.querySelector('.ctab-name');
    if (name) name.textContent = tab.name || tabAutoName(tab);
    var result = tab === activeTab ? last : tab.last;
    var running = job && job.tab === tab;
    el.querySelector('.ctab-sum').textContent = running ? t('tabRunning') : result ? t('tabSum', {n: pct(result.summary.wins.attacker)}) : '—';
  });
}

function switchTab(tab) {
  if (activeTab) {
    activeTab.last = last;
    activeTab.stale = stale;
  }
  activeTab = tab;
  S = tab.state;
  last = tab.last;
  stale = tab.stale;
  active = {att: 0, def: 0};
  spyMsg = null;
  $('#spyIn').value = '';
  renderCalcTabs();
  renderInputs();
  renderSpyHint();
  renderRun();
  renderResult();
  persist();
}

function addTab(state, name) {
  if (TABS.length >= MAX_TABS) {
    toast(t('tabsMax', {n: MAX_TABS}));
    return null;
  }
  var tab = newTab(state, name);
  TABS.splice(TABS.indexOf(activeTab) + 1, 0, tab);
  switchTab(tab);
  return tab;
}

function closeTab(tab) {
  if (TABS.length < 2) return;
  var index = TABS.indexOf(tab);
  if (job && job.tab === tab) cancel();
  TABS.splice(index, 1);
  closedTab = {tab: tab, index: index};
  if (tab === activeTab) {
    tab.last = last;
    tab.stale = stale;
    activeTab = null;
    switchTab(TABS[Math.min(index, TABS.length - 1)]);
  } else {
    renderCalcTabs();
    persist();
  }
  toast(t('tabClosed'), {label: t('undo'), fn: function () {
    if (!closedTab || TABS.length >= MAX_TABS) return;
    TABS.splice(Math.min(closedTab.index, TABS.length), 0, closedTab.tab);
    var restored = closedTab.tab;
    closedTab = null;
    switchTab(restored);
  }});
}

function startRename(tab) {
  var el = $('#calcTabs [data-tab="' + tab.id + '"] .ctab-name');
  if (!el) return;
  var input = document.createElement('input');
  input.className = 'ctab-rename';
  input.maxLength = 40;
  input.value = tab.name || tabAutoName(tab);
  input.setAttribute('aria-label', t('tabName'));
  el.replaceWith(input);
  input.focus();
  input.select();
  var done = false;
  function finish(save) {
    if (done) return;
    done = true;
    if (save) {
      var value = input.value.trim();
      tab.name = value && value !== tabAutoName(tab) ? value : null;
      persist();
    }
    renderCalcTabs();
  }
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', function () { finish(true); });
}

function bindCalcTabs() {
  var bar = $('#calcTabs');
  bar.addEventListener('click', function (e) {
    if (e.target.closest('#addTab')) {
      if (addTab(JSON.parse(JSON.stringify(S)), null)) toast(t('tabCopied'));
      return;
    }
    var box = e.target.closest('[data-tab]');
    if (!box || e.target.closest('.ctab-rename')) return;
    var tab = TABS.filter(function (x) { return x.id === box.dataset.tab; })[0];
    if (e.target.closest('.ctab-close')) closeTab(tab);
    else if (tab !== activeTab) switchTab(tab);
  });
  bar.addEventListener('dblclick', function (e) {
    var box = e.target.closest('[data-tab]');
    if (box && !e.target.closest('.ctab-close')) startRename(TABS.filter(function (x) { return x.id === box.dataset.tab; })[0]);
  });
}

/* Stored tabs, else the single state of the first version. */
function loadTabs() {
  var saved = load(LS_TABS);
  if (saved && Array.isArray(saved.tabs) && saved.tabs.length) {
    saved.tabs.slice(0, MAX_TABS).forEach(function (x) { TABS.push(newTab(cleanState(x.state), typeof x.name === 'string' ? x.name : null)); });
    activeTab = TABS[Math.min(Math.max(0, saved.active | 0), TABS.length - 1)];
    return true;
  }
  var legacy = load(LS_STATE);
  TABS.push(newTab(cleanState(legacy), null));
  activeTab = TABS[0];
  return !!legacy;
}

/* ---------- inputs ---------- */

function unitGrid(side, ids, units) {
  return '<div class="units">' + ids.map(function (id) {
    var n = units[id] || 0;
    return '<div class="unit' + (n ? ' has' : '') + '">'
      + '<label class="unit-name" for="u-' + side + '-' + id + '" title="' + esc(elementName(id, lang())) + '">' + esc(elementName(id, lang())) + '</label>'
      + '<input id="u-' + side + '-' + id + '" data-side="' + side + '" data-unit="' + id + '" type="text" inputmode="numeric" autocomplete="off" placeholder="0" value="' + (n ? num(n) : '') + '"></div>';
  }).join('') + '</div>';
}

function techFields(side, ids, research) {
  return ids.map(function (id) {
    return '<div class="field"><label for="r-' + side + '-' + id + '">' + esc(elementName(id, lang())) + '</label>'
      + '<input id="r-' + side + '-' + id + '" data-side="' + side + '" data-tech="' + id + '" type="number" min="0" inputmode="numeric" value="' + (research[id] || 0) + '"></div>';
  }).join('');
}

function renderTabs(side) {
  var list = slots(side);
  var html = list.map(function (s, i) {
    var has = Object.keys(s.units).some(function (id) { return s.units[id] > 0; });
    // the planet stays, the last attacking fleet too
    var removable = side === 'att' ? list.length > 1 : i > 0;
    return '<span class="slot-tab' + (i === active[side] ? ' on' : '') + (has ? ' has' : '') + '">'
      + '<button type="button" role="tab" class="slot-main" aria-selected="' + (i === active[side]) + '" data-slot-side="' + side + '" data-slot="' + i + '">' + esc(slotLabel(side, i)) + '</button>'
      + (removable ? '<button type="button" class="slot-x" data-remove-slot="' + side + '" data-index="' + i + '" title="' + esc(t('removeSlot')) + '" aria-label="' + esc(t('removeSlot')) + '">×</button>' : '')
      + '</span>';
  }).join('');
  if (list.length < MAX_SLOTS) {
    html += '<button type="button" class="slot-tab add" data-add-slot="' + side + '" title="' + esc(t(side === 'att' ? 'addAttacker' : 'addDefender')) + '">+</button>';
  }
  $('#' + side + 'Tabs').innerHTML = html;
}

function renderSlot(side) {
  var i = active[side];
  var s = slots(side)[i];
  var html = '';
  if (side === 'att') {
    html += '<div class="grid2"><div class="field"><label for="fromIn" data-t="from">' + esc(t('from')) + '</label>'
      + '<input id="fromIn" class="coord" data-side="att" data-from="1" type="text" inputmode="numeric" autocomplete="off" placeholder="1:234:5" value="' + fmtCoords(s.from) + '"></div>'
      + '<div class="field"><label for="speedIn">' + esc(t('speed')) + '</label><select id="speedIn" data-side="att" data-speed="1">'
      + SPEEDS.map(function (v) { return '<option value="' + v + '"' + (v === s.speed ? ' selected' : '') + '>' + v + ' %</option>'; }).join('') + '</select></div></div>';
    html += '<div class="grid3 techs">' + techFields(side, COMBAT_TECHS, s.research) + '</div>';
    html += '<div class="grid4 techs">' + techFields(side, DRIVE_TECHS, s.research) + '</div>';
    html += '<div class="field"><span class="field-label">' + esc(t('ships')) + '</span>' + unitGrid(side, SHIP_IDS.filter(function (id) { return id !== 212; }), s.units) + '</div>';
  } else {
    if (i === 0) {
      html += '<div class="field"><label for="targetIn">' + esc(t('target')) + '</label>'
        + '<input id="targetIn" class="coord" data-target="1" type="text" inputmode="numeric" autocomplete="off" placeholder="1:234:5" value="' + fmtCoords(S.target) + '"></div>';
      html += '<div class="grid3">' + ['metal', 'crystal', 'deuterium'].map(function (r) {
        return '<div class="field"><label for="res-' + r + '">' + esc(t(r)) + '</label><input id="res-' + r + '" data-res="' + r + '" type="text" inputmode="numeric" autocomplete="off" placeholder="0" value="' + (S.resources[r] ? num(S.resources[r]) : '') + '"></div>';
      }).join('') + '</div>';
    }
    html += '<div class="grid3 techs">' + techFields(side, COMBAT_TECHS, s.research) + '</div>';
    // the solar satellite only defends: after the ships
    var ships = SHIP_IDS.filter(function (id) { return id !== 212; }).concat([212]);
    html += '<div class="field"><span class="field-label">' + esc(t('ships')) + '</span>' + unitGrid(side, ships, s.units) + '</div>';
    if (i === 0) html += '<div class="field"><span class="field-label">' + esc(t('defense')) + '</span>' + unitGrid(side, DEFENSE_IDS, s.units) + '</div>';
  }
  $('#' + side + 'Slot').innerHTML = html;
}

function renderInputs() {
  ['att', 'def'].forEach(function (side) {
    active[side] = Math.min(active[side], slots(side).length - 1);
    renderTabs(side);
    renderSlot(side);
  });
  if (document.activeElement !== $('#runsIn')) $('#runsIn').value = String(S.runs);
}

/* ---------- universe settings ---------- */

function buildUniDialog() {
  $('#uniFields').innerHTML = fieldsetsHtml(uniFieldGroups(['groupBattle', 'groupSpeed', 'groupLayout', 'groupDistances'], ['expo_hold_multiplier']));
}

function syncUniSummary() {
  $('#uniSummary').textContent = uniSummary(U) + ' · ' + t('uniDebris', {fleet: U.fleet_debris, def: U.defense_debris});
}

/* ---------- running ---------- */

function newWorker() {
  worker = new Worker(new URL('./worker.js', import.meta.url), {type: 'module'});
  worker.onmessage = function (e) {
    var msg = e.data;
    if (!job || msg.id !== job.id) return;
    if (msg.type === 'progress') {
      setProgress(msg.done / job.runs);
    } else if (msg.type === 'done') {
      var result = {summary: msg.summary, slots: job.slots, setup: job.setup};
      var tab = job.tab;
      job = null;
      if (tab === activeTab) {
        last = result;
        stale = false;
        renderResult();
      } else {
        tab.last = result;
        tab.stale = false;
      }
      renderRun();
      updateCalcTabs();
    } else {
      job = null;
      renderRun();
      updateCalcTabs();
      toast(t('runError', {error: msg.message}));
    }
  };
}

function run() {
  var setup = battleSetup(S);
  if (!setup.attackers.length) { toast(t('noAttackers')); return; }
  // one simulation at a time: a new one replaces a running one (of any tab)
  if (job) cancel();
  if (!worker) newWorker();
  job = {id: Date.now() + Math.random(), runs: S.runs, slots: fightingSlots(S), setup: setup, tab: activeTab};
  worker.postMessage({id: job.id, setup: setup, runs: S.runs, settings: simSettings(U)});
  setProgress(0);
  renderRun();
  updateCalcTabs();
}

function cancel() {
  if (worker) worker.terminate();
  worker = null;
  job = null;
  renderRun();
  updateCalcTabs();
}

function setProgress(share) {
  $('#progressBar').style.width = Math.round(share * 100) + '%';
}

function renderRun() {
  var running = !!job && job.tab === activeTab;
  $('#runBtn').hidden = running;
  $('#cancelBtn').hidden = !running;
  $('#progress').hidden = !running;
  $('#results').classList.toggle('stale', stale && !!last);
  $('#staleNote').hidden = !(stale && last && !running);
}

/* ---------- result ---------- */

function lossRows(side, fleets, slotIdx, initial) {
  var rows = '';
  fleets.forEach(function (f, k) {
    var slot = slotIdx[k];
    var units = initial[k].units;
    Object.keys(units).filter(function (id) { return units[id] > 0; }).map(Number).sort(function (a, b) { return a - b; }).forEach(function (id) {
      var lost = f.lost[id] || {avg: 0, min: 0, max: 0};
      var rep = f.repaired[id];
      var left = f.remaining[id] || {avg: 0};
      rows += '<tr class="' + (left.avg > 0 ? '' : 'gone') + '"><td class="name">' + esc(elementName(id, lang())) + '<span class="slot-tag">' + esc(slotLabel(side, slot)) + '</span></td>'
        + '<td>' + num(units[id]) + '</td><td class="' + (lost.avg ? 'neg' : 'dim') + '">' + avgRange(lost) + '</td>'
        + '<td>' + (rep ? avgRange(rep) : '') + '</td><td>' + num(left.avg) + '</td></tr>';
    });
  });
  return rows;
}

function lossTable(side, fleets, slotIdx, initial) {
  var head = '<tr>' + ['colUnit', 'colCount', 'colLost', 'colRebuilt', 'colLeft'].map(function (h) { return '<th>' + esc(t(h)) + '</th>'; }).join('') + '</tr>';
  return '<div class="table-wrap"><table><thead>' + head + '</thead><tbody>' + lossRows(side, fleets, slotIdx, initial) + '</tbody></table></div>';
}

/* Rounds of the typical run: per round and side the units with their amount, losses and stunned ones. */
function reportHtml(output, slotIdx) {
  var html = '';
  output.rounds.forEach(function (round, r) {
    html += '<div class="round"><h4>' + esc(r === 0 ? t('roundStart') : t('round', {n: r})) + '</h4><div class="round-sides">';
    ['attacker', 'defender'].forEach(function (key) {
      var side = key === 'attacker' ? 'att' : 'def';
      var idx = side === 'att' ? slotIdx.attackers : slotIdx.defenders;
      var lines = [];
      Object.keys(round[key].Roundstats).forEach(function (fleet) {
        var units = round[key].Roundstats[fleet];
        var parts = Object.keys(units).map(function (id) {
          var u = units[id];
          return esc(elementName(Number(id), lang(), true)) + ' ' + num(u.amount)
            + (u.lost ? ' <span class="neg">−' + num(u.lost) + '</span>' : '')
            + (u.stunned ? ' <span class="stun" title="' + esc(t('stunnedTitle')) + '">⚡' + num(u.stunned) + '</span>' : '');
        });
        lines.push('<div><span class="slot-tag">' + esc(slotLabel(side, idx[Number(fleet)])) + '</span> ' + (parts.join(' · ') || '–') + '</div>');
      });
      var stats = round[key].Statistics;
      var sum = function (k) { return stats && stats[k] ? stats[k].sum : 0; };
      if (r > 0) {
        lines.push('<div class="round-stats">' + esc(t('roundStats', {damage: short(sum('damage_done')), shield: short(sum('shield_hit')), stunned: num(sum('stunned_done'))})) + '</div>');
      }
      html += '<div class="round-side"><strong>' + esc(t(key)) + '</strong>' + lines.join('') + '</div>';
    });
    html += '</div></div>';
  });
  return html;
}

function renderResult() {
  var box = $('#resultBody');
  if (!last) {
    $('#outcome').innerHTML = '';
    box.innerHTML = '<p class="empty">' + esc(t('noResult')) + '</p>';
    return;
  }
  var s = last.summary;
  var debris = s.debris.metal.avg + s.debris.crystal.avg;
  var flights = S.attackers.map(function (slot, i) { return {i: i, f: slotFlight(S, slot, U)}; }).filter(function (x) { return x.f; });
  var fuel = flights.reduce(function (sum, x) { return sum + x.f.consumption; }, 0);
  var debrisTo = S.debrisTo || defaultDebrisTo(s);

  /* outcome: win chances, runs and rounds */
  $('#outcome').innerHTML = '<div class="win att"><b>' + pct(s.wins.attacker) + '</b><span>' + esc(t('attackerWins')) + '</span></div>'
    + '<div class="win draw"><b>' + pct(s.wins.draw) + '</b><span>' + esc(t('draw')) + '</span></div>'
    + '<div class="win def"><b>' + pct(s.wins.defender) + '</b><span>' + esc(t('defenderWins')) + '</span></div>'
    + '<span class="outcome-meta">' + esc(t('runsSub', {n: num(s.runs), rounds: Math.round(s.rounds.avg * 10) / 10})) + '</span>';
  var html = '';

  /* balance per side: losses, loot, fuel and debris in resources and DSE */
  html += '<div class="debris-to"><span>' + esc(t('debrisTo')) + '</span><div class="seg small" role="group">'
    + ['attacker', 'defender'].map(function (side) {
      return '<button type="button" data-debris-to="' + side + '" class="' + (side === debrisTo ? 'active' : '') + '" aria-pressed="' + (side === debrisTo) + '">' + esc(t(side)) + '</button>';
    }).join('') + '</div></div>';
  var rows = balance(s, debrisTo, {metal: Number(U.rate_metal), crystal: Number(U.rate_crystal)}, fuel);
  html += '<div class="balances">' + ['attacker', 'defender'].map(function (side) {
    return '<div class="table-wrap balance"><table><thead><tr><th>' + esc(t(side)) + '</th>'
      + ['metal', 'crystal', 'deuterium', 'dse'].map(function (k) { return '<th>' + esc(t(k)) + '</th>'; }).join('') + '</tr></thead><tbody>'
      + rows[side].map(function (r) {
        var cell = function (v) {
          var cls = r.key === 'net' ? (Math.round(v) > 0 ? 'pos net-pos' : Math.round(v) < 0 ? 'neg net-neg' : 'dim') : (Math.round(v) > 0 ? 'pos' : Math.round(v) < 0 ? 'neg' : 'dim');
          return '<td class="' + cls + '">' + signed(v) + '</td>';
        };
        return '<tr class="b-' + r.key + '"><td class="name">' + esc(t('balance_' + r.key)) + '</td>' + cell(r.metal) + cell(r.crystal) + cell(r.deuterium) + cell(r.dse) + '</tr>';
      }).join('') + '</tbody></table></div>';
  }).join('') + '</div>';

  html += '<div class="hero">'
    + kpi(t('debris'), short(debris), t('debrisSub', {m: short(s.debris.metal.avg), k: short(s.debris.crystal.avg), n: num(Math.ceil(debris / RECYCLER))}))
    + kpi(t('moonChance'), Math.round(s.moonChance.avg * 10) / 10 + ' %', s.moonChance.min !== s.moonChance.max ? s.moonChance.min + '–' + s.moonChance.max + ' %' : '')
    + '</div>';

  html += '<div class="balances">'
    + '<div><h3 class="sub-title">' + esc(t('attackers')) + '</h3>' + lossTable('att', s.attackers, last.slots.attackers, last.setup.attackers) + '</div>'
    + '<div><h3 class="sub-title">' + esc(t('defenders')) + '</h3>' + lossTable('def', s.defenders, last.slots.defenders, last.setup.defenders) + '</div></div>';

  if (flights.length) {
    html += '<h3 class="sub-title">' + esc(t('flights')) + '</h3><div class="table-wrap"><table><thead><tr>'
      + ['colSlot', 'colDistance', 'colDuration', 'colFuel'].map(function (h) { return '<th>' + esc(t(h)) + '</th>'; }).join('') + '</tr></thead><tbody>'
      + flights.map(function (x) {
        return '<tr><td class="name">' + esc(slotLabel('att', x.i)) + ' · ' + S.attackers[x.i].speed + ' %</td><td>' + num(x.f.distance) + '</td>'
          + '<td class="mono">' + fmtDur(x.f.duration) + '</td><td>' + num(x.f.consumption) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  html += '<details class="report"><summary>' + esc(t('report')) + '</summary><p class="hint">' + esc(t('reportHint')) + '</p>'
    + reportHtml(s.typical.output, last.slots) + '</details>';
  box.innerHTML = html;
}

function renderSpyHint() {
  var hint = $('#spyHint');
  if (!spyMsg) { hint.hidden = true; return; }
  hint.hidden = false;
  hint.className = 'hint ' + (spyMsg.ok ? 'ok' : 'err');
  if (!spyMsg.ok) { hint.textContent = t('spyNone'); return; }
  var parts = [];
  ['resources', 'fleet', 'defense', 'research'].forEach(function (k) { if (spyMsg[k]) parts.push(t('spy_' + k)); });
  hint.textContent = t('spyOk', {coords: fmtCoords(spyMsg.coords), moon: spyMsg.moon ? t('spyMoon') : '', parts: parts.join(', ') || '–'});
}

/* Inputs changed: keep the result, mark it as outdated. */
function update() {
  persist();
  if (last) stale = true;
  renderRun();
  updateCalcTabs();
}

/* ---------- events ---------- */

function slotOf(el) { return slots(el.dataset.side)[active[el.dataset.side]]; }

function bind() {
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset.unit) {
      var n = parseAmount(el.value);
      el.classList.toggle('invalid', isNaN(n));
      var units = slotOf(el).units;
      if (!isNaN(n) && n > 0) units[el.dataset.unit] = n;
      else delete units[el.dataset.unit];
      el.closest('.unit').classList.toggle('has', !isNaN(n) && n > 0);
      renderTabs(el.dataset.side);
      update();
    } else if (el.dataset.tech) {
      slotOf(el).research[el.dataset.tech] = Math.max(0, Math.min(99, parseInt(el.value, 10) || 0));
      update();
    } else if (el.dataset.res) {
      var r = parseAmount(el.value);
      el.classList.toggle('invalid', isNaN(r));
      S.resources[el.dataset.res] = isNaN(r) ? 0 : r;
      update();
    } else if (el.dataset.from || el.dataset.target) {
      var c = parseCoordsText(el.value);
      el.classList.toggle('invalid', !!el.value.trim() && !c);
      if (el.dataset.from) slotOf(el).from = c;
      else S.target = c;
      update();
    } else if (el.dataset.uni) {
      var v = parseFloat(el.value);
      if (!isNaN(v)) { U[el.dataset.uni] = v; syncUniSummary(); update(); }
    }
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.dataset.speed) { slotOf(el).speed = Number(el.value) || 100; update(); }
    else if (el.dataset.uni) { U[el.dataset.uni] = parseFloat(el.value) || 0; syncUniSummary(); update(); }
  });
  document.addEventListener('focusout', function (e) {
    var el = e.target;
    if (el.dataset && el.dataset.unit) {
      var n = slotOf(el).units[el.dataset.unit];
      el.value = n ? num(n) : '';
      el.classList.remove('invalid');
    } else if (el.dataset && el.dataset.res) {
      el.value = S.resources[el.dataset.res] ? num(S.resources[el.dataset.res]) : '';
      el.classList.remove('invalid');
    }
  });
  document.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-slot]');
    if (tab) {
      active[tab.dataset.slotSide] = Number(tab.dataset.slot);
      renderTabs(tab.dataset.slotSide);
      renderSlot(tab.dataset.slotSide);
      return;
    }
    var add = e.target.closest('[data-add-slot]');
    if (add) {
      var side = add.dataset.addSlot;
      var list = slots(side);
      var slot = emptySlot();
      // a new attacker starts with the research of the selected one (often the same player)
      if (side === 'att') slot.research = Object.assign({}, list[active.att].research);
      list.push(slot);
      active[side] = list.length - 1;
      renderTabs(side);
      renderSlot(side);
      update();
      return;
    }
    var to = e.target.closest('[data-debris-to]');
    if (to) {
      S.debrisTo = to.dataset.debrisTo;
      persist();
      renderResult();
      return;
    }
    var remove = e.target.closest('[data-remove-slot]');
    if (remove) {
      var rs = remove.dataset.removeSlot;
      var index = Number(remove.dataset.index);
      if (!window.confirm(t('removeSlotConfirm', {slot: slotLabel(rs, index)}))) return;
      slots(rs).splice(index, 1);
      if (!slots(rs).length) slots(rs).push(emptySlot());
      if (active[rs] >= index) active[rs] = Math.max(0, active[rs] - 1);
      renderTabs(rs);
      renderSlot(rs);
      update();
    }
  });
  $('#runsIn').max = String(MAX_RUNS);
  $('#runsIn').addEventListener('input', function () {
    var n = Number($('#runsIn').value);
    var ok = Number.isInteger(n) && n >= 1 && n <= MAX_RUNS;
    $('#runsIn').classList.toggle('invalid', !ok);
    if (ok) { S.runs = n; persist(); }
  });
  $('#runsIn').addEventListener('blur', function () { $('#runsIn').value = String(S.runs); $('#runsIn').classList.remove('invalid'); });
  $('#runBtn').addEventListener('click', run);
  // Enter in a field of the battle starts the simulation
  $('main.layout').addEventListener('keydown', function (e) {
    var el = e.target;
    if (e.key !== 'Enter' || e.isComposing || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON') return;
    if (el.tagName !== 'INPUT' && el.tagName !== 'SELECT') return;
    e.preventDefault();
    run();
  });
  $('#cancelBtn').addEventListener('click', cancel);
  $('#spyIn').addEventListener('input', function () {
    var text = $('#spyIn').value;
    if (!text.trim()) { spyMsg = null; renderSpyHint(); return; }
    spyMsg = applySpyReport(S, text);
    renderSpyHint();
    if (spyMsg.ok) {
      active.def = 0;
      renderInputs();
      update();
      // taken over: back to the battle, the hint as a toast
      toast($('#spyHint').textContent);
      $('#spyIn').value = '';
      spyMsg = null;
      renderSpyHint();
      $('#spyDialog').close();
    }
  });
  /* the "⋯" menus of both sides: reset all fleets of the side, paste a spy report (defender) */
  var closeMenus = function () {
    $$('.menu-wrap .menu').forEach(function (menu) { menu.hidden = true; });
    $$('[data-menu]').forEach(function (btn) { btn.setAttribute('aria-expanded', 'false'); });
  };
  $$('[data-menu]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var menu = $('#' + btn.dataset.menu);
      var open = menu.hidden;
      closeMenus();
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.menu-wrap')) closeMenus(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenus(); });
  $$('.menu-wrap .menu').forEach(function (menu) {
    menu.addEventListener('click', function (e) {
      var item = e.target.closest('[data-menu-action]');
      if (!item) return;
      closeMenus();
      var side = item.dataset.side;
      if (item.dataset.menuAction === 'spy') {
        spyMsg = null;
        renderSpyHint();
        openDialog($('#spyDialog'));
        $('#spyIn').focus();
        return;
      }
      var action = item.dataset.menuAction;
      if (!window.confirm(t(action + (side === 'att' ? 'AttackersConfirm' : 'DefendersConfirm')))) return;
      if (action === 'remove') {
        // all fleets go, one empty slot (the planet) stays
        if (side === 'att') S.attackers = [emptySlot()];
        else S.defenders = [emptySlot()];
        active[side] = 0;
      } else {
        // the fleets stay with research, start and speed, only their units are cleared
        slots(side).forEach(function (x) { x.units = {}; });
      }
      renderInputs();
      update();
    });
  });
  $('#spyDialog').addEventListener('click', function (e) { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('#resetBtn').addEventListener('click', function () {
    if (!window.confirm(t('resetConfirm'))) return;
    S = emptyState();
    activeTab.state = S;
    active = {att: 0, def: 0};
    spyMsg = null;
    last = null;
    stale = false;
    $('#spyIn').value = '';
    renderInputs();
    renderSpyHint();
    renderResult();
    update();
  });
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#uniChip').addEventListener('click', openSettings);
  $('#settings').addEventListener('click', function (e) { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('#settings').addEventListener('close', function () { if (last) renderResult(); });
  $('#uniReset').addEventListener('click', function () {
    U = Object.assign({}, U, DEFAULT_UNI, BATTLE_LAYOUT_DEFAULTS, BATTLE_UNI_DEFAULTS, {clock_offset: U.clock_offset || 0});
    syncUniInputs(U);
    syncUniSummary();
    update();
    toast(t('uniReset'));
  });
  bindShare(function () { return location.origin + location.pathname + '#' + encodeShare(shareFromState(S, uniHash())); });
  bindLang(function () {
    renderCalcTabs();
    buildUniDialog();
    syncUniSummary();
    renderInputs();
    renderSpyHint();
    renderResult();
  });
  window.addEventListener('hashchange', function () {
    var state = linkState();
    if (state && addTab(state, null)) { toast(t('linkNewTab')); run(); }
  });
}

function openSettings() {
  syncUniInputs(U);
  openDialog($('#settings'));
}

/* The battle of a link (from the hub or a shared one), null without one; sets the universe values it carries. */
function linkState() {
  var hash = location.hash.replace(/^#/, '');
  if (!hash) return null;
  var share = decodeShare(hash);
  if (!share.attackers.length && !share.defenders.length) return null;
  Object.keys(UNI_HASH).forEach(function (key) {
    if (share.uni[UNI_HASH[key]] !== undefined) U[key] = share.uni[UNI_HASH[key]];
  });
  clearHash();
  syncUniSummary();
  return stateFromShare(share);
}

function init() {
  initTexts(TEXTS);
  applyTexts();
  U = Object.assign({}, DEFAULT_UNI, BATTLE_LAYOUT_DEFAULTS, BATTLE_UNI_DEFAULTS, load(LS_UNI) || {});
  var hadState = loadTabs();
  var fromLink = linkState();
  // a link opens in a new tab next to the stored ones (or fills the first one)
  if (fromLink) {
    if (hadState && TABS.length < MAX_TABS) {
      var tab = newTab(fromLink, null);
      TABS.splice(TABS.indexOf(activeTab) + 1, 0, tab);
      activeTab = tab;
    } else {
      activeTab.state = fromLink;
    }
  }
  S = activeTab.state;
  buildUniDialog();
  syncUniSummary();
  bind();
  bindCalcTabs();
  bindTips();
  renderCalcTabs();
  renderInputs();
  renderRun();
  renderResult();
  persist();
  if (fromLink) {
    toast(t(hadState ? 'linkNewTab' : 'linkLoaded'));
    run();
  }
}

init();
