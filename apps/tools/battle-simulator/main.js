/* Battle simulator UI. The battles run in ./worker.js on Battlerust (@pr0hub/battle), glue in ../src/battle.ts. */
import { decodeShare, encodeShare } from '@pr0hub/battle';
import {
  COMBAT_TECHS,
  DEFENSE_IDS,
  DRIVE_TECHS,
  MAX_SLOTS,
  RUN_CHOICES,
  SHIP_IDS,
  applySpyReport,
  battleSetup,
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
import { BATTLE_UNI_DEFAULTS, LS_UNI, UNI_HASH, fieldsetsHtml, openDialog, syncUniInputs, uniFieldGroups, uniSummary } from '../shared/uni.js';

var LS_STATE = 'pr0bs.state.v1';
var SPEEDS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
/* recycler capacity for the debris field */
var RECYCLER = 20000;

var S = emptyState();
var U = Object.assign({}, DEFAULT_UNI, BATTLE_UNI_DEFAULTS);
/* selected slot per side */
var active = {att: 0, def: 0};
var spyMsg = null;
/* running job, last result and whether the inputs changed since */
var worker = null;
var job = null;
var last = null;
var stale = false;

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
  store(LS_STATE, S);
  store(LS_UNI, Object.assign({}, load(LS_UNI) || {}, U));
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
    return '<button type="button" role="tab" class="slot-tab' + (i === active[side] ? ' on' : '') + (has ? ' has' : '') + '" data-slot-side="' + side + '" data-slot="' + i + '">' + esc(slotLabel(side, i)) + '</button>';
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
    html += '<div class="field"><span class="field-label">' + esc(t('ships')) + '</span>' + unitGrid(side, SHIP_IDS, s.units) + '</div>';
    if (i === 0) html += '<div class="field"><span class="field-label">' + esc(t('defense')) + '</span>' + unitGrid(side, DEFENSE_IDS, s.units) + '</div>';
  }
  html += '<div class="slot-actions"><button type="button" class="link-btn" data-clear-slot="' + side + '">' + esc(t('clearSlot')) + '</button>'
    + (i > 0 || slots(side).length > 1 ? '<button type="button" class="link-btn danger" data-remove-slot="' + side + '">' + esc(t('removeSlot')) + '</button>' : '') + '</div>';
  $('#' + side + 'Slot').innerHTML = html;
}

function renderInputs() {
  ['att', 'def'].forEach(function (side) {
    active[side] = Math.min(active[side], slots(side).length - 1);
    renderTabs(side);
    renderSlot(side);
  });
  $('#runsIn').value = String(S.runs);
}

/* ---------- universe settings ---------- */

function buildUniDialog() {
  $('#uniFields').innerHTML = fieldsetsHtml(uniFieldGroups(['groupBattle', 'groupSpeed', 'groupLayout', 'groupDistances']));
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
      last = {summary: msg.summary, slots: job.slots, setup: job.setup};
      stale = false;
      job = null;
      renderRun();
      renderResult();
    } else {
      job = null;
      renderRun();
      toast(t('runError', {error: msg.message}));
    }
  };
}

function run() {
  var setup = battleSetup(S);
  if (!setup.attackers.length) { toast(t('noAttackers')); return; }
  if (!worker) newWorker();
  job = {id: Date.now() + Math.random(), runs: S.runs, slots: fightingSlots(S), setup: setup};
  worker.postMessage({id: job.id, setup: setup, runs: S.runs, settings: simSettings(U)});
  setProgress(0);
  renderRun();
}

function cancel() {
  if (worker) worker.terminate();
  worker = null;
  job = null;
  renderRun();
}

function setProgress(share) {
  $('#progressBar').style.width = Math.round(share * 100) + '%';
}

function renderRun() {
  var running = !!job;
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
    box.innerHTML = '<p class="empty">' + esc(t('noResult')) + '</p>';
    return;
  }
  var s = last.summary;
  var debris = s.debris.metal.avg + s.debris.crystal.avg;
  var loot = s.loot.metal + s.loot.crystal + s.loot.deuterium;
  var html = '<div class="hero">'
    + kpi(t('attackerWins'), pct(s.wins.attacker), t('drawSub', {n: pct(s.wins.draw)}), 'big ' + (s.wins.attacker >= 0.5 ? 'pos' : ''))
    + kpi(t('defenderWins'), pct(s.wins.defender), t('runsSub', {n: s.runs, rounds: Math.round(s.rounds.avg * 10) / 10}), 'big')
    + kpi(t('lostAttacker'), short(s.lostValue.attacker.avg), t('unitsValue'))
    + kpi(t('lostDefender'), short(s.lostValue.defender.avg), t('unitsValue'))
    + kpi(t('debris'), short(debris), t('debrisSub', {m: short(s.debris.metal.avg), k: short(s.debris.crystal.avg), n: num(Math.ceil(debris / RECYCLER))}))
    + kpi(t('loot'), short(loot), t('lootSub', {m: short(s.loot.metal), k: short(s.loot.crystal), d: short(s.loot.deuterium)}))
    + kpi(t('moonChance'), Math.round(s.moonChance.avg * 10) / 10 + ' %', s.moonChance.min !== s.moonChance.max ? s.moonChance.min + '–' + s.moonChance.max + ' %' : '')
    + '</div>';

  html += '<h3 class="sub-title">' + esc(t('attackers')) + '</h3>' + lossTable('att', s.attackers, last.slots.attackers, last.setup.attackers);
  html += '<h3 class="sub-title">' + esc(t('defenders')) + '</h3>' + lossTable('def', s.defenders, last.slots.defenders, last.setup.defenders);

  var flights = S.attackers.map(function (slot, i) { return {i: i, f: slotFlight(S, slot, U)}; }).filter(function (x) { return x.f; });
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
    var clear = e.target.closest('[data-clear-slot]');
    if (clear) {
      var cs = slots(clear.dataset.clearSlot)[active[clear.dataset.clearSlot]];
      cs.units = {};
      renderTabs(clear.dataset.clearSlot);
      renderSlot(clear.dataset.clearSlot);
      update();
      return;
    }
    var remove = e.target.closest('[data-remove-slot]');
    if (remove) {
      var rs = remove.dataset.removeSlot;
      slots(rs).splice(active[rs], 1);
      if (!slots(rs).length) slots(rs).push(emptySlot());
      active[rs] = Math.max(0, active[rs] - 1);
      renderTabs(rs);
      renderSlot(rs);
      update();
    }
  });
  $('#runsIn').innerHTML = RUN_CHOICES.map(function (n) { return '<option value="' + n + '">' + n + '</option>'; }).join('');
  $('#runsIn').addEventListener('change', function () { S.runs = Number($('#runsIn').value); persist(); });
  $('#runBtn').addEventListener('click', run);
  $('#cancelBtn').addEventListener('click', cancel);
  $('#spyIn').addEventListener('input', function () {
    var text = $('#spyIn').value;
    if (!text.trim()) { spyMsg = null; renderSpyHint(); return; }
    spyMsg = applySpyReport(S, text);
    if (spyMsg.ok) {
      active.def = 0;
      renderInputs();
      update();
    }
    renderSpyHint();
  });
  $('#resetBtn').addEventListener('click', function () {
    if (!window.confirm(t('resetConfirm'))) return;
    S = emptyState();
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
    U = Object.assign({}, U, DEFAULT_UNI, BATTLE_UNI_DEFAULTS, {clock_offset: U.clock_offset || 0});
    syncUniInputs(U);
    syncUniSummary();
    update();
    toast(t('uniReset'));
  });
  bindShare(function () { return location.origin + location.pathname + '#' + encodeShare(shareFromState(S, uniHash())); });
  bindLang(function () {
    buildUniDialog();
    syncUniSummary();
    renderInputs();
    renderSpyHint();
    renderResult();
  });
  window.addEventListener('hashchange', function () {
    if (loadHash()) { renderInputs(); update(); toast(t('linkLoaded')); run(); }
  });
}

function openSettings() {
  syncUniInputs(U);
  openDialog($('#settings'));
}

/* A link (from the hub or a shared one) replaces the inputs and sets the universe values it carries. */
function loadHash() {
  var hash = location.hash.replace(/^#/, '');
  if (!hash) return false;
  var share = decodeShare(hash);
  if (!share.attackers.length && !share.defenders.length) return false;
  S = stateFromShare(share);
  Object.keys(UNI_HASH).forEach(function (key) {
    if (share.uni[UNI_HASH[key]] !== undefined) U[key] = share.uni[UNI_HASH[key]];
  });
  active = {att: 0, def: 0};
  last = null;
  stale = false;
  clearHash();
  syncUniSummary();
  return true;
}

function init() {
  initTexts(TEXTS);
  applyTexts();
  U = Object.assign({}, DEFAULT_UNI, BATTLE_UNI_DEFAULTS, load(LS_UNI) || {});
  S = cleanState(load(LS_STATE));
  var fromLink = loadHash();
  buildUniDialog();
  syncUniSummary();
  bind();
  bindTips();
  renderInputs();
  renderRun();
  renderResult();
  persist();
  if (fromLink) {
    toast(t('linkLoaded'));
    run();
  }
}

init();
