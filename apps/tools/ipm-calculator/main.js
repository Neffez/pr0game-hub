/* Interplanetary missile calculator UI. Calculation lives in @pr0hub/flight, glue in ../src/missile.ts. */
import {
  MISSILE_COST,
  MISSILE_TARGET_IDS,
  PRIMARY_TARGET_IDS,
  applyHash,
  applySpyReport,
  calculate,
  cleanState,
  elementName,
  emptyState,
  encodeHash,
  fmtCoordsText,
  missileDamage,
  parseCoordsText,
  structurePoints,
} from '../src/missile.ts';
import { parseAmount } from '../src/core.ts';
import { TEXTS } from './i18n.js';
import { $, $$, applyTexts, bindLang, bindShare, bindTips, clearHash, esc, fmtNum, initTexts, lang, load, store, t, toast } from '../shared/shell.js';

var LS_STATE = 'pr0ipm.state.v1';

var S = emptyState();
/* result of the last pasted spy report, shown under the text field */
var spyMsg = null;

/* ---------- helpers ---------- */

function num(n) { return fmtNum(n || 0); }

function pad(n) { return n < 10 ? '0' + n : String(n); }

function fmtDur(seconds) {
  seconds = Math.max(0, Math.round(seconds));
  var days = Math.floor(seconds / 86400);
  var rest = seconds % 86400;
  var clock = pad(Math.floor(rest / 3600)) + ':' + pad(Math.floor((rest % 3600) / 60)) + ':' + pad(rest % 60);
  return days > 0 ? days + 'd ' + clock : clock;
}

/* Short amounts for the resource lines: 1,2 Mio / 633k. */
function short(n) {
  var a = Math.abs(n);
  var dec = function (v) { return lang() === 'de' ? String(v).replace('.', ',') : String(v); };
  if (a >= 1e9) return dec(Math.round(n / 1e8) / 10) + (lang() === 'de' ? ' Mrd' : 'B');
  if (a >= 1e6) return dec(Math.round(n / 1e5) / 10) + (lang() === 'de' ? ' Mio' : 'M');
  if (a >= 1e4) return Math.round(n / 1e3) + 'k';
  return num(n);
}

function resources(r) {
  return t('resources', {m: short(r.m), k: short(r.k), d: short(r.d)});
}

function kpi(label, value, sub, cls) {
  return '<div class="kpi ' + (cls || '') + '"><span class="kpi-label">' + esc(label) + '</span>'
    + '<span class="kpi-value">' + esc(value) + '</span>'
    + (sub ? '<span class="kpi-sub">' + esc(sub) + '</span>' : '') + '</div>';
}

function persist() { store(LS_STATE, S); }

/* ---------- inputs ---------- */

function buildDefense() {
  $('#defGrid').innerHTML = MISSILE_TARGET_IDS.map(function (id) {
    return '<div class="def" data-def-box="' + id + '">'
      + '<label class="def-name" for="def-' + id + '" title="' + esc(elementName(id, lang())) + '"><strong>' + esc(elementName(id, lang())) + '</strong><span></span></label>'
      + '<input id="def-' + id + '" data-def="' + id + '" type="text" inputmode="numeric" autocomplete="off" placeholder="0"></div>';
  }).join('');
  $('#primaryIn').innerHTML = '<option value="0">' + esc(t('primaryNone')) + '</option>' + PRIMARY_TARGET_IDS.map(function (id) {
    return '<option value="' + id + '">' + esc(elementName(id, lang())) + '</option>';
  }).join('');
}

/* Writes the state into all inputs (except the focused one, to keep what is being typed). */
function syncInputs() {
  var set = function (el, value) { if (document.activeElement !== el) { el.value = value; el.classList.remove('invalid'); } };
  set($('#startIn'), fmtCoordsText(S.start));
  set($('#targetIn'), fmtCoordsText(S.target));
  $('#moonIn').checked = S.moon;
  $$('[data-num]').forEach(function (el) { set(el, S[el.dataset.num]); });
  $$('[data-amount]').forEach(function (el) { set(el, S[el.dataset.amount] ? num(S[el.dataset.amount]) : ''); });
  $$('[data-def]').forEach(function (el) { var n = S.defense[el.dataset.def]; set(el, n ? num(n) : ''); });
  $$('[data-uni]').forEach(function (el) { set(el, S.uni[el.dataset.uni]); });
  $('#primaryIn').value = String(PRIMARY_TARGET_IDS.indexOf(S.primary) !== -1 ? S.primary : 0);
}

/* ---------- render ---------- */

function renderSpyHint() {
  var hint = $('#spyHint');
  if (!spyMsg) { hint.hidden = true; return; }
  hint.hidden = false;
  hint.className = 'hint ' + (spyMsg.ok ? 'ok' : 'err');
  if (!spyMsg.ok) { hint.textContent = t('spyNone'); return; }
  var parts = [spyMsg.defense ? t('spyDefense') : t('spyNoDefense')];
  if (spyMsg.armor) parts.push(t('spyArmor'));
  if (spyMsg.interceptors) parts.push(t('spyInterceptors'));
  hint.textContent = t('spyOk', {coords: fmtCoordsText(spyMsg.coords), moon: spyMsg.moon ? t('spyMoon') : '', parts: parts.join(', ')})
    + (spyMsg.moon ? ' · ' + t('spyMoonHint') : '');
}

function render() {
  var r = calculate(S);
  $('#routeMeta').textContent = t('rangeSub', {n: r.range});
  $('#interceptorsLbl').textContent = t(S.moon ? 'interceptorsMoon' : 'interceptors');
  var shape = [t('uniLinear'), t('uniRing'), t('uniSphere')][S.uni.galaxyType];
  $('#uniMeta').textContent = '· ' + S.uni.systems + ' · ' + shape + ' · ×' + S.uni.speed;

  /* defense grid: structure points, primary target marked */
  MISSILE_TARGET_IDS.forEach(function (id) {
    var box = $('[data-def-box="' + id + '"]');
    var row = r.rows.filter(function (x) { return x.id === id; })[0];
    box.classList.toggle('has', !!row);
    box.classList.toggle('primary', !!row && S.primary === id);
    box.querySelector('.def-name span').textContent = t('structure', {n: num(Math.ceil(structurePoints(id, S.armor)))});
  });

  /* notes */
  var notes = [];
  if (!r.sameGalaxy) notes.push(['err', t('warnGalaxy')]);
  else if (!r.inRange && r.impulseOk) notes.push(['err', t('warnRange', {dist: r.distance, range: r.range})]);
  if (!r.impulseOk) notes.push(['err', t('warnImpulse')]);
  if (!r.siloOk) notes.push(['warn', t('warnSilo', {n: 4})]);
  else if (S.missiles > r.siloCapacity) notes.push(['warn', t('warnCapacity', {n: num(r.siloCapacity)})]);
  if (!S.missiles) notes.push(['', t('warnNoMissiles')]);
  else if (!r.effective) notes.push(['warn', t('allIntercepted', {n: num(r.interceptorsLeft)})]);
  $('#notes').innerHTML = notes.map(function (n) { return '<div class="note ' + n[0] + '">' + esc(n[1]) + '</div>'; }).join('');

  /* key figures */
  var destroyedUnits = r.rows.reduce(function (sum, x) { return sum + x.destroyed; }, 0);
  var total = function (v) { return v.m + v.k + v.d; };
  var html = kpi(t('destroyed'), destroyedUnits ? num(destroyedUnits) : t('nothingDestroyed'), destroyedUnits ? resources(r.value) : '', 'big');
  html += kpi(t('neededAll'), r.neededAll == null ? '–' : num(r.neededAll),
    r.neededAll == null ? t('neededNone') : r.neededPrimary != null && S.primary ? t('neededPrimary', {n: num(r.neededPrimary)}) : '', 'big');
  html += kpi(t('flightTime'), fmtDur(r.duration), t('rangeSub', {n: r.range}));
  html += kpi(t('intercepted'), num(r.intercepted), t('interceptedSub', {n: num(r.effective)}));
  html += kpi(t('damage'), num(r.damage), t('damageSub', {n: num(missileDamage(1, S.weapons))}));
  $('#hero').innerHTML = html;

  /* table per target type */
  var hasRows = r.rows.length > 0;
  $('#empty').hidden = hasRows;
  $('#tableWrap').hidden = !hasRows;
  $('#table thead').innerHTML = '<tr>' + ['colType', 'colCount', 'colStructure', 'colDestroyed', 'colRemaining'].map(function (h) {
    return '<th>' + esc(t(h)) + '</th>';
  }).join('') + '</tr>';
  $('#table tbody').innerHTML = r.rows.map(function (x) {
    var tag = S.primary === x.id ? '<span class="tag">' + esc(t('primaryTag')) + '</span>' : '';
    return '<tr class="' + (x.remaining ? '' : 'gone') + '"><td class="name">' + esc(elementName(x.id, lang())) + tag + '</td>'
      + '<td>' + num(x.count) + '</td><td>' + num(Math.ceil(x.structure)) + '</td>'
      + '<td class="' + (x.destroyed ? 'pos' : 'dim') + '">' + num(x.destroyed) + '</td><td>' + num(x.remaining) + '</td></tr>';
  }).join('');

  /* cost and benefit */
  var ratio = total(r.cost) ? total(r.value) / total(r.cost) : 0;
  $('#econ').innerHTML = kpi(t('cost'), short(total(r.cost)), resources(r.cost) + ' · ' + num(S.missiles) + ' × ' + short(MISSILE_COST.m + MISSILE_COST.k + MISSILE_COST.d))
    + kpi(t('value'), short(total(r.value)), resources(r.value))
    + kpi(t('ratio'), total(r.cost) ? (Math.round(ratio * 100) / 100).toLocaleString(lang() === 'de' ? 'de-DE' : 'en-GB') + ' ×' : '–');

  renderSpyHint();
}

function update() {
  persist();
  render();
}

/* ---------- events ---------- */

function bind() {
  ['start', 'target'].forEach(function (which) {
    var input = $('#' + which + 'In');
    input.addEventListener('input', function () {
      var c = parseCoordsText(input.value);
      input.classList.toggle('invalid', !c);
      if (c) { S[which] = c; update(); }
    });
    input.addEventListener('blur', function () { input.value = fmtCoordsText(S[which]); input.classList.remove('invalid'); });
    input.addEventListener('focus', function () { input.select(); });
  });
  $('#moonIn').addEventListener('change', function () { S.moon = $('#moonIn').checked; update(); });
  $('#primaryIn').addEventListener('change', function () { S.primary = Number($('#primaryIn').value) || 0; update(); });

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset.num) {
      S[el.dataset.num] = Math.max(0, parseInt(el.value, 10) || 0);
      update();
    } else if (el.dataset.amount || el.dataset.def) {
      var amount = parseAmount(el.value);
      el.classList.toggle('invalid', isNaN(amount));
      var value = isNaN(amount) ? 0 : amount;
      if (el.dataset.amount) S[el.dataset.amount] = value;
      else if (value) S.defense[el.dataset.def] = value;
      else delete S.defense[el.dataset.def];
      update();
    } else if (el.dataset.uni) {
      var v = parseFloat(el.value);
      if (!isNaN(v)) {
        S.uni[el.dataset.uni] = v;
        S.uni = cleanState(S).uni;
        update();
      }
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target.dataset && e.target.dataset.uni === 'galaxyType') {
      S.uni.galaxyType = Number(e.target.value) || 0;
      update();
    }
  });
  document.addEventListener('focusout', function (e) {
    var el = e.target;
    if (el.dataset && (el.dataset.amount || el.dataset.def || el.dataset.num || el.dataset.uni)) syncInputs();
  });
  $('#spyIn').addEventListener('input', function () {
    var text = $('#spyIn').value;
    if (!text.trim()) { spyMsg = null; render(); return; }
    spyMsg = applySpyReport(S, text);
    syncInputs();
    update();
  });
  $('#clearDefense').addEventListener('click', function () {
    S.defense = {};
    S.interceptors = 0;
    S.armor = 0;
    spyMsg = null;
    $('#spyIn').value = '';
    syncInputs();
    update();
  });
  $('#resetBtn').addEventListener('click', function () {
    if (!window.confirm(t('resetConfirm'))) return;
    var uni = S.uni;
    S = emptyState();
    S.uni = uni;
    spyMsg = null;
    $('#spyIn').value = '';
    syncInputs();
    update();
  });
  bindShare(function () { return location.origin + location.pathname + '#' + encodeHash(S); });
  bindLang(function () {
    buildDefense();
    syncInputs();
    render();
  });
  window.addEventListener('hashchange', function () {
    if (loadHash()) { syncInputs(); update(); toast(t('linkLoaded')); }
  });
}

/* A share link (from the hub or another player) replaces the inputs it carries. */
function loadHash() {
  var hash = location.hash.replace(/^#/, '');
  if (!hash) return false;
  var state = cleanState(S);
  if (!applyHash(state, hash)) return false;
  S = state;
  clearHash();
  return true;
}

function init() {
  initTexts(TEXTS);
  applyTexts();
  S = cleanState(load(LS_STATE));
  var fromLink = loadHash();
  buildDefense();
  bind();
  bindTips();
  syncInputs();
  update();
  if (fromLink) toast(t('linkLoaded'));
}

init();
