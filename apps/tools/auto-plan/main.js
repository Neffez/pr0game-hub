/* Auto plan UI. State, share link and the search's input in ../src/autoplan.ts; the search runs in ./worker.js
   (several Web Workers with other seeds, startOptimizePool of @pr0hub/planner). */
import {
  BUDGETS,
  ECONOMY,
  ECONOMY_DEFAULTS,
  KINDS,
  MAX_TARGETS,
  applyHash,
  cleanEconomy,
  cleanState,
  elementsOf,
  emptyState,
  encodeHash,
  isUnit,
  kindOf,
  maxValue,
  planInput,
  planRows,
  prodText,
  span,
  startResources,
  stepCounts,
} from '../src/autoplan.ts';
import { parseAmount } from '../src/core.ts';
import { checkOptimizeInput, OptimizeError, startOptimizePool } from '@pr0hub/planner';
import { activeUnits } from '@pr0hub/core/units';
import { techName } from '@pr0hub/core/tech';
import { TEXTS } from './i18n.js';
import { $, $$, applyTexts, bindLang, bindShare, bindTips, clearHash, copy, esc, fmtNum, initTexts, lang, load, store, t, toast } from '../shared/shell.js';
import { LS_UNI, fieldsetsHtml, openDialog, syncUniInputs, uniFieldGroups } from '../shared/uni.js';
import { UNITS_HASH, activeUnitOverrides, initUnits, mountUnitsButton, onUnitsChange, unitsLinkValue } from '../shared/units.js';

var LS_STATE = 'pr0autoplan.state.v1';
var CORES = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
var TIMEZONE = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return undefined; } })();

var S = emptyState(CORES);
var U = Object.assign({}, ECONOMY_DEFAULTS);

/* the search: pool, result, what it was planned on (to mark the result stale), progress */
var pool = null;
var result = null;
var planned = null;
var progress = null;
var runError = null;
var stopped = false;
var startedAt = 0;
var budget = 0;
var timer = null;
/* epoch seconds the plan of the result starts */
var startOf = 0;

/* ---------- helpers ---------- */

function num(n) { return fmtNum(n || 0); }
function name(id) { return techName(id, lang()); }

function kpi(label, value, sub, cls) {
  return '<div class="kpi ' + (cls || '') + '"><span class="kpi-label">' + esc(label) + '</span>'
    + '<span class="kpi-value">' + esc(value) + '</span>'
    + (sub ? '<span class="kpi-sub">' + esc(sub) + '</span>' : '') + '</div>';
}

var LOCALE = function () { return lang() === 'de' ? 'de-DE' : 'en-GB'; };

function clock(epoch) {
  if (epoch == null) return '–';
  return new Date(epoch * 1000).toLocaleString(LOCALE(), {weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
}

/* shorter, for the key figures: day, month and time */
function clockShort(epoch) {
  if (epoch == null) return '–';
  var d = new Date(epoch * 1000);
  var opts = {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'};
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = '2-digit';
  return d.toLocaleString(LOCALE(), opts);
}

/* epoch seconds <-> the value of a datetime-local input (local time) */
function toLocalInput(epoch) {
  if (epoch == null) return '';
  var d = new Date(epoch * 1000);
  var p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function fromLocalInput(value) {
  if (!value) return null;
  var ms = new Date(value).getTime();
  return isNaN(ms) ? null : Math.floor(ms / 1000);
}

function budgetText(sec) { return sec < 60 ? t('seconds', {n: sec}) : t('minutes', {n: sec / 60}); }

function persist() {
  store(LS_STATE, S);
  store(LS_UNI, Object.assign({}, load(LS_UNI) || {}, U));
}

/* What the search runs on, as text: a result planned on other inputs is stale. */
function inputKey() { return JSON.stringify([S.temp, S.levels, S.research, S.resources, S.targets, S.start, S.settings, U, activeUnitOverrides()]); }

/* ---------- inputs ---------- */

var RES = [['resMetal', 0], ['resCrystal', 1], ['resDeut', 2]];

function buildStatic() {
  var start = startResources();
  $('#resFields').innerHTML = RES.map(function (r) {
    return '<div class="field"><div class="label-row"><label for="res-' + r[1] + '">' + esc(t(r[0])) + '</label>'
      + (r[1] === 0 ? '<button type="button" class="tip" aria-label="' + esc(t('info')) + '" data-tip="' + esc(t('resTip')) + '"></button>' : '') + '</div>'
      + '<input id="res-' + r[1] + '" class="num" data-res="' + r[1] + '" type="text" inputmode="numeric" autocomplete="off" placeholder="' + num(start[r[1]]) + '"></div>';
  }).join('');
  $('#buildings').innerHTML = levelGrid('building', elementsOf('building'));
  $('#research').innerHTML = levelGrid('research', elementsOf('research'));
  $('#budgetIn').innerHTML = BUDGETS.map(function (b) { return '<option value="' + b + '">' + esc(budgetText(b)) + '</option>'; }).join('');
  $('#workersIn').max = String(CORES);
  $$('[data-t-tip="workersTip"]').forEach(function (el) { el.setAttribute('data-tip', t('workersTip', {cores: CORES})); });
  $('#forbid').innerHTML = ECONOMY.map(function (id) {
    return '<label class="chip" data-chip="' + id + '"><input type="checkbox" data-forbid="' + id + '"> ' + esc(name(id)) + '</label>';
  }).join('');
  $('#uniFields').innerHTML = fieldsetsHtml(uniFieldGroups(['groupEconomy']));
}

function levelGrid(kind, ids) {
  return ids.map(function (id) {
    return '<div class="lvl" data-lvl-box="' + id + '"><label for="lvl-' + id + '">' + esc(name(id)) + '</label>'
      + '<input id="lvl-' + id + '" data-lvl="' + kind + '" data-id="' + id + '" type="text" inputmode="numeric" autocomplete="off" placeholder="0"></div>';
  }).join('');
}

function levelsOf(kind) { return kind === 'research' ? S.research : S.levels; }
function current(id) { var k = kindOf(id); return k === 'building' ? (S.levels[id] || 0) : k === 'research' ? (S.research[id] || 0) : 0; }

function buildTargets() {
  if (!S.targets.length) {
    $('#targets').innerHTML = '<p class="empty">' + esc(t('noTargets')) + '</p>';
  } else {
    $('#targets').innerHTML = S.targets.map(function (x, i) {
      var kind = kindOf(x.element);
      return '<div class="target" data-target="' + i + '">'
        + '<select class="kind" data-kind="' + i + '" aria-label="' + esc(t('kind')) + '">'
        + KINDS.map(function (k) { return '<option value="' + k + '"' + (k === kind ? ' selected' : '') + '>' + esc(t('kind' + k[0].toUpperCase() + k.slice(1))) + '</option>'; }).join('')
        + '</select>'
        + '<select data-element="' + i + '" aria-label="' + esc(t('element')) + '">'
        + elementsOf(kind).map(function (id) { return '<option value="' + id + '"' + (id === x.element ? ' selected' : '') + '>' + esc(name(id)) + '</option>'; }).join('')
        + '</select>'
        + '<input data-value="' + i + '" type="text" inputmode="numeric" autocomplete="off" aria-label="' + esc(t(isUnit(kind) ? 'count' : 'level')) + '" title="' + esc(t(isUnit(kind) ? 'count' : 'level')) + '" value="' + num(x.value) + '">'
        + '<button type="button" class="icon-btn" data-remove="' + i + '" title="' + esc(t('removeTarget')) + '" aria-label="' + esc(t('removeTarget')) + '">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>'
        + '<span class="now" data-now="' + i + '"></span>'
        + '</div>';
    }).join('');
  }
  $('#addTarget').disabled = S.targets.length >= MAX_TARGETS;
  renderNow();
}

function renderNow() {
  S.targets.forEach(function (x, i) {
    var el = $('[data-now="' + i + '"]');
    if (!el) return;
    var kind = kindOf(x.element);
    var have = current(x.element);
    el.textContent = isUnit(kind) ? '' : (have >= x.value ? t('reached') : t('nowLevel', {n: have}));
  });
}

/* Writes the state into the inputs (except the focused one, to keep what is being typed). */
function syncInputs() {
  var set = function (el, value) { if (el && document.activeElement !== el) { el.value = value; el.classList.remove('invalid'); } };
  set($('#tempIn'), S.temp == null ? '' : String(S.temp));
  set($('#startIn'), toLocalInput(S.start));
  RES.forEach(function (r) { set($('#res-' + r[1]), S.resources ? num(S.resources[r[1]]) : ''); });
  $$('[data-lvl]').forEach(function (el) {
    var v = levelsOf(el.dataset.lvl)[el.dataset.id] || 0;
    set(el, v ? String(v) : '');
    el.closest('.lvl').classList.toggle('has', v > 0);
  });
  S.targets.forEach(function (x, i) { set($('[data-value="' + i + '"]'), num(x.value)); });
  var o = S.settings;
  $('#budgetIn').value = String(o.budget);
  set($('#workersIn'), String(o.workers));
  $('#economyIn').checked = o.economy;
  $('#throttleIn').checked = o.throttle;
  $$('[data-forbid]').forEach(function (el) {
    el.checked = o.forbid.indexOf(Number(el.dataset.forbid)) !== -1;
    el.closest('.chip').classList.toggle('on', el.checked);
  });
  $('#ratioIn').checked = !!o.mineRatio;
  $('#ratioFields').hidden = !o.mineRatio;
  set($('#ratioK'), String(o.mineRatio ? o.mineRatio[0] : 2));
  set($('#ratioD'), String(o.mineRatio ? o.mineRatio[1] : 2));
  $('#quietIn').checked = !!o.quietHours;
  $('#quietFields').hidden = !o.quietHours;
  set($('#quietFrom'), String(o.quietHours ? o.quietHours[0] : 0));
  set($('#quietTo'), String(o.quietHours ? o.quietHours[1] : 7));
}

function renderMeta() {
  var b = Object.keys(S.levels).length;
  var r = Object.keys(S.research).length;
  $('#buildingsMeta').textContent = b ? t('levelsMeta', {n: b}) : t('levelsNone');
  $('#researchMeta').textContent = r ? t('levelsMeta', {n: r}) : '';
  $('#searchMeta').textContent = t('searchMeta', {budget: budgetText(S.settings.budget), workers: S.settings.workers});
  var f = function (v) { return String(v).replace('.', lang() === 'de' ? ',' : '.'); };
  $('#uniSummary').textContent = t('uniEconomy', {b: f(U.building_speed), r: f(U.research_speed), p: f(U.resource_multiplier)});
}

/* ---------- result ---------- */

function allReached() {
  return S.targets.length > 0 && S.targets.every(function (x) { return !isUnit(kindOf(x.element)) && current(x.element) >= x.value; });
}

function renderRun() {
  var running = !!pool;
  $('#runBtn').hidden = running;
  $('#stopBtn').hidden = !running;
  $('#runBtn').disabled = !S.targets.length || allReached();
  $('#runBtn').querySelector('span').textContent = t(result ? 'rerun' : 'run');
  $('#progress').hidden = !running;
  var evals = progress ? num(progress.evaluations) : '0';
  if (running) {
    var elapsed = Math.min(budget, (Date.now() - startedAt) / 1000);
    $('#progressBar').style.width = Math.round(elapsed / budget * 100) + '%';
    var phase = progress ? t('phase' + progress.phase[0].toUpperCase() + progress.phase.slice(1)) : t('phaseGreedy');
    $('#runStatus').textContent = t('running', {elapsed: Math.round(elapsed) + ' s', budget: budgetText(budget)}) + ' · ' + phase;
  } else {
    $('#runStatus').textContent = result ? t(stopped ? 'statusStopped' : 'statusDone', {evals: evals}) : '';
  }
}

function renderResult() {
  var notes = [];
  if (!S.targets.length) notes.push(['', t('noteNoTargets')]);
  else if (allReached()) notes.push(['', t('noteReached')]);
  if (runError) notes.push(['err', runError]);
  var stale = !!result && !pool && planned !== inputKey();
  if (stale) notes.push(['warn', t('noteStale')]);
  if (!result && S.targets.length && U.building_speed === 1 && U.research_speed === 1 && U.resource_multiplier === 1) notes.push(['', t('noteUni')]);
  $('#notes').innerHTML = notes.map(function (n) { return '<div class="note ' + n[0] + '">' + esc(n[1]) + '</div>'; }).join('');
  $('#results').classList.toggle('stale', stale);

  $('#hero').hidden = !result;
  $('#plan').hidden = !result;
  if (!result) return;
  var r = result;
  var counts = stepCounts(r.steps);
  var units = r.steps.reduce(function (sum, s) { return sum + (s.kind === 'ship' || s.kind === 'defense' ? (s.count || 1) : 0); }, 0);
  var slower = r.baselineFinishAt - r.finishAt;
  $('#hero').innerHTML = kpi(t('doneAt'), clockShort(r.finishAt), t('doneIn', {span: span(r.finishAt - startOf)}), 'big')
    + kpi(t('plain'), slower > 60 ? clockShort(r.baselineFinishAt) : t('plainSame'), slower > 60 ? t('plainSub', {span: span(slower)}) : '')
    + kpi(t('steps'), num(r.steps.length - counts.prod), units ? t('stepsSubUnits', {b: counts.building, r: counts.research, u: num(units)}) : t('stepsSub', {b: counts.building, r: counts.research}))
    + kpi(t('evals'), num(progress ? progress.evaluations : r.evaluations), t('evalsSub', {n: progress ? progress.workers : 1}));

  var rows = planRows(plannedState(), r);
  var targetIds = {};
  S.targets.forEach(function (x) { targetIds[x.element] = x.value; });
  $('#planTitle').textContent = t('planTitle', {n: rows.length});
  $('#planTable thead').innerHTML = '<tr><th>#</th><th class="col-step">' + esc(t('colStep')) + '</th><th class="col-start">' + esc(t('colStart')) + '</th><th class="col-end">' + esc(t('colEnd')) + '</th><th class="col-dur">' + esc(t('colDuration')) + '</th></tr>';
  $('#planTable tbody').innerHTML = rows.map(function (x, i) {
    var isTarget = x.step.element != null && targetIds[x.step.element] != null && (x.level == null ? true : x.level === targetIds[x.step.element]);
    var cls = x.step.kind === 'prod' ? 'prod' : isTarget ? 'goal' : '';
    return '<tr class="' + cls + '"><td class="idx">' + (i + 1) + '</td><td class="name">' + esc(stepTitle(x)) + '</td>'
      + '<td class="col-start">' + esc(clock(x.start)) + '</td><td>' + esc(clock(x.end)) + '</td>'
      + '<td class="dim col-dur">' + (x.start != null && x.end != null && x.end > x.start ? esc(span(x.end - x.start)) : '–') + '</td></tr>';
  }).join('');
}

/* the state the result was planned on (levels for the step titles) */
function plannedState() {
  if (!planned) return S;
  var p = JSON.parse(planned);
  return {levels: p[1], research: p[2]};
}

function stepTitle(x) {
  var s = x.step;
  if (s.kind === 'prod') return t('prodStep', {text: prodText(s, t('prodLetters').split(','))});
  if (s.kind === 'ship' || s.kind === 'defense') return t('unitsStep', {n: num(s.count || 1), name: name(s.element)});
  return name(s.element) + (x.level != null ? ' ' + x.level : '');
}

function planText() {
  if (!result) return '';
  var rows = planRows(plannedState(), result);
  return [t('textHead', {at: clock(result.finishAt)})].concat(rows.map(function (x, i) {
    return (i + 1) + '. ' + stepTitle(x) + ' · ' + clock(x.start) + ' → ' + clock(x.end);
  })).join('\n');
}

function render() {
  renderMeta();
  renderNow();
  renderRun();
  renderResult();
}

function update() {
  persist();
  render();
}

/* ---------- search ---------- */

function run() {
  if (pool || !S.targets.length) return;
  runError = null;
  stopped = false;
  if (typeof Worker === 'undefined') { runError = t('noteWorkers'); render(); return; }
  startOf = Math.floor(Date.now() / 1000);
  var input = planInput(S, U, startOf, TIMEZONE);
  try {
    checkOptimizeInput(Object.assign({}, input, {units: activeUnits()}));
  } catch (e) {
    runError = e instanceof OptimizeError ? t('noteInvalid', {reason: e.message}) : t('noteFailed', {reason: String(e && e.message || e)});
    render();
    return;
  }
  if (S.start != null) startOf = S.start;
  result = null;
  progress = null;
  planned = inputKey();
  budget = S.settings.budget;
  startedAt = Date.now();
  timer = setInterval(renderRun, 500);
  pool = startOptimizePool({
    request: {input: JSON.parse(JSON.stringify(input)), units: activeUnitOverrides(), budgetMs: budget * 1000},
    workers: Math.max(1, Math.min(CORES, S.settings.workers)),
    createWorker: function () { return new Worker(new URL('./worker.js', import.meta.url), {type: 'module'}); },
    onProgress: function (p) {
      progress = p;
      if (p.best && p.best !== result) { result = p.best; renderResult(); }
      renderRun();
    },
  });
  pool.done.then(function (best) {
    if (best) result = best;
  }, function (e) {
    runError = e instanceof OptimizeError ? t('noteInvalid', {reason: e.message}) : t('noteFailed', {reason: String(e && e.message || e)});
  }).then(function () {
    pool = null;
    clearInterval(timer);
    render();
  });
  render();
}

function stop() {
  if (!pool) return;
  stopped = true;
  pool.stop();
}

/* ---------- paste ---------- */

function setPasteHint(text, cls) {
  var hint = $('#pasteHint');
  hint.hidden = !text;
  hint.className = 'hint ' + (cls || '');
  hint.textContent = text || '';
}

var pasteSeq = 0;

function onPaste() {
  var text = $('#pasteIn').value;
  if (!text.trim()) { setPasteHint(''); return; }
  var seq = ++pasteSeq;
  setPasteHint(t('pasteReading'));
  import('@pr0hub/core/planetPages').then(function (mod) {
    if (seq !== pasteSeq) return;
    var page = mod.parsePlanetPage(text);
    if (!page) { setPasteHint(t('pasteNone'), 'err'); return; }
    if (page.type === 'moon') { setPasteHint(t('pasteMoon'), 'err'); return; }
    var kind = page.kind === 'buildings' ? 'building' : 'research';
    var ids = elementsOf(kind);
    var levels = {};
    Object.keys(page.levels).forEach(function (id) { if (page.levels[id] > 0 && ids.indexOf(Number(id)) !== -1) levels[id] = page.levels[id]; });
    var n = Object.keys(levels).length;
    if (kind === 'building') {
      S.levels = levels;
      var res = page.resources;
      if (res[901] != null) S.resources = [Math.floor(res[901] || 0), Math.floor(res[902] || 0), Math.floor(res[903] || 0)];
      toast(t('pasteBuildings', {coords: page.coords.g + ':' + page.coords.s + ':' + page.coords.p, n: n}));
    } else {
      S.research = levels;
      toast(t('pasteResearch', {n: n}));
    }
    $('#pasteIn').value = '';
    setPasteHint('');
    $('#pasteDialog').close();
    syncInputs();
    update();
  }).catch(function (e) {
    if (seq === pasteSeq) setPasteHint(String(e && e.message || e), 'err');
  });
}

/* ---------- events ---------- */

function bind() {
  document.addEventListener('input', function (e) {
    var el = e.target;
    var v;
    if (el.dataset.lvl) {
      v = parseInt(el.value, 10);
      var bad = el.value.trim() !== '' && !(v >= 0 && v <= 255);
      el.classList.toggle('invalid', bad);
      if (bad) return;
      var map = levelsOf(el.dataset.lvl);
      if (v > 0) map[el.dataset.id] = v; else delete map[el.dataset.id];
      el.closest('.lvl').classList.toggle('has', v > 0);
      update();
    } else if (el.dataset.res) {
      v = parseAmount(el.value);
      el.classList.toggle('invalid', isNaN(v));
      if (isNaN(v)) return;
      var anyRes = RES.some(function (r) { return $('#res-' + r[1]).value.trim() !== ''; });
      if (!anyRes) S.resources = null;
      else {
        var start = S.resources || startResources();
        S.resources = start.slice();
        S.resources[Number(el.dataset.res)] = v;
      }
      update();
    } else if (el.dataset.value) {
      var x = S.targets[Number(el.dataset.value)];
      v = parseAmount(el.value);
      var invalid = isNaN(v) || v < 1 || v > maxValue(kindOf(x.element));
      el.classList.toggle('invalid', invalid);
      if (!invalid) { x.value = v; update(); }
    } else if (el.dataset.uni) {
      var u = parseFloat(el.value);
      if (!isNaN(u)) { U = cleanEconomy(Object.assign({}, U, {[el.dataset.uni]: u})); update(); }
    } else if (el.id === 'tempIn') {
      v = el.value.trim() === '' ? null : parseInt(el.value, 10);
      var badTemp = v != null && !(v >= -300 && v <= 300);
      el.classList.toggle('invalid', badTemp);
      if (!badTemp) { S.temp = v; update(); }
    } else if (el.id === 'workersIn') {
      v = parseInt(el.value, 10);
      if (v >= 1 && v <= 64) { S.settings.workers = v; update(); }
    } else if (el.id === 'ratioK' || el.id === 'ratioD') {
      v = parseInt(el.value, 10);
      if (v >= 0 && v <= 50 && S.settings.mineRatio) { S.settings.mineRatio[el.id === 'ratioK' ? 0 : 1] = v; update(); }
    } else if (el.id === 'quietFrom' || el.id === 'quietTo') {
      v = parseFloat(el.value);
      if (v >= 0 && v <= 24 && S.settings.quietHours) { S.settings.quietHours[el.id === 'quietFrom' ? 0 : 1] = v; update(); }
    } else if (el.id === 'pasteIn') {
      onPaste();
    }
  });
  document.addEventListener('change', function (e) {
    var el = e.target;
    var i;
    if (el.dataset.kind) {
      i = Number(el.dataset.kind);
      var ids = elementsOf(el.value);
      S.targets[i] = {element: ids[0], value: 1};
      buildTargets();
      update();
    } else if (el.dataset.element) {
      i = Number(el.dataset.element);
      S.targets[i].element = Number(el.value);
      S.targets[i].value = Math.min(S.targets[i].value, maxValue(kindOf(S.targets[i].element)));
      update();
    } else if (el.dataset.forbid) {
      var id = Number(el.dataset.forbid);
      var list = S.settings.forbid.filter(function (x) { return x !== id; });
      if (el.checked) list.push(id);
      S.settings.forbid = ECONOMY.filter(function (x) { return list.indexOf(x) !== -1; });
      el.closest('.chip').classList.toggle('on', el.checked);
      update();
    } else if (el.id === 'startIn') {
      S.start = fromLocalInput(el.value);
      update();
    } else if (el.id === 'budgetIn') {
      S.settings.budget = Number(el.value);
      update();
    } else if (el.id === 'economyIn') {
      S.settings.economy = el.checked;
      update();
    } else if (el.id === 'throttleIn') {
      S.settings.throttle = el.checked;
      update();
    } else if (el.id === 'ratioIn') {
      S.settings.mineRatio = el.checked ? [parseInt($('#ratioK').value, 10) || 2, parseInt($('#ratioD').value, 10) || 2] : null;
      syncInputs();
      update();
    } else if (el.id === 'quietIn') {
      S.settings.quietHours = el.checked ? [parseFloat($('#quietFrom').value) || 0, parseFloat($('#quietTo').value) || 7] : null;
      syncInputs();
      update();
    }
  });
  document.addEventListener('focusout', function (e) {
    var el = e.target;
    if (el.dataset && (el.dataset.lvl || el.dataset.res || el.dataset.value) || ['tempIn', 'workersIn', 'ratioK', 'ratioD', 'quietFrom', 'quietTo'].indexOf(el.id) !== -1) syncInputs();
  });
  $('#targets').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-remove]');
    if (!btn) return;
    S.targets.splice(Number(btn.dataset.remove), 1);
    buildTargets();
    update();
  });
  $('#addTarget').addEventListener('click', function () {
    if (S.targets.length >= MAX_TARGETS) return;
    var last = S.targets[S.targets.length - 1];
    var kind = last ? kindOf(last.element) : 'building';
    var id = elementsOf(kind)[0];
    S.targets.push({element: id, value: Math.max(1, current(id) + 1)});
    buildTargets();
    update();
    var sel = $('[data-element="' + (S.targets.length - 1) + '"]');
    if (sel) sel.focus();
  });
  $('#runBtn').addEventListener('click', run);
  $('#stopBtn').addEventListener('click', stop);
  $('#copyBtn').addEventListener('click', function () { copy(planText(), t('planCopied')); });

  $('#pasteBtn').addEventListener('click', function () {
    setPasteHint('');
    openDialog($('#pasteDialog'));
    $('#pasteIn').focus();
  });
  $('#pasteDialog').addEventListener('click', function (e) { if (e.target === e.currentTarget) e.currentTarget.close(); });

  var openSettings = function () { syncUniInputs(U); openDialog($('#settings')); };
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#uniChip').addEventListener('click', openSettings);
  $('#settings').addEventListener('click', function (e) { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('#uniReset').addEventListener('click', function () {
    U = Object.assign({}, ECONOMY_DEFAULTS);
    syncUniInputs(U);
    update();
    toast(t('uniReset'));
  });

  $('#resetBtn').addEventListener('click', function () {
    if (!window.confirm(t('resetConfirm'))) return;
    var settings = S.settings;
    S = emptyState(CORES);
    S.settings = settings;
    buildTargets();
    syncInputs();
    update();
  });
  bindShare(function () {
    var units = unitsLinkValue(S.targets.map(function (x) { return x.element; }).filter(function (id) { return id >= 200; }));
    return location.origin + location.pathname + '#' + encodeHash(S, U) + (units ? '&' + UNITS_HASH + '=' + units : '');
  });
  bindLang(function () {
    buildStatic();
    buildTargets();
    syncInputs();
    render();
  });
  window.addEventListener('hashchange', function () {
    if (loadHash()) { buildTargets(); syncInputs(); update(); toast(t('linkLoaded')); }
  });
}

/* A share link replaces the planet, the targets and the values it carries. */
function loadHash() {
  var hash = location.hash.replace(/^#/, '');
  if (!hash) return false;
  var uo = new URLSearchParams(hash).get(UNITS_HASH);
  if (uo) initUnits(uo);
  var state = cleanState(JSON.parse(JSON.stringify(S)), CORES);
  var uni = Object.assign({}, U);
  if (!applyHash(state, uni, hash)) return false;
  S = state;
  U = uni;
  clearHash();
  return true;
}

function init() {
  initTexts(TEXTS);
  applyTexts();
  S = cleanState(load(LS_STATE), CORES);
  U = cleanEconomy(load(LS_UNI));
  initUnits(null);
  onUnitsChange(function () {
    buildTargets();
    update();
  });
  var fromLink = loadHash();
  buildStatic();
  buildTargets();
  mountUnitsButton();
  bind();
  bindTips();
  syncInputs();
  update();
  if (fromLink) toast(t('linkLoaded'));
}

init();
