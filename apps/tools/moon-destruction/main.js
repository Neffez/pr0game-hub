/* Moon destruction calculator UI. Calculation and share link in ../src/moon.ts. */
import {
  MAX_WAVE_ROWS,
  applyHash,
  applyMoon,
  calculateWaves,
  cleanState,
  emptyState,
  encodeHash,
  fmtCoordsText,
  parseCoordsText,
  parseMoons,
  recommend,
  ripsFor,
} from '../src/moon.ts';
import { parseAmount } from '../src/core.ts';
import { TEXTS } from './i18n.js';
import { $, $$, applyTexts, bindLang, bindShare, bindTips, clearHash, esc, fmtNum, initTexts, lang, load, store, t, toast } from '../shared/shell.js';
import { openDialog } from '../shared/uni.js';

var LS_STATE = 'pr0moon.state.v1';

var S = emptyState();
/* moons of the last paste when it held several */
var pasted = [];

/* ---------- helpers ---------- */

function num(n) { return fmtNum(n || 0); }

/* Percent with the language's decimal comma: pct(0.325) = "32,5 %"; `digits` decimals at most. */
function pct(x, digits) {
  var d = digits == null ? 1 : digits;
  var v = Math.round(x * 100 * Math.pow(10, d)) / Math.pow(10, d);
  return v.toLocaleString(lang() === 'de' ? 'de-DE' : 'en-GB', {maximumFractionDigits: d}) + ' %';
}

/* A chance as the battle report shows it (already in percent). */
function shownPct(p) { return pct(p / 100, 1); }

/* Decimal number in the page language; `fixed` keeps the decimals (1,0 instead of 1). */
function dec(x, digits, fixed) {
  return x.toLocaleString(lang() === 'de' ? 'de-DE' : 'en-GB', {minimumFractionDigits: fixed ? digits : 0, maximumFractionDigits: digits});
}

function kpi(label, value, sub, cls) {
  return '<div class="kpi ' + (cls || '') + '"><span class="kpi-label">' + esc(label) + '</span>'
    + '<span class="kpi-value">' + esc(value) + '</span>'
    + (sub ? '<span class="kpi-sub">' + esc(sub) + '</span>' : '') + '</div>';
}

function moonLabel(m) {
  var parts = [];
  if (m.name) parts.push(t('moonName', {name: m.name}));
  if (m.target) parts.push('[' + fmtCoordsText(m.target) + ']');
  parts.push(num(m.diameter) + ' km');
  return parts.join(' ');
}

function persist() { store(LS_STATE, S); }

/* ---------- inputs ---------- */

function buildWaves() {
  $('#waves').innerHTML = S.waves.map(function (n, i) {
    return '<div class="wave" data-wave-box="' + i + '">'
      + '<label class="wave-name" for="wave-' + i + '">' + esc(t('wave', {n: i + 1})) + '<span></span></label>'
      + '<input id="wave-' + i + '" data-wave="' + i + '" type="text" inputmode="numeric" autocomplete="off" placeholder="0" value="' + (n ? num(n) : '') + '">'
      + '<button type="button" class="icon-btn" data-remove="' + i + '" title="' + esc(t('removeWave')) + '" aria-label="' + esc(t('removeWave')) + '"' + (S.waves.length > 1 ? '' : ' disabled') + '>'
      + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>'
      + '</div>';
  }).join('');
  $('#addWave').disabled = S.waves.length >= MAX_WAVE_ROWS;
}

/* Writes the state into the inputs (except the focused one, to keep what is being typed). */
function syncInputs() {
  var set = function (el, value) { if (document.activeElement !== el) { el.value = value; el.classList.remove('invalid'); } };
  set($('#diameterIn'), S.diameter ? num(S.diameter) : '');
  set($('#coordsIn'), fmtCoordsText(S.target));
  set($('#goalIn'), S.goal);
  $$('[data-wave]').forEach(function (el) { var n = S.waves[Number(el.dataset.wave)]; set(el, n ? num(n) : ''); });
}

/* ---------- render ---------- */

function render() {
  var d = S.diameter;
  var r = calculateWaves(d, S.waves);
  var flown = r.rows.length;
  var sent = S.waves.reduce(function (sum, n) { return sum + n; }, 0);

  $('#moonMeta').textContent = d ? [
    S.name ? t('moonName', {name: S.name}) : '',
    '√' + num(d) + ' = ' + dec(Math.sqrt(d), 2),
  ].filter(Boolean).join(' · ') : '';

  /* chance of each wave next to its input */
  var rowIndex = 0;
  S.waves.forEach(function (n, i) {
    var box = $('[data-wave-box="' + i + '"]');
    if (!box) return;
    box.classList.toggle('has', n > 0);
    var row = n > 0 ? r.rows[rowIndex++] : null;
    box.querySelector('.wave-name span').textContent = row && d ? t('waveMeta', {pct: shownPct(row.shown)}) : '';
  });

  /* notes */
  var notes = [];
  if (!d) notes.push(['', t('enterDiameter')]);
  else if (Math.sqrt(d) >= 100) notes.push(['err', t('noteTooBig')]);
  else if (!flown) notes.push(['', t('noWaves')]);
  if (d && flown) {
    notes.push(['', t('noteBattle')]);
    if (flown > 1) notes.push(['', t('noteAfter')]);
  }
  $('#notes').innerHTML = notes.map(function (n) { return '<div class="note ' + n[0] + '">' + esc(n[1]) + '</div>'; }).join('');

  /* key figures */
  var ready = d > 0 && flown > 0;
  $('#hero').hidden = !ready;
  $('#tableWrap').hidden = !ready;
  if (ready) {
    $('#hero').innerHTML = kpi(t('total'), pct(r.total), flown > 1 ? t('totalSub', {n: flown}) : t('totalSubOne'), 'big')
      + kpi(t('anyLost'), pct(r.anyLost), t('fleetSub', {pct: pct(r.fleetChance / 100, 0)}))
      + kpi(t('expectedLost'), dec(r.expectedLost, 1, true), t('expectedSub', {n: num(sent)}))
      + kpi(t('expectedWaves'), dec(r.expectedWaves, 2), t('expectedWavesSub'));
    $('#table thead').innerHTML = '<tr>' + ['colWave', 'colRips', 'colShown', 'colFlies', 'colCumulative', 'colLost'].map(function (h) {
      return '<th>' + esc(t(h)) + '</th>';
    }).join('') + '</tr>';
    $('#table tbody').innerHTML = r.rows.map(function (x, i) {
      var counts = x.shown !== Math.floor(x.shown) ? '<span class="sub">' + esc(t('counts', {pct: pct(x.chance, 0)})) + '</span>' : '';
      return '<tr><td class="name">' + esc(t('wave', {n: i + 1})) + '</td><td>' + num(x.rips) + '</td>'
        + '<td>' + esc(shownPct(x.shown)) + counts + '</td>'
        + '<td class="' + (x.flies < 1 ? 'dim' : '') + '">' + esc(pct(x.flies)) + '</td>'
        + '<td class="pos">' + esc(pct(x.cumulative)) + '</td>'
        + '<td class="' + (x.lost ? 'neg' : 'dim') + '">' + esc(pct(x.lost)) + '</td></tr>';
    }).join('');
  }

  renderRecommendation();
}

function renderRecommendation() {
  var d = S.diameter;
  var full = d ? ripsFor(d, 100) : null;
  $('#hundred').textContent = full ? t('hundred', {n: num(full)}) : '';
  var list = recommend(d, S.goal);
  $('#recEmpty').hidden = list.length > 0;
  $('#recEmpty').textContent = d ? t('recNone') : t('enterDiameter');
  $('#recWrap').hidden = !list.length;
  if (!list.length) return;
  var fewest = list.reduce(function (a, b) { return b.totalRips < a.totalRips ? b : a; });
  var safest = list.reduce(function (a, b) { return b.expectedLost < a.expectedLost - 1e-9 ? b : a; });
  $('#recTable thead').innerHTML = '<tr>' + ['recWaves', 'recPerWave', 'recTotal', 'recChance', 'recAnyLost', 'recExpected'].map(function (h) {
    return '<th>' + esc(t(h)) + '</th>';
  }).join('') + '<th></th></tr>';
  $('#recTable tbody').innerHTML = list.map(function (x) {
    var tags = (x === fewest ? '<span class="tag">' + esc(t('tagFewest')) + '</span>' : '')
      + (x === safest ? '<span class="tag">' + esc(t('tagSafest')) + '</span>' : '');
    var current = S.waves.length === x.waves && S.waves.every(function (n) { return n === x.ripsPerWave; });
    return '<tr class="' + (current ? 'best' : '') + '"><td class="name">' + x.waves + tags + '</td>'
      + '<td>' + num(x.ripsPerWave) + '</td><td>' + num(x.totalRips) + '</td>'
      + '<td class="pos">' + esc(pct(x.total)) + '</td><td class="neg">' + esc(pct(x.anyLost)) + '</td>'
      + '<td>' + esc(dec(x.expectedLost, 1, true)) + '</td>'
      + '<td><button type="button" class="link-btn" data-apply="' + x.waves + ':' + x.ripsPerWave + '">' + esc(t('recApply')) + '</button></td></tr>';
  }).join('');
}

function update() {
  persist();
  render();
}

/* ---------- paste ---------- */

function setPasteHint(text, cls) {
  var hint = $('#pasteHint');
  hint.hidden = !text;
  hint.className = 'hint ' + (cls || '');
  hint.textContent = text || '';
}

function takeMoon(m) {
  applyMoon(S, m);
  pasted = [];
  $('#pastePick').innerHTML = '';
  $('#pasteIn').value = '';
  setPasteHint('');
  syncInputs();
  update();
  toast(t('pasteOk', {moon: moonLabel(m)}));
  $('#pasteDialog').close();
}

function onPaste() {
  var text = $('#pasteIn').value;
  pasted = [];
  $('#pastePick').innerHTML = '';
  if (!text.trim()) { setPasteHint(''); return; }
  var moons = parseMoons(text);
  if (!moons.length) { setPasteHint(t('pasteNone'), 'err'); return; }
  if (moons.length === 1) { takeMoon(moons[0]); return; }
  pasted = moons;
  setPasteHint(t('pasteMany', {n: moons.length}));
  $('#pastePick').innerHTML = moons.map(function (m, i) {
    return '<button type="button" class="btn small" data-pick="' + i + '">' + esc(moonLabel(m)) + '</button>';
  }).join('');
}

/* ---------- events ---------- */

function bind() {
  $('#diameterIn').addEventListener('input', function () {
    var el = $('#diameterIn');
    var v = parseAmount(el.value);
    el.classList.toggle('invalid', isNaN(v));
    S.diameter = isNaN(v) ? 0 : v;
    update();
  });
  $('#coordsIn').addEventListener('input', function () {
    var el = $('#coordsIn');
    var c = el.value.trim() ? parseCoordsText(el.value) : null;
    el.classList.toggle('invalid', !!el.value.trim() && !c);
    if (c || !el.value.trim()) { S.target = c; update(); }
  });
  $('#coordsIn').addEventListener('focus', function () { $('#coordsIn').select(); });
  $('#goalIn').addEventListener('input', function () {
    var v = parseInt($('#goalIn').value, 10);
    if (v >= 1 && v <= 100) { S.goal = v; update(); }
  });
  $('#waves').addEventListener('input', function (e) {
    var el = e.target;
    if (!el.dataset.wave) return;
    var v = parseAmount(el.value);
    el.classList.toggle('invalid', isNaN(v));
    S.waves[Number(el.dataset.wave)] = isNaN(v) ? 0 : v;
    update();
  });
  $('#waves').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-remove]');
    if (!btn || S.waves.length < 2) return;
    S.waves.splice(Number(btn.dataset.remove), 1);
    buildWaves();
    update();
  });
  $('#addWave').addEventListener('click', function () {
    if (S.waves.length >= MAX_WAVE_ROWS) return;
    S.waves.push(S.waves[S.waves.length - 1] || 1);
    buildWaves();
    update();
    $('#wave-' + (S.waves.length - 1)).focus();
  });
  $('#recTable').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-apply]');
    if (!btn) return;
    var parts = btn.dataset.apply.split(':').map(Number);
    S.waves = [];
    for (var i = 0; i < parts[0]; i++) S.waves.push(parts[1]);
    buildWaves();
    update();
    toast(t('recApplied', {n: parts[0], rips: num(parts[1])}));
  });
  document.addEventListener('focusout', function (e) {
    var el = e.target;
    if (el.id === 'diameterIn' || el.id === 'goalIn' || el.id === 'coordsIn' || (el.dataset && el.dataset.wave)) syncInputs();
  });

  $('#pasteBtn').addEventListener('click', function () {
    setPasteHint('');
    openDialog($('#pasteDialog'));
    $('#pasteIn').focus();
  });
  $('#pasteIn').addEventListener('input', onPaste);
  $('#pastePick').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-pick]');
    if (btn && pasted[Number(btn.dataset.pick)]) takeMoon(pasted[Number(btn.dataset.pick)]);
  });
  $('#pasteDialog').addEventListener('click', function (e) { if (e.target === e.currentTarget) e.currentTarget.close(); });

  $('#resetBtn').addEventListener('click', function () {
    if (!window.confirm(t('resetConfirm'))) return;
    var goal = S.goal;
    S = emptyState();
    S.goal = goal;
    buildWaves();
    syncInputs();
    update();
  });
  bindShare(function () { return location.origin + location.pathname + '#' + encodeHash(S); });
  bindLang(function () {
    buildWaves();
    syncInputs();
    render();
  });
  window.addEventListener('hashchange', function () {
    if (loadHash()) { buildWaves(); syncInputs(); update(); toast(t('linkLoaded')); }
  });
}

/* A share link (from the hub or another player) replaces the moon and the values it carries. */
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
  buildWaves();
  bind();
  bindTips();
  syncInputs();
  update();
  if (fromLink) toast(t('linkLoaded'));
}

init();
