/* Flight calculator UI. Calculation and parsing live in ../src/core.ts (on top of @pr0hub/flight). */
import {
  DEFAULT_UNI,
  SHIPS,
  SHIP_BY_ID,
  STAY_PRESETS,
  abortHome,
  activeShips,
  getDelayedTimestamps,
  getFleetConsumption,
  getFleetSlowest,
  getMissionDuration,
  getShipSpeed,
  getTargetDistance,
  getTimestamps,
  getTimestampsFromArrival,
  nearest,
  parseAmount,
  parseCoords,
  parseTimeInput,
  recallFor,
  setCustomShips,
  shipLabel,
} from '../src/core.ts';
import { TEXTS } from './i18n.js';
import { $, $$, applyTexts, bindLang, bindTips, clearHash, copy as copyText, esc, fmtNum as fmtNumLang, initTexts, lang, load, store, t as tr, toast } from '../shared/shell.js';


var LS_STATE = 'pr0fc.state.v1';
var LS_UNI = 'pr0fc.uni.v1';
var SPEEDS = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
/* Mode descriptions (text keys); the keys of MODES are the valid modes. */
var MODES = {flight: 'modeTextFlight', timing: 'modeTextTiming', retime: 'modeTextRetime', abort: 'modeTextAbort'};

/* Why a recall time does not exist (text keys by reason of recallFor / recallHome). */
var REASONS = {
  not_started: 'reasonNotStarted',
  stay_locked: 'reasonStayLocked',
  returning: 'reasonReturning',
  before_start: 'reasonBeforeStart',
  no_abort_needed: 'reasonNoAbort',
  unreachable: 'reasonUnreachable'
};

var ENEMY_RECALL = {
  not_started: 'enemyNotStarted',
  stay_locked: 'enemyStayLocked',
  returning: 'enemyReturning'
};

/* Universe settings dialog; group, label and hint are text keys. */
var UNI_FIELDS = [
  {group: 'groupSpeed', key: 'game_speed', label: 'uGameSpeed', step: 'any', min: 0.01, hint: 'uGameSpeedHint'},
  {group: 'groupSpeed', key: 'expo_hold_multiplier', label: 'uExpoHold', step: 'any', min: 0.01, hint: 'uExpoHoldHint'},
  {group: 'groupSpeed', key: 'honor_boost', label: 'uHonor', step: 'any', min: 0, hint: 'uHonorHint'},
  {group: 'groupLayout', key: 'max_galaxy', label: 'uGalaxies', step: 1, min: 1},
  {group: 'groupLayout', key: 'max_system', label: 'uSystems', step: 1, min: 1},
  {group: 'groupLayout', key: 'max_planets', label: 'uPlanets', step: 1, min: 1},
  {group: 'groupLayout', key: 'uni_type', label: 'uUniType', type: 'shape'},
  {group: 'groupLayout', key: 'galaxy_type', label: 'uGalaxyType', type: 'shape'},
  {group: 'groupDistances', key: 'galaxy_distance_factor', label: 'uGalFactor', step: 'any', min: 0},
  {group: 'groupDistances', key: 'system_distance_factor', label: 'uSysFactor', step: 'any', min: 0},
  {group: 'groupDistances', key: 'system_distance', label: 'uSysBase', step: 'any', min: 0},
  {group: 'groupDistances', key: 'planet_distance_factor', label: 'uPlanetFactor', step: 'any', min: 0},
  {group: 'groupDistances', key: 'planet_distance', label: 'uPlanetBase', step: 'any', min: 0},
  {group: 'groupClock', key: 'clock_offset', label: 'uClock', step: 1, hint: 'uClockHint'}
];
var SHAPES = [[0, 'shapeLinear'], [1, 'shapeRing'], [2, 'shapeSphere']];

/* Hash keys for uni settings (compatible with the in-game calculator links). */
var UNI_HASH = {
  uni_type: 'ut', galaxy_type: 'gt', max_galaxy: 'mg', max_system: 'ms', max_planets: 'mp',
  galaxy_distance_factor: 'gdf', system_distance_factor: 'sdf', system_distance: 'sd',
  planet_distance_factor: 'pdf', planet_distance: 'pd', game_speed: 'gs',
  expo_hold_multiplier: 'ehm', honor_boost: 'hb'
};
var TECH_HASH = {combustion: 'c', impulse: 'i', hyperspace: 'h', fuelEfficiency: 'fe', expedition: 'ex'};

var U = Object.assign({}, DEFAULT_UNI);
var S = null;

function nowUnix() {
  return Math.floor(Date.now() / 1000 + (Number(U.clock_offset) || 0));
}

/* ---------- formatting ---------- */

function pad(n) { return n < 10 ? '0' + n : String(n); }

function fmtClock(unix) {
  var d = new Date(unix * 1000);
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function fmtFull(unix) {
  var d = new Date(unix * 1000);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + fmtClock(unix);
}

function fmtDay(unix) {
  var d = new Date(unix * 1000);
  return tr('weekdays').split(',')[d.getDay()] + ', ' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function dayDiff(unix, now) {
  var a = new Date(unix * 1000);
  var b = new Date(now * 1000);
  var da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  var db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((da - db) / 86400000);
}

function fmtDur(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  var days = Math.floor(seconds / 86400);
  var rest = seconds % 86400;
  var clock = pad(Math.floor(rest / 3600)) + ':' + pad(Math.floor((rest % 3600) / 60)) + ':' + pad(rest % 60);
  return days > 0 ? days + 'd ' + clock : clock;
}

function fmtCountdown(seconds) {
  if (seconds === 0) {
    return tr('nowWord');
  }
  return seconds > 0 ? tr('inDur', {dur: fmtDur(seconds)}) : tr('agoDur', {dur: fmtDur(-seconds)});
}

function fmtNum(n) {
  return fmtNumLang(n);
}

function shipName(ship) {
  return shipLabel(ship, lang());
}

function fmtCoords(c) {
  return c.g + ':' + c.s + ':' + c.p;
}

function fmtHours(h) {
  return h + ' h';
}

/* Time cell: clock, day marker and copy target. */
function tcell(unix, now) {
  var diff = dayDiff(unix, now);
  var tag = diff === 0 ? '' : '<sup>' + (diff > 0 ? '+' : '−') + Math.abs(diff) + '</sup>';
  return '<span class="t" data-copy="' + fmtClock(unix) + '" title="' + esc(tr('copyTitle', {time: fmtDay(unix) + ' ' + fmtClock(unix)})) + '">' + fmtClock(unix) + tag + '</span>';
}

/* ---------- state ---------- */

function defaultState(now) {
  return {
    mode: 'flight',
    start: {g: 1, s: 1, p: 1},
    target: {g: 1, s: 2, p: 1},
    mission: 'none',
    stay: {hold: 1, expo: 1, trade: 1},
    ships: {},
    techs: {combustion: 0, impulse: 0, hyperspace: 0, fuelEfficiency: 0, expedition: 0},
    speed: 10,
    depLive: true,
    dep: now,
    arr: now + 3600,
    enemyArr: now + 3600,
    enemyDelayed: false,
    enemyOrigArr: now + 3600,
    enemyOutcome: 'impact',
    enemyRecall: now,
    abDepLive: true,
    abDep: now,
    abortKind: 'home',
    recallLive: true,
    recall: now,
    home: now + 8 * 3600,
    konter: {start: null, ship: 204, combustion: 0, impulse: 0, hyperspace: 0, offset: 1}
  };
}

function mergeSaved(state, saved, now) {
  if (!saved || typeof saved !== 'object') {
    return state;
  }
  Object.keys(state).forEach(function (key) {
    if (saved[key] === undefined || saved[key] === null) {
      return;
    }
    if (state[key] && typeof state[key] === 'object' && !Array.isArray(state[key])) {
      Object.assign(state[key], saved[key]);
    } else {
      state[key] = saved[key];
    }
  });
  /* Drop stale absolute times so a returning user does not start in the past. */
  ['arr', 'enemyArr', 'enemyOrigArr', 'home'].forEach(function (key) {
    if (state[key] < now - 6 * 3600) {
      state[key] = defaultState(now)[key];
    }
  });
  if (state.enemyRecall < now - 2 * 86400) {
    state.enemyRecall = now;
  }
  [['dep', 'depLive'], ['abDep', 'abDepLive'], ['recall', 'recallLive']].forEach(function (pair) {
    if (state[pair[0]] < now - 2 * 86400) {
      state[pair[0]] = now;
      state[pair[1]] = true;
    }
  });
  return state;
}

function parseHash() {
  var raw = (location.hash || '').replace(/^#/, '');
  var out = {};
  if (!raw) {
    return out;
  }
  new URLSearchParams(raw).forEach(function (value, key) {
    out[key] = value;
  });
  return out;
}

function num(value, fallback) {
  var n = parseFloat(value);
  return isNaN(n) ? fallback : n;
}

/* Applies a share link; returns true when anything was taken over. */
function applyHash(state, h) {
  if (!Object.keys(h).length) {
    return false;
  }
  var coordKeys = {sg: ['start', 'g'], ss: ['start', 's'], sp: ['start', 'p'], tg: ['target', 'g'], ts: ['target', 's'], tp: ['target', 'p']};
  Object.keys(coordKeys).forEach(function (k) {
    if (h[k]) {
      state[coordKeys[k][0]][coordKeys[k][1]] = parseInt(h[k], 10) || 1;
    }
  });
  Object.keys(TECH_HASH).forEach(function (tech) {
    if (h[TECH_HASH[tech]] !== undefined) {
      state.techs[tech] = parseInt(h[TECH_HASH[tech]], 10) || 0;
    }
  });
  if (h.cs) {
    try { applyCustom(JSON.parse(h.cs)); } catch (e) { /* ignore broken link data */ }
  }
  if (h.ships) {
    state.ships = {};
    h.ships.split(',').forEach(function (part) {
      var bits = part.split(':');
      if (bits.length === 2 && SHIP_BY_ID[bits[0]]) {
        state.ships[bits[0]] = Math.max(0, Math.floor(num(bits[1], 0)));
      }
    });
  }
  if (h.spd) {
    state.speed = Math.min(10, Math.max(1, parseInt(h.spd, 10) || 10));
  }
  if (h.mis && ['none', 'hold', 'expo', 'trade'].indexOf(h.mis) !== -1) {
    state.mission = h.mis;
    if (h.stay !== undefined && h.mis !== 'none') {
      state.stay[h.mis] = num(h.stay, 1);
    }
  } else if (h.stay !== undefined && num(h.stay, 0) > 0) {
    state.mission = 'hold';
    state.stay.hold = num(h.stay, 1);
  }
  if (h.m && MODES[h.m]) {
    state.mode = h.m;
  }
  /* Old links: mode=retime&arr=… meant "arrival known". */
  if (h.mode === 'retime') {
    state.mode = 'retime';
    if (h.arr) {
      state.enemyArr = parseInt(h.arr, 10);
    }
  } else if (h.arr) {
    state.arr = parseInt(h.arr, 10);
  }
  if (h.ea) { state.enemyArr = parseInt(h.ea, 10); }
  if (h.eo) { state.enemyOrigArr = parseInt(h.eo, 10); state.enemyDelayed = true; }
  if (h.eout === 'impact' || h.eout === 'recall') { state.enemyOutcome = h.eout; }
  if (h.er) { state.enemyRecall = parseInt(h.er, 10); }
  if (h.dep) { state.dep = parseInt(h.dep, 10); state.depLive = false; }
  if (h.abd) { state.abDep = parseInt(h.abd, 10); state.abDepLive = false; }
  if (h.ak === 'at' || h.ak === 'home') { state.abortKind = h.ak; }
  if (h.rc) { state.recall = parseInt(h.rc, 10); state.recallLive = false; }
  if (h.hm) { state.home = parseInt(h.hm, 10); }
  if (h.ks) { state.konter.start = parseCoords(h.ks); }
  if (h.kship && SHIP_BY_ID[h.kship]) { state.konter.ship = h.kship; }
  if (h.kc !== undefined) { state.konter.combustion = parseInt(h.kc, 10) || 0; }
  if (h.ki !== undefined) { state.konter.impulse = parseInt(h.ki, 10) || 0; }
  if (h.kh !== undefined) { state.konter.hyperspace = parseInt(h.kh, 10) || 0; }
  if (h.ko !== undefined) { state.konter.offset = parseInt(h.ko, 10) || 0; }
  Object.keys(UNI_HASH).forEach(function (key) {
    if (h[UNI_HASH[key]] !== undefined) {
      U[key] = num(h[UNI_HASH[key]], U[key]);
    }
  });
  return true;
}

function buildShareUrl() {
  var p = new URLSearchParams();
  p.set('m', S.mode);
  p.set('sg', S.start.g); p.set('ss', S.start.s); p.set('sp', S.start.p);
  p.set('tg', S.target.g); p.set('ts', S.target.s); p.set('tp', S.target.p);
  var ships = activeShips(S.ships).map(function (id) { return id + ':' + S.ships[id]; }).join(',');
  if (ships) {
    p.set('ships', ships);
  }
  Object.keys(TECH_HASH).forEach(function (tech) { p.set(TECH_HASH[tech], S.techs[tech]); });
  p.set('spd', S.speed);
  p.set('mis', S.mission);
  if (S.mission !== 'none') {
    p.set('stay', S.stay[S.mission]);
  }
  if (S.mode === 'flight' && !S.depLive) { p.set('dep', S.dep); }
  if (S.mode === 'timing') { p.set('arr', S.arr); }
  if (S.mode === 'retime') {
    p.set('ea', S.enemyArr);
    if (S.enemyDelayed) { p.set('eo', S.enemyOrigArr); }
    p.set('eout', S.enemyOutcome);
    if (S.enemyOutcome === 'recall') { p.set('er', S.enemyRecall); }
    if (S.konter.start) { p.set('ks', fmtCoords(S.konter.start)); }
    p.set('kship', S.konter.ship); p.set('kc', S.konter.combustion); p.set('ki', S.konter.impulse);
    p.set('kh', S.konter.hyperspace); p.set('ko', S.konter.offset);
  }
  if (S.mode === 'abort') {
    if (!S.abDepLive) { p.set('abd', S.abDep); }
    p.set('ak', S.abortKind);
    if (S.abortKind === 'home') { p.set('hm', S.home); } else if (!S.recallLive) { p.set('rc', S.recall); }
  }
  Object.keys(UNI_HASH).forEach(function (key) { p.set(UNI_HASH[key], U[key]); });
  if (CUSTOM.length) {
    p.set('cs', JSON.stringify(CUSTOM.map(function (c) {
      var out = {id: c.id, name: c.name};
      CUSTOM_FIELDS.forEach(function (key) { out[key] = c[key]; });
      return out;
    })));
  }
  return location.origin + location.pathname + '#' + p.toString();
}

var saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    store(LS_TABS, {active: TABS.indexOf(activeTab), tabs: TABS.map(function (t) { return {name: t.name, state: t.state}; })});
    store(LS_UNI, U);
    store(LS_SHIPS, CUSTOM);
  }, 250);
}

/* ---------- derived values ---------- */

function stayHours() {
  if (S.mission === 'none') {
    return 0;
  }
  if (S.mission === 'expo') {
    var opts = expoOptions();
    if (!opts.length) {
      return 0;
    }
    return opts.indexOf(S.stay.expo) !== -1 ? S.stay.expo : opts[0];
  }
  return S.stay[S.mission] || 0;
}

function expoOptions() {
  var level = Number(S.techs.expedition) || 0;
  var factor = Number(U.expo_hold_multiplier) || 1;
  var out = [];
  for (var i = 1; i <= level; i++) {
    out.push(Math.round((i / factor) * 100) / 100);
  }
  return out;
}

function holdAbortable() {
  return S.mission === 'hold' || S.mission === 'trade';
}

function context() {
  var slowest = getFleetSlowest(S.ships, S.techs);
  return {
    now: nowUnix(),
    dist: getTargetDistance(S.start, S.target, U),
    slowest: slowest,
    stay: Math.round(stayHours() * 3600),
    holdAbortable: holdAbortable()
  };
}

function rowFor(c, n) {
  var dur = getMissionDuration(n, c.slowest.speed, c.dist, U.game_speed);
  var r = {n: n, dur: dur};
  if (S.mode === 'flight') {
    r.t = getTimestamps(S.depLive ? c.now : S.dep, dur, c.stay);
  } else if (S.mode === 'timing') {
    r.t = getTimestampsFromArrival(S.arr, dur, c.stay);
    r.cd = r.t.start - c.now;
  } else if (S.mode === 'retime') {
    r.t = getDelayedTimestamps(S.enemyArr, S.enemyDelayed ? S.enemyOrigArr : S.enemyArr, dur, c.stay);
    r.enemyHome = r.t.home;
    if (S.enemyOutcome === 'recall') {
      r.recall = S.enemyRecall;
      r.res = abortHome(r.recall, r.t, c.holdAbortable);
      r.enemyHome = r.res.home;
    }
  } else {
    r.t = getTimestamps(S.abDepLive ? c.now : S.abDep, dur, c.stay);
    r.latest = (c.holdAbortable && c.stay > 0 ? r.t.stayEnd : r.t.arrival) - 1;
    if (S.abortKind === 'at') {
      r.recall = S.recallLive ? c.now : S.recall;
      r.res = abortHome(r.recall, r.t, c.holdAbortable);
    } else {
      r.res = recallFor(S.home, r.t, c.holdAbortable);
      if (r.res.recall !== null) {
        r.cd = r.res.recall - c.now;
      }
    }
  }
  r.deut = getFleetConsumption(S.ships, dur, c.dist, S.techs, U.game_speed, U.honor_boost);
  return r;
}

/* ---------- rendering ---------- */

function kpi(label, value, sub, cls) {
  return '<div class="kpi ' + (cls || '') + '"><span class="kpi-label">' + esc(label) + '</span>'
    + '<span class="kpi-value">' + value + '</span>'
    + (sub ? '<span class="kpi-sub">' + sub + '</span>' : '') + '</div>';
}

function na(text) {
  return '<span class="kpi-value na">' + esc(text) + '</span>';
}

function kpiNa(label, text, sub, cls) {
  return '<div class="kpi ' + (cls || '') + '"><span class="kpi-label">' + esc(label) + '</span>' + na(text)
    + (sub ? '<span class="kpi-sub">' + sub + '</span>' : '') + '</div>';
}

function cdSpan(seconds) {
  return '<span class="' + (seconds < 0 ? 'neg' : 'pos') + '">' + fmtCountdown(seconds) + '</span>';
}

function renderHero(c, r) {
  var t = r.t;
  var now = c.now;
  var html = '';
  var stayInfo = c.stay > 0 ? tr('stayUntil', {time: fmtClock(t.stayEnd)}) : '';
  if (S.mode === 'flight') {
    html += kpi(tr('arrival'), tcell(t.arrival, now), cdSpan(t.arrival - now), 'big');
    html += kpi(tr('return'), tcell(t.home, now), stayInfo || cdSpan(t.home - now), 'big ret');
    html += kpi(tr('departure'), tcell(t.start, now), S.depLive ? tr('nowWord') : fmtDay(t.start));
    html += kpi(tr('durationOneWay'), fmtDur(r.dur));
    html += kpi(tr('deuterium'), fmtNum(r.deut));
  } else if (S.mode === 'timing') {
    html += kpi(tr('sendAt'), tcell(t.start, now), cdSpan(r.cd) + (r.cd < 0 ? esc(tr('tooLateFor', {pct: r.n * 10})) : ''), 'big');
    html += kpi(tr('arrival'), tcell(t.arrival, now), fmtDay(t.arrival));
    html += kpi(tr('return'), tcell(t.home, now), stayInfo);
    html += kpi(tr('durationOneWay'), fmtDur(r.dur));
    html += kpi(tr('deuterium'), fmtNum(r.deut));
  } else if (S.mode === 'retime') {
    var recalled = S.enemyOutcome === 'recall';
    if (r.enemyHome !== null) {
      html += kpi(tr('enemyBackHome'), tcell(r.enemyHome, now), cdSpan(r.enemyHome - now), 'big ret');
    } else {
      html += kpiNa(tr('enemyBackHome'), tr(ENEMY_RECALL[r.res.reason]), esc(tr('tryOtherSpeed')), 'big');
    }
    html += kpi(tr('enemyLaunched'), tcell(t.start, now), cdSpan(t.start - now));
    if (recalled) {
      html += kpi(tr('recalledAt'), tcell(r.recall, now), r.enemyHome !== null ? esc(tr('flewOutbound', {dur: fmtDur(r.recall - t.start)})) : '');
      html += kpi(tr('withoutRecall'), tcell(t.home, now), r.enemyHome !== null
        ? esc(tr('recallReturns', {dur: fmtDur(Math.abs(r.enemyHome - t.home)), when: tr(r.enemyHome >= t.home ? 'later' : 'earlier')}))
        : '');
    } else {
      html += kpi(tr(S.enemyDelayed ? 'impactDelayed' : 'arrivalAtTarget'), tcell(t.arrival, now), stayInfo);
    }
    if (S.enemyDelayed) {
      html += kpi(tr('delay'), (S.enemyArr >= S.enemyOrigArr ? '+' : '−') + fmtDur(Math.abs(S.enemyArr - S.enemyOrigArr)));
    }
    html += kpi(tr('durationOneWay'), fmtDur(r.dur));
  } else if (S.abortKind === 'home') {
    if (r.res.recall !== null) {
      html += kpi(tr('recallAt'), tcell(r.res.recall, now), cdSpan(r.cd) + (r.res.phase === 'hold' ? esc(tr('duringHold')) : ''), 'big');
      html += kpi(tr('backAt'), tcell(r.res.home, now), esc(r.res.home !== S.home ? tr('rounding', {s: r.res.home - S.home}) : tr('exact')), 'big ret');
    } else {
      var detail = r.res.reason === 'no_abort_needed' ? esc(tr('regularReturnAt', {time: fmtClock(t.home)})) : '';
      html += kpiNa(tr('recallAt'), tr(REASONS[r.res.reason]), detail, 'big');
    }
    html += kpi(tr('arrivalAtTarget'), tcell(t.arrival, now), esc(tr('flight', {dur: fmtDur(r.dur)})));
    html += kpi(tr('latestRecall'), tcell(r.latest, now), cdSpan(r.latest - now));
    html += kpi(tr('regularReturn'), tcell(t.home, now));
  } else {
    if (r.res.home !== null) {
      html += kpi(tr('backAt'), tcell(r.res.home, now), esc(tr('returnFlight', {dur: fmtDur(r.res.home - r.recall)})), 'big ret');
    } else {
      html += kpiNa(tr('backAt'), tr('recallReason', {reason: tr(REASONS[r.res.reason])}), '', 'big');
    }
    var progress = Math.max(0, Math.min(100, (r.recall - t.start) / Math.max(1, t.arrival - t.start) * 100));
    html += kpi(tr('recallAt'), tcell(r.recall, now), S.recallLive ? tr('nowWord') : cdSpan(r.recall - now));
    html += kpi(tr('outboundProgress'), progress.toFixed(1) + ' %');
    html += kpi(tr('arrivalAtTarget'), tcell(t.arrival, now));
    html += kpi(tr('latestRecall'), tcell(r.latest, now), cdSpan(r.latest - now));
  }
  $('#hero').innerHTML = html;
}

function renderTimeline(c, r) {
  var t = r.t;
  if (S.mode === 'retime' && r.res && r.res.home !== null) {
    /* Recalled enemy: outbound until the recall, then back for the time already flown. */
    t = r.res.phase === 'hold'
      ? {start: t.start, arrival: t.arrival, stayEnd: r.recall, home: r.res.home}
      : {start: t.start, arrival: r.recall, stayEnd: r.recall, home: r.res.home};
  }
  var total = t.home - t.start;
  if (total <= 0) {
    $('#timeline').innerHTML = '';
    return;
  }
  var marks = [];
  if (c.now >= t.start && c.now <= t.home) {
    marks.push({at: c.now, label: tr('tlNow'), cls: 'now'});
  }
  if (S.mode === 'abort' || (S.mode === 'retime' && r.res && r.res.home !== null)) {
    var recall = S.mode === 'retime' || S.abortKind === 'at' ? r.recall : r.res.recall;
    if (recall !== null && recall >= t.start && recall <= t.home && recall !== c.now) {
      marks.push({at: recall, label: tr('tlRecall'), cls: 'recall'});
    } else if (recall === c.now && marks.length) {
      marks[0] = {at: recall, label: tr('tlRecallNow'), cls: 'recall'};
    }
  }
  var bar = '<span class="tl-seg out" style="flex:' + (t.arrival - t.start) + '"></span>';
  if (t.stayEnd > t.arrival) {
    bar += '<span class="tl-seg stay" style="flex:' + (t.stayEnd - t.arrival) + '"></span>';
  }
  bar += '<span class="tl-seg back" style="flex:' + (t.home - t.stayEnd) + '"></span>';
  marks.forEach(function (m) {
    bar += '<span class="tl-mark ' + m.cls + '" style="left:' + ((m.at - t.start) / total * 100).toFixed(2) + '%"><i></i><em>' + esc(m.label) + '</em></span>';
  });
  var legend = '<span><i style="background:var(--out)"></i>' + esc(tr('outbound')) + ' ' + fmtClock(t.start) + ' → ' + fmtClock(t.arrival) + '</span>';
  if (t.stayEnd > t.arrival) {
    legend += '<span><i style="background:var(--stay)"></i>' + esc(tr('stay')) + ' ' + fmtDur(t.stayEnd - t.arrival) + '</span>';
  }
  legend += '<span><i style="background:var(--back)"></i>' + esc(tr('returnArrow')) + ' → ' + fmtClock(t.home) + '</span>';
  $('#timeline').innerHTML = '<div class="tl-bar">' + bar + '</div><div class="tl-legend">' + legend + '</div>';
}

function renderTable(c, rows) {
  var head;
  var body = '';
  var showStay = c.stay > 0;
  var now = c.now;
  if (S.mode === 'flight') {
    head = ['colSpeed', 'colDuration', 'arrival'].concat(showStay ? ['colStayUntil'] : []).concat(['return', 'deuterium']);
  } else if (S.mode === 'timing') {
    head = ['colSpeed', 'colDuration', 'sendAt', 'colCountdown', 'return', 'deuterium'];
  } else if (S.mode === 'retime') {
    head = ['colSpeed', 'colDuration', 'enemyLaunched'].concat(showStay ? ['colStayUntil'] : []).concat(['colEnemyHome', '']);
  } else if (S.abortKind === 'home') {
    head = ['colSpeed', 'colDuration', 'arrival', 'latestRecall', 'recallAt', 'colCountdown', 'backAt'];
  } else {
    head = ['colSpeed', 'colDuration', 'arrival', 'latestRecall', 'colBackAfterRecall', 'regularReturn'];
  }
  rows.forEach(function (r) {
    var t = r.t;
    var cells = ['<td>' + (r.n * 10) + ' %</td>', '<td>' + fmtDur(r.dur) + '</td>'];
    var past = false;
    if (S.mode === 'flight') {
      cells.push('<td>' + tcell(t.arrival, now) + '</td>');
      if (showStay) { cells.push('<td>' + tcell(t.stayEnd, now) + '</td>'); }
      cells.push('<td>' + tcell(t.home, now) + '</td>', '<td>' + fmtNum(r.deut) + '</td>');
    } else if (S.mode === 'timing') {
      past = r.cd < 0;
      cells.push('<td>' + tcell(t.start, now) + '</td>', '<td>' + cdSpan(r.cd) + '</td>',
        '<td>' + tcell(t.home, now) + '</td>', '<td>' + fmtNum(r.deut) + '</td>');
    } else if (S.mode === 'retime') {
      cells.push('<td>' + tcell(t.start, now) + '</td>');
      if (showStay) { cells.push('<td>' + tcell(t.stayEnd, now) + '</td>'); }
      if (r.enemyHome === null) {
        past = true;
        cells.push('<td colspan="2"><span class="muted">' + esc(tr(ENEMY_RECALL[r.res.reason])) + '</span></td>');
      } else {
        cells.push('<td>' + tcell(r.enemyHome, now) + '</td>', '<td>' + (t.start > now ? '<span class="muted">' + esc(tr('notLaunched')) + '</span>' : '') + '</td>');
      }
    } else if (S.abortKind === 'home') {
      cells.push('<td>' + tcell(t.arrival, now) + '</td>', '<td>' + tcell(r.latest, now) + '</td>');
      if (r.res.recall !== null) {
        past = r.cd < 0;
        cells.push('<td>' + tcell(r.res.recall, now) + '</td>', '<td>' + cdSpan(r.cd) + '</td>', '<td>' + tcell(r.res.home, now) + '</td>');
      } else {
        cells.push('<td colspan="3"><span class="muted">' + esc(tr(REASONS[r.res.reason])) + '</span></td>');
      }
    } else {
      cells.push('<td>' + tcell(t.arrival, now) + '</td>', '<td>' + tcell(r.latest, now) + '</td>');
      cells.push(r.res.home !== null
        ? '<td>' + tcell(r.res.home, now) + '</td>'
        : '<td><span class="muted">' + esc(tr(REASONS[r.res.reason])) + '</span></td>');
      cells.push('<td>' + tcell(t.home, now) + '</td>');
    }
    var cls = (r.n === S.speed ? 'sel' : '') + (past ? ' past' : '');
    body += '<tr data-speed="' + r.n + '" class="' + cls + '">' + cells.join('') + '</tr>';
  });
  $('#table thead').innerHTML = '<tr>' + head.map(function (h) { return '<th>' + (h ? esc(tr(h)) : '') + '</th>'; }).join('') + '</tr>';
  $('#table tbody').innerHTML = body;
}

function renderKonter(c, sel) {
  var k = S.konter;
  var from = k.start || S.target;
  var ship = SHIP_BY_ID[k.ship] || SHIP_BY_ID[204];
  var speed = getShipSpeed(ship, k);
  var dist = getTargetDistance(from, S.start, U);
  if (sel.enemyHome === null) {
    $('#konterInfo').textContent = tr('konterNoReturn');
    $('#konterTable thead').innerHTML = '';
    $('#konterTable tbody').innerHTML = '';
    return;
  }
  var land = sel.enemyHome + (Number(k.offset) || 0);
  $('#konterInfo').innerHTML = tr('konterInfo', {
    target: fmtCoords(S.start), land: fmtClock(land), speed: sel.n * 10, offset: Number(k.offset) || 0,
    dist: fmtNum(dist), ship: esc(shipName(ship)), shipSpeed: fmtNum(speed)
  });
  var body = '';
  SPEEDS.forEach(function (n) {
    var dur = getMissionDuration(n, speed, dist, U.game_speed);
    var launch = land - Math.floor(dur);
    var cd = launch - c.now;
    body += '<tr class="' + (cd < 0 ? 'past' : '') + '"><td>' + (n * 10) + ' %</td><td>' + fmtDur(dur) + '</td><td>'
      + tcell(launch, c.now) + '</td><td>' + cdSpan(cd) + '</td></tr>';
  });
  $('#konterTable thead').innerHTML = '<tr>' + ['yourSpeed', 'colDuration', 'sendAt', 'colCountdown'].map(function (h) {
    return '<th>' + esc(tr(h)) + '</th>';
  }).join('') + '</tr>';
  $('#konterTable tbody').innerHTML = body;
}

function renderMobileBar(c, r) {
  var bar = $('#mbar');
  if (!r) {
    bar.classList.remove('on');
    return;
  }
  var main;
  var t = r.t;
  if (S.mode === 'flight') {
    main = tr('mbarArrival', {a: fmtClock(t.arrival), h: fmtClock(t.home)});
  } else if (S.mode === 'timing') {
    main = tr('mbarSend', {t: fmtClock(t.start), cd: fmtCountdown(r.cd)});
  } else if (S.mode === 'retime') {
    main = r.enemyHome !== null ? tr('mbarEnemyHome', {t: fmtClock(r.enemyHome)}) : esc(tr(ENEMY_RECALL[r.res.reason]));
  } else if (S.abortKind === 'home') {
    main = r.res.recall !== null ? tr('mbarRecall', {t: fmtClock(r.res.recall), cd: fmtCountdown(r.cd)}) : esc(tr(REASONS[r.res.reason]));
  } else {
    main = r.res.home !== null ? tr('mbarBack', {t: fmtClock(r.res.home)}) : esc(tr(REASONS[r.res.reason]));
  }
  bar.innerHTML = '<span>' + main + '</span><span>' + (r.n * 10) + ' % ↓</span>';
  bar.classList.add('on');
}

function renderInputsMeta(c) {
  $('#distMeta').textContent = tr('distance', {d: fmtNum(c.dist)});
  var count = activeShips(S.ships).reduce(function (sum, id) { return sum + Number(S.ships[id]); }, 0);
  $('#fleetMeta').textContent = count ? tr(count === 1 ? 'fleetMetaOne' : 'fleetMeta', {n: fmtNum(count), speed: fmtNum(c.slowest.speed)}) : '';
  $('#techMeta').textContent = tr('techMeta', {c: S.techs.combustion, i: S.techs.impulse, h: S.techs.hyperspace});
  SHIPS.forEach(function (ship) {
    var el = document.getElementById('ship-' + ship.id);
    var box = el.closest('.ship');
    var has = Number(S.ships[ship.id]) > 0;
    box.classList.toggle('has', has);
    var isSlowest = has && c.slowest.id === String(ship.id) && activeShips(S.ships).length > 1;
    box.classList.toggle('slowest', isSlowest);
    box.querySelector('.ship-name span').textContent = fmtNum(getShipSpeed(ship, S.techs))
      + (isSlowest ? tr('slowest') : '');
  });
  var errors = [];
  [['start', S.start], ['target', S.target]].forEach(function (pair) {
    var p = pair[1];
    if (p.g < 1 || p.g > U.max_galaxy || p.s < 1 || p.s > U.max_system || p.p < 1 || p.p > U.max_planets + 1) {
      errors.push(tr('outsideUni', {which: tr(pair[0]), size: U.max_galaxy + ':' + U.max_system + ':' + U.max_planets}));
    }
  });
  $('#routeErr').hidden = !errors.length;
  $('#routeErr').textContent = errors.join(' · ');
}

function render() {
  if (TABS.length) {
    updateTabs();
  }
  var c = context();
  renderInputsMeta(c);
  var empty = !c.slowest.speed;
  $('#empty').hidden = !empty;
  $('#resultBody').hidden = empty;
  $('#konterCard').hidden = S.mode !== 'retime' || empty;
  if (empty) {
    renderMobileBar(c, null);
    return;
  }
  var rows = SPEEDS.map(function (n) { return rowFor(c, n); });
  var sel = rows[10 - S.speed];
  renderHero(c, sel);
  renderTimeline(c, sel);
  renderTable(c, rows);
  if (S.mode === 'retime') {
    renderKonter(c, sel);
  }
  renderMobileBar(c, sel);
}

/* ---------- inputs ---------- */

function setPressed(container, attr, value) {
  $$(container + ' [' + attr + ']').forEach(function (btn) {
    btn.setAttribute('aria-pressed', String(btn.getAttribute(attr) === String(value)));
  });
}

function syncMode() {
  $$('.modes [data-mode]').forEach(function (btn) {
    btn.setAttribute('aria-selected', String(btn.dataset.mode === S.mode));
  });
  $('#modeTip').dataset.tip = tr(MODES[S.mode]) + '\n\n' + tr('timeFormats');
  $$('[data-for]').forEach(function (el) {
    el.hidden = el.dataset.for.split(' ').indexOf(S.mode) === -1;
  });
  $$('[data-kind-for]').forEach(function (el) {
    el.hidden = el.dataset.kindFor !== S.abortKind;
  });
  setPressed('#abortKindSeg', 'data-kind', S.abortKind);
  var enemy = S.mode === 'retime';
  $('#startLbl').textContent = tr(enemy ? 'enemyHomePlanet' : 'start');
  $('#targetLbl').textContent = tr(enemy ? 'enemyTarget' : 'target');
  $('#fleetTitle').textContent = tr(enemy ? 'enemyFleet' : 'fleet');
  $('#techTitle').textContent = tr(enemy ? 'enemyResearch' : 'research');
  $('#speedLbl').textContent = tr(enemy ? 'enemySpeed' : 'speed');
  syncRetime();
}

function syncRetime() {
  $('#enemyDelayed').checked = S.enemyDelayed;
  $('#origWrap').hidden = !S.enemyDelayed;
  $('#enemyRecallWrap').hidden = S.enemyOutcome !== 'recall';
  setPressed('#outcomeSeg', 'data-outcome', S.enemyOutcome);
  $('label[for="tf-enemyArr"]').textContent = tr(S.enemyDelayed ? 'lblEnemyArrDelayed' : 'lblEnemyArr');
  var hint = $('#retimeHint');
  if (S.enemyDelayed && S.enemyOrigArr > S.enemyArr) {
    hint.classList.add('err');
    hint.textContent = tr('origBeforeDelayed');
    hint.hidden = false;
    return;
  }
  hint.hidden = true;
}

function syncMission() {
  setPressed('#missionSeg', 'data-mission', S.mission);
  var chips = '';
  var hint = '';
  var tipText = '';
  if (S.mission === 'hold' || S.mission === 'trade') {
    chips = STAY_PRESETS[S.mission].map(function (h) {
      return '<button type="button" class="chip" data-stay="' + h + '" aria-pressed="' + (S.stay[S.mission] === h) + '">' + fmtHours(h) + '</button>';
    }).join('');
    tipText = tr(S.mission === 'hold' ? 'holdTip' : 'tradeTip');
  } else if (S.mission === 'expo') {
    var opts = expoOptions();
    var current = stayHours();
    chips = opts.map(function (h) {
      return '<button type="button" class="chip" data-stay="' + h + '" aria-pressed="' + (current === h) + '">' + fmtHours(h) + '</button>';
    }).join('');
    tipText = tr('expoTip');
    hint = opts.length ? '' : tr('expoNeedsAstro');
  }
  $('#stayChips').innerHTML = chips;
  $('#stayChips').hidden = !chips;
  $('#stayHint').textContent = hint;
  $('#stayHint').hidden = !hint;
  $('#missionTip').dataset.tip = tipText;
  $('#missionTip').hidden = !tipText;
}

function syncCoords() {
  $('#startIn').value = fmtCoords(S.start);
  $('#targetIn').value = fmtCoords(S.target);
  $('#startIn').classList.remove('invalid');
  $('#targetIn').classList.remove('invalid');
  syncCoordsPlaceholder();
}

function buildTimeFields() {
  $$('.tf').forEach(function (el) {
    var key = el.dataset.key;
    var live = el.dataset.live;
    var id = 'tf-' + key;
    el.innerHTML = '<div class="field">'
      + '<div class="tf-head"><label for="' + id + '">' + esc(el.dataset.label) + '</label>'
      + (live ? '<label class="switch"><input type="checkbox" data-live-toggle="' + live + '"><span class="track"></span>' + esc(tr('live')) + '</label>' : '')
      + '</div>'
      + '<div class="tf-row"><input id="' + id + '" type="text" autocomplete="off" spellcheck="false" data-time="' + key + '" placeholder="hh:mm:ss">'
      + '<button type="button" class="btn" data-now="' + key + '">' + esc(tr('now')) + '</button></div>'
      + '<span class="hint" data-time-hint="' + key + '"></span></div>';
  });
}

function timeHint(key, value) {
  var hint = $('[data-time-hint="' + key + '"]');
  if (value === null) {
    hint.textContent = tr('timeNotRecognised');
    hint.classList.add('err');
    return;
  }
  hint.classList.remove('err');
  hint.textContent = fmtDay(value) + ' · ' + fmtCountdown(value - nowUnix());
}

function syncTimeFields(skipFocused) {
  var now = nowUnix();
  $$('[data-time]').forEach(function (input) {
    var key = input.dataset.time;
    var liveKey = input.closest('.tf').dataset.live;
    var isLive = liveKey && S[liveKey];
    var value = isLive ? now : S[key];
    input.disabled = !!isLive;
    if (!(skipFocused && document.activeElement === input)) {
      input.value = fmtFull(value);
      input.classList.remove('invalid');
      timeHint(key, value);
    }
    if (liveKey) {
      $('[data-live-toggle="' + liveKey + '"]').checked = !!S[liveKey];
    }
  });
}

function buildShips() {
  $('#shipGrid').innerHTML = SHIPS.map(function (ship) {
    return '<div class="ship" data-ship-box="' + ship.id + '"' + '>'
      + '<label class="ship-name" for="ship-' + ship.id + '" title="' + esc(shipName(ship)) + '"><strong>' + esc(shipName(ship)) + '</strong><span></span></label>'
      + '<input id="ship-' + ship.id + '" data-ship="' + ship.id + '" type="text" inputmode="numeric" autocomplete="off" placeholder="0"></div>';
  }).join('');
  $('#kShip').innerHTML = SHIPS.map(function (ship) {
    return '<option value="' + ship.id + '">' + esc(shipName(ship)) + '</option>';
  }).join('');
}

function syncShips() {
  SHIPS.forEach(function (ship) {
    var input = document.getElementById('ship-' + ship.id);
    var n = Number(S.ships[ship.id]) || 0;
    if (document.activeElement !== input) {
      input.value = n ? fmtNum(n) : '';
    }
  });
}

function syncTechs() {
  $$('[data-tech]').forEach(function (input) {
    input.value = S.techs[input.dataset.tech];
  });
}

function syncKonter() {
  var k = S.konter;
  $('#kStart').value = k.start ? fmtCoords(k.start) : '';
  $('#kOffset').value = k.offset;
  $('#kShip').value = k.ship;
  $$('[data-ktech]').forEach(function (input) {
    input.value = k[input.dataset.ktech];
  });
}

function buildSpeedSeg() {
  $('#speedSeg').innerHTML = SPEEDS.map(function (n) {
    return '<button type="button" data-speed="' + n + '">' + (n * 10) + '</button>';
  }).join('');
}

function syncAll() {
  syncMode();
  syncMission();
  syncCoords();
  syncTimeFields(false);
  syncShips();
  syncTechs();
  syncKonter();
  setPressed('#speedSeg', 'data-speed', S.speed);
  syncUniSummary();
}

function update() {
  persist();
  render();
}


/* ---------- custom ships ---------- */

var LS_SHIPS = 'pr0fc.ships.v1';
var CUSTOM = [];
var DRIVES = [['1', 'combustion'], ['2', 'impulse'], ['3', 'hyperspace']];
var CUSTOM_FIELDS = ['speed1', 'speed2', 'speed3', 'tech1', 'tech2', 'tech3', 'consumption1', 'consumption2', 'consumption3'];

function applyCustom(list) {
  CUSTOM = (Array.isArray(list) ? list : []).filter(function (c) {
    return c && /^c\d+$/.test(c.id);
  }).map(function (c) {
    var ship = {id: c.id, name: String(c.name || tr('customShip')).slice(0, 40), custom: true};
    CUSTOM_FIELDS.forEach(function (key) {
      ship[key] = Math.max(0, Number(c[key]) || 0);
    });
    return ship;
  });
  setCustomShips(CUSTOM);
}

function nextCustomId() {
  var max = 0;
  CUSTOM.forEach(function (c) {
    max = Math.max(max, parseInt(c.id.slice(1), 10) || 0);
  });
  return 'c' + (max + 1);
}

function renderCustomList() {
  var list = $('#customList');
  if (!CUSTOM.length) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = CUSTOM.map(function (c) {
    var rows = DRIVES.map(function (d) {
      return '<tr><td>' + esc(tr(d[1])) + '</td>' + [['speed', 'baseSpeed'], ['tech', 'usedFrom'], ['consumption', 'consumption']].map(function (col) {
        var key = col[0];
        return '<td><input data-cs="' + key + d[0] + '" type="number" min="0" step="1" inputmode="numeric" value="' + c[key + d[0]] + '" aria-label="' + esc(tr(d[1]) + ' ' + tr(col[1])) + '"></td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="cship" data-cid="' + c.id + '">'
      + '<div class="cship-head"><input class="input" data-cs="name" value="' + esc(c.name) + '" maxlength="40" aria-label="' + esc(tr('shipName')) + '">'
      + '<button type="button" class="btn ghost" data-cs-del>' + esc(tr('remove')) + '</button></div>'
      + '<div class="table-wrap"><table class="cship-table"><thead><tr>' + ['drive', 'baseSpeed', 'usedFrom', 'consumption'].map(function (h) {
        return '<th>' + esc(tr(h)) + '</th>';
      }).join('') + '</tr></thead>'
      + '<tbody>' + rows + '</tbody></table></div></div>';
  }).join('');
}

function rebuildShipUi() {
  buildShips();
  syncShips();
  syncKonter();
}

/* ---------- calculation tabs ---------- */

var LS_TABS = 'pr0fc.tabs.v1';
var MAX_TABS = 12;
var MODE_NAMES = {flight: 'tabFlight', timing: 'tabTiming', retime: 'tabRetime', abort: 'tabAbort'};
var TABS = [];
var activeTab = null;
var tabSeq = 0;
var closedTab = null;

function newTab(state, name) {
  tabSeq += 1;
  return {id: 't' + tabSeq, name: name || null, state: state};
}

function tabAutoName(state) {
  var coords = state.mode === 'retime' ? state.start : state.target;
  return tr(MODE_NAMES[state.mode]) + ' → ' + fmtCoords(coords);
}

/* Key result of a tab (uses the tab's own state). */
function tabSummary(tab) {
  var prev = S;
  S = tab.state;
  try {
    var c = context();
    if (!c.slowest.speed) {
      return null;
    }
    var r = rowFor(c, S.speed);
    var t = r.t;
    if (S.mode === 'flight') {
      return {label: tr('sumArrival'), at: t.arrival};
    }
    if (S.mode === 'timing') {
      return {label: tr('sumSend'), at: t.start, due: true, now: c.now};
    }
    if (S.mode === 'retime') {
      return r.enemyHome !== null ? {label: tr('sumEnemyHome'), at: r.enemyHome} : null;
    }
    if (S.abortKind === 'home') {
      return r.res.recall !== null ? {label: tr('sumRecall'), at: r.res.recall, due: true, now: c.now} : null;
    }
    return r.res.home !== null ? {label: tr('sumBack'), at: r.res.home} : null;
  } finally {
    S = prev;
  }
}

function renderTabs() {
  var html = TABS.map(function (tab) {
    return '<div class="ctab' + (tab === activeTab ? ' active' : '') + '" data-tab="' + tab.id + '">'
      + '<button type="button" class="ctab-main" role="tab" aria-selected="' + (tab === activeTab) + '" title="' + esc(tr('tabRename')) + '">'
      + '<span class="ctab-name"></span><span class="ctab-sum"></span></button>'
      + (TABS.length > 1 ? '<button type="button" class="ctab-close" aria-label="' + esc(tr('tabClose')) + '" title="' + esc(tr('tabClose')) + '">×</button>' : '')
      + '</div>';
  }).join('');
  html += TABS.length < MAX_TABS
    ? '<button type="button" class="ctab-add" id="addTab" title="' + esc(tr('tabNew')) + '" aria-label="' + esc(tr('tabNewAria')) + '">+</button>'
    : '';
  $('#calcTabs').innerHTML = html;
  updateTabs();
}

function updateTabs() {
  TABS.forEach(function (tab) {
    var el = $('#calcTabs [data-tab="' + tab.id + '"]');
    if (!el) {
      return;
    }
    var nameEl = el.querySelector('.ctab-name');
    if (nameEl) {
      nameEl.textContent = tab.name || tabAutoName(tab.state);
    }
    var sum = tabSummary(tab);
    var sumEl = el.querySelector('.ctab-sum');
    sumEl.textContent = sum ? sum.label + ' ' + fmtClock(sum.at) : '—';
    sumEl.classList.toggle('past', !!(sum && sum.due && sum.at < sum.now));
  });
}

function switchTab(tab) {
  activeTab = tab;
  S = tab.state;
  syncAll();
  renderTabs();
  update();
}

function addTab(state, name) {
  if (TABS.length >= MAX_TABS) {
    toast(tr('tabsMax', {n: MAX_TABS}));
    return null;
  }
  var tab = newTab(state, name);
  TABS.splice(TABS.indexOf(activeTab) + 1, 0, tab);
  switchTab(tab);
  var el = $('#calcTabs [data-tab="' + tab.id + '"]');
  if (el && el.scrollIntoView) {
    el.scrollIntoView({block: 'nearest', inline: 'nearest'});
  }
  return tab;
}

function closeTab(tab) {
  if (TABS.length < 2) {
    return;
  }
  var index = TABS.indexOf(tab);
  TABS.splice(index, 1);
  closedTab = {tab: tab, index: index};
  if (tab === activeTab) {
    switchTab(TABS[Math.min(index, TABS.length - 1)]);
  } else {
    renderTabs();
    persist();
  }
  toast(tr('tabClosed'), {label: tr('undo'), fn: function () {
    if (!closedTab || TABS.length >= MAX_TABS) {
      return;
    }
    TABS.splice(Math.min(closedTab.index, TABS.length), 0, closedTab.tab);
    var restored = closedTab.tab;
    closedTab = null;
    switchTab(restored);
  }});
}

function startRename(tab) {
  var el = $('#calcTabs [data-tab="' + tab.id + '"] .ctab-name');
  if (!el) {
    return;
  }
  var input = document.createElement('input');
  input.className = 'ctab-rename';
  input.maxLength = 40;
  input.value = tab.name || tabAutoName(tab.state);
  input.setAttribute('aria-label', tr('tabName'));
  el.replaceWith(input);
  input.focus();
  input.select();
  var done = false;
  function finish(save) {
    if (done) {
      return;
    }
    done = true;
    if (save) {
      var value = input.value.trim();
      tab.name = value && value !== tabAutoName(tab.state) ? value : null;
      persist();
    }
    renderTabs();
  }
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { finish(true); }
    if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
  });
  input.addEventListener('blur', function () { finish(true); });
}

/* Deep copy without shared references between tabs. */
function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function bindTabs() {
  var bar = $('#calcTabs');
  bar.addEventListener('click', function (e) {
    if (e.target.closest('#addTab')) {
      addTab(cloneState(S), null);
      toast(tr('tabCopied'));
      return;
    }
    var box = e.target.closest('[data-tab]');
    if (!box || e.target.closest('.ctab-rename')) {
      return;
    }
    var tab = TABS.filter(function (t) { return t.id === box.dataset.tab; })[0];
    if (e.target.closest('.ctab-close')) {
      closeTab(tab);
    } else if (tab !== activeTab) {
      switchTab(tab);
    }
  });
  bar.addEventListener('dblclick', function (e) {
    var box = e.target.closest('[data-tab]');
    if (box && !e.target.closest('.ctab-close')) {
      startRename(TABS.filter(function (t) { return t.id === box.dataset.tab; })[0]);
    }
  });
}

function loadTabs(now) {
  var saved = load(LS_TABS);
  if (saved && Array.isArray(saved.tabs) && saved.tabs.length) {
    saved.tabs.slice(0, MAX_TABS).forEach(function (t) {
      TABS.push(newTab(mergeSaved(defaultState(now), t.state, now), typeof t.name === 'string' ? t.name : null));
    });
    activeTab = TABS[Math.min(Math.max(0, saved.active | 0), TABS.length - 1)];
    return true;
  }
  /* Migrate the single state of earlier versions. */
  var legacy = load(LS_STATE);
  var state = mergeSaved(defaultState(now), legacy, now);
  if (!legacy) {
    state.ships = {204: 1};
  }
  TABS.push(newTab(state, null));
  activeTab = TABS[0];
  return !!legacy;
}

/* ---------- universe settings ---------- */

function syncUniSummary() {
  var shape = Number(U.uni_type) === 1 ? tr('shapeRingShort') : (Number(U.uni_type) === 2 ? tr('shapeSphereShort') : '');
  $('#uniSummary').textContent = tr('uniSummary', {speed: U.game_speed, gal: U.max_galaxy, shape: shape});
}

function buildUniDialog() {
  var groups = {};
  UNI_FIELDS.forEach(function (f) {
    var html;
    if (f.type === 'shape') {
      html = '<div class="field"><label for="u-' + f.key + '">' + esc(tr(f.label)) + '</label><select id="u-' + f.key + '" data-uni="' + f.key + '">'
        + SHAPES.map(function (s) { return '<option value="' + s[0] + '">' + esc(tr(s[1])) + '</option>'; }).join('') + '</select></div>';
    } else {
      html = '<div class="field"><div class="label-row"><label for="u-' + f.key + '">' + esc(tr(f.label)) + '</label>'
        + (f.hint ? '<button type="button" class="tip" aria-label="' + esc(tr('info')) + '" data-tip="' + esc(tr(f.hint)) + '"></button>' : '') + '</div>'
        + '<input id="u-' + f.key + '" data-uni="' + f.key + '" type="number" step="' + f.step + '"' + (f.min !== undefined ? ' min="' + f.min + '"' : '') + ' inputmode="decimal"></div>';
    }
    (groups[f.group] = groups[f.group] || []).push(html);
  });
  groups.groupClock.push('<p class="clock-compare">' + tr('clockCompare') + '</p>');
  $('#uniFields').innerHTML = Object.keys(groups).map(function (g) {
    return '<fieldset><legend>' + esc(tr(g)) + '</legend>' + groups[g].join('') + '</fieldset>';
  }).join('')
    + '<fieldset class="cships"><legend class="label-row">' + esc(tr('customShips')) + ' <button type="button" class="tip" aria-label="' + esc(tr('info')) + '" data-tip="' + esc(tr('customShipsTip')) + '"></button></legend>'
    + '<div id="customList"></div><button type="button" class="btn" id="addShip">' + esc(tr('addShip')) + '</button></fieldset>';
  renderCustomList();
}

function syncUniDialog() {
  $$('[data-uni]').forEach(function (input) {
    if (document.activeElement !== input) {
      input.value = U[input.dataset.uni];
    }
  });
}

function openSettings() {
  syncUniDialog();
  tickClock();
  var dlg = $('#settings');
  if (typeof dlg.showModal === 'function') {
    dlg.showModal();
  } else {
    dlg.setAttribute('open', '');
  }
}

/* ---------- misc ---------- */

function copy(text, label) {
  copyText(text, label || tr('copied', {text: text}));
}

function tickClock() {
  var now = nowUnix();
  $('#clock').textContent = fmtClock(now);
  var local = $('#clockLocal');
  if (local) {
    local.textContent = fmtClock(Math.floor(Date.now() / 1000));
    $('#clockAdjusted').textContent = fmtClock(now);
  }
}

/* ---------- events ---------- */

function bind() {
  $('.modes').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-mode]');
    if (!btn) { return; }
    S.mode = btn.dataset.mode;
    syncMode();
    syncTimeFields(false);
    update();
  });

  ['start', 'target'].forEach(function (which) {
    var input = $('#' + which + 'In');
    input.addEventListener('input', function () {
      var c = parseCoords(input.value);
      input.classList.toggle('invalid', !c);
      if (c) {
        S[which] = c;
        if (which === 'target') { syncCoordsPlaceholder(); }
        update();
      }
    });
    input.addEventListener('blur', function () {
      input.value = fmtCoords(S[which]);
      input.classList.remove('invalid');
    });
    input.addEventListener('focus', function () { input.select(); });
  });
  $('#swapBtn').addEventListener('click', function () {
    var tmp = S.start;
    S.start = S.target;
    S.target = tmp;
    syncCoords();
    update();
  });

  $('#missionSeg').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-mission]');
    if (!btn) { return; }
    S.mission = btn.dataset.mission;
    if (S.mission === 'expo' && S.target.p <= U.max_planets) {
      S.target = {g: S.start.g, s: S.start.s, p: Number(U.max_planets) + 1};
      syncCoords();
      toast(tr('expoSlot', {coords: fmtCoords(S.target)}));
    }
    syncMission();
    update();
  });
  $('#stayChips').addEventListener('click', function (e) {
    var chip = e.target.closest('[data-stay]');
    if (!chip) { return; }
    S.stay[S.mission] = Number(chip.dataset.stay);
    syncMission();
    update();
  });

  $('#enemyDelayed').addEventListener('change', function () {
    S.enemyDelayed = $('#enemyDelayed').checked;
    if (S.enemyDelayed && (S.enemyOrigArr > S.enemyArr || S.enemyArr - S.enemyOrigArr > 7 * 86400)) {
      S.enemyOrigArr = S.enemyArr;
    }
    syncRetime();
    syncTimeFields(false);
    update();
  });
  $('#outcomeSeg').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-outcome]');
    if (!btn) { return; }
    S.enemyOutcome = btn.dataset.outcome;
    if (S.enemyOutcome === 'recall' && (S.enemyRecall > S.enemyArr || S.enemyArr - S.enemyRecall > 7 * 86400)) {
      S.enemyRecall = Math.min(nowUnix(), S.enemyArr);
    }
    syncRetime();
    syncTimeFields(false);
    update();
  });

  $('#abortKindSeg').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-kind]');
    if (!btn) { return; }
    S.abortKind = btn.dataset.kind;
    syncMode();
    syncTimeFields(false);
    update();
  });

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset.time) {
      var value = parseTimeInput(el.value, nowUnix());
      el.classList.toggle('invalid', value === null && el.value.trim() !== '');
      timeHint(el.dataset.time, value);
      if (value !== null) {
        S[el.dataset.time] = value;
        syncRetime();
        update();
      }
    } else if (el.dataset.ship) {
      var amount = parseAmount(el.value);
      el.classList.toggle('invalid', isNaN(amount));
      S.ships[el.dataset.ship] = isNaN(amount) ? 0 : amount;
      update();
    } else if (el.dataset.tech) {
      S.techs[el.dataset.tech] = Math.max(0, parseInt(el.value, 10) || 0);
      if (el.dataset.tech === 'expedition') { syncMission(); }
      update();
    } else if (el.dataset.ktech) {
      S.konter[el.dataset.ktech] = Math.max(0, parseInt(el.value, 10) || 0);
      update();
    } else if (el.dataset.cs) {
      var custom = SHIP_BY_ID[el.closest('.cship').dataset.cid];
      if (el.dataset.cs === 'name') {
        custom.name = el.value.slice(0, 40) || tr('customShip');
        rebuildShipUi();
      } else {
        custom[el.dataset.cs] = Math.max(0, Number(el.value) || 0);
      }
      update();
    } else if (el.dataset.uni) {
      var v = parseFloat(el.value);
      if (!isNaN(v)) {
        U[el.dataset.uni] = v;
        syncUniSummary();
        if (el.dataset.uni === 'expo_hold_multiplier') { syncMission(); }
        tickClock();
        update();
      }
    }
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el.dataset.liveToggle) {
      var key = el.dataset.liveToggle;
      S[key] = el.checked;
      var timeKey = el.closest('.tf').dataset.key;
      if (!el.checked) {
        S[timeKey] = nowUnix();
      }
      syncTimeFields(false);
      update();
    } else if (el.dataset.uni) {
      U[el.dataset.uni] = parseFloat(el.value) || 0;
      syncUniSummary();
      update();
    }
  });

  document.addEventListener('focusout', function (e) {
    var el = e.target;
    if (el.dataset && el.dataset.time) {
      syncTimeFields(false);
    } else if (el.dataset && el.dataset.ship) {
      var n = Number(S.ships[el.dataset.ship]) || 0;
      el.value = n ? fmtNum(n) : '';
      el.classList.remove('invalid');
    }
  });

  document.addEventListener('click', function (e) {
    var nowBtn = e.target.closest('[data-now]');
    if (nowBtn) {
      var key = nowBtn.dataset.now;
      var liveKey = nowBtn.closest('.tf').dataset.live;
      if (liveKey) {
        S[liveKey] = false;
      }
      S[key] = nowUnix();
      syncTimeFields(false);
      update();
      return;
    }
    var cell = e.target.closest('[data-copy]');
    if (cell) {
      e.stopPropagation();
      copy(cell.dataset.copy);
      return;
    }
    var speedBtn = e.target.closest('#speedSeg [data-speed], #table tbody tr[data-speed]');
    if (speedBtn) {
      S.speed = Number(speedBtn.dataset.speed);
      setPressed('#speedSeg', 'data-speed', S.speed);
      update();
    }
  });

  $$('[data-ship]').forEach(function (input) {
    input.addEventListener('focus', function () { input.select(); });
  });
  $('#clearShips').addEventListener('click', function () {
    S.ships = {};
    syncShips();
    update();
  });

  $('#kStart').addEventListener('input', function () {
    var raw = $('#kStart').value.trim();
    var c = parseCoords(raw);
    $('#kStart').classList.toggle('invalid', !!raw && !c);
    S.konter.start = raw ? c : null;
    if (!raw || c) { update(); }
  });
  $('#kOffset').addEventListener('input', function () {
    S.konter.offset = Math.max(0, parseInt($('#kOffset').value, 10) || 0);
    update();
  });
  $('#kShip').addEventListener('change', function () {
    S.konter.ship = $('#kShip').value;
    update();
  });

  $('#settingsBtn').addEventListener('click', openSettings);
  $('#uniChip').addEventListener('click', openSettings);
  $('#settings').addEventListener('click', function (e) {
    if (e.target === e.currentTarget) {
      e.currentTarget.close();
    }
  });
  $('#settings').addEventListener('close', function () {
    syncMission();
    syncCoords();
    render();
  });
  $('#uniFields').addEventListener('click', function (e) {
    if (e.target.closest('#addShip')) {
      var ship = {id: nextCustomId(), name: tr('customShip') + ' ' + (CUSTOM.length + 1)};
      CUSTOM_FIELDS.forEach(function (key) { ship[key] = 0; });
      ship.speed1 = 10000;
      ship.tech1 = 1;
      ship.consumption1 = 100;
      applyCustom(CUSTOM.concat([ship]));
      renderCustomList();
      rebuildShipUi();
      update();
      var input = $('[data-cid="' + ship.id + '"] [data-cs="name"]');
      input.focus();
      input.select();
      return;
    }
    var del = e.target.closest('[data-cs-del]');
    if (del) {
      var id = del.closest('.cship').dataset.cid;
      applyCustom(CUSTOM.filter(function (c) { return c.id !== id; }));
      delete S.ships[id];
      if (String(S.konter.ship) === id) {
        S.konter.ship = 204;
      }
      renderCustomList();
      rebuildShipUi();
      update();
    }
  });
  $('#uniReset').addEventListener('click', function () {
    var offset = U.clock_offset;
    U = Object.assign({}, DEFAULT_UNI, {clock_offset: offset});
    syncUniDialog();
    syncUniSummary();
    update();
    toast(tr('uniReset'));
  });

  $('#shareBtn').addEventListener('click', function () {
    copy(buildShareUrl(), tr('shared'));
  });
  bindLang(relabel);
  $('#mbar').addEventListener('click', function () {
    $('#results').scrollIntoView({behavior: 'smooth', block: 'start'});
  });

  window.addEventListener('hashchange', function () {
    var state = defaultState(nowUnix());
    if (applyHash(state, parseHash())) {
      clearHash();
      renderCustomList();
      rebuildShipUi();
      addTab(state, null);
      toast(tr('linkNewTab'));
    }
  });
}

function syncCoordsPlaceholder() {
  $('#kStart').placeholder = tr('konterPlaceholder', {coords: fmtCoords(S.target)});
}

/* Language switched: rebuild the generated parts with their texts, keep all inputs. */
function relabel() {
  buildTimeFields();
  buildShips();
  buildUniDialog();
  syncAll();
  renderTabs();
  render();
}

function init() {
  initTexts(TEXTS);
  applyTexts();
  U = Object.assign({}, DEFAULT_UNI, load(LS_UNI) || {});
  applyCustom(load(LS_SHIPS));
  var hadState = loadTabs(nowUnix());
  var linkState = defaultState(nowUnix());
  var fromLink = applyHash(linkState, parseHash());
  if (fromLink) {
    clearHash();
    if (hadState && TABS.length < MAX_TABS) {
      TABS.splice(TABS.indexOf(activeTab) + 1, 0, newTab(linkState, null));
      activeTab = TABS[TABS.indexOf(activeTab) + 1];
    } else {
      activeTab.state = linkState;
    }
  }
  S = activeTab.state;
  buildTimeFields();
  buildShips();
  buildSpeedSeg();
  buildUniDialog();
  bind();
  bindTips();
  bindTabs();
  syncAll();
  renderTabs();
  render();
  persist();
  tickClock();
  if (fromLink) {
    toast(tr(hadState ? 'linkNewTab' : 'linkLoaded'));
  }
  setInterval(function () {
    tickClock();
    syncTimeFields(true);
    render();
  }, 1000);
}

init();
