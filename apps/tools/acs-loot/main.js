/* ACS loot calculator UI. Calculation lives in @pr0hub/loot, glue in ../src/loot.ts. */
import {
  LOOT_SHIPS,
  MAX_HELPER_KEEP,
  MAX_PARTICIPANTS,
  battleFromReport,
  cleanState,
  debrisSummary,
  decodeShare,
  emptyState,
  encodeShare,
  fmtNum,
  fmtShort,
  lootShares,
  newId,
  parseAmount,
  recyclingFromReports,
  remaining,
  settle,
  shipName,
} from '../src/loot.ts';
import { TEXTS } from './i18n.js';
import { $, $$, applyTexts, bindLang, bindShare, bindTips, clearHash, copy, esc, initTexts, load, store, t } from '../shared/shell.js';

var LS_STATE = 'pr0loot.state.v1';
var RES = ['m', 'k', 'd'];

var S = emptyState();
var LANG = 'de';
var lastResult = null;
var pasteText = {};
/* per battle: we were the attackers or the defenders (a hold) */
var pasteSide = {};
var reportMsg = {};
/* pasted recycling reports: the text, who recycled, and the result of the last apply */
var recyclePaste = {text: '', by: null, msg: null};

/* ---------- helpers ---------- */

function num(n) { return fmtNum(n || 0, LANG); }
function signed(n) {
  var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : 'dim';
  return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + num(n) + '</span>';
}

function personName(id) {
  var p = S.participants.concat(S.helpers).find(function (x) { return x.id === id; });
  return p ? (p.name || '?') : '?';
}

function people() {
  return S.participants.map(function (p) { return {id: p.id, name: p.name, helper: false}; })
    .concat(S.helpers.map(function (h) { return {id: h.id, name: h.name, helper: true}; }));
}

/* Path helpers: "battles.0.fleets.1.start.207" */
function getPath(path) {
  return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, S);
}
function setPath(path, value) {
  var keys = path.split('.');
  var o = S;
  for (var i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null) o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

function amountInput(path, value, extra) {
  return '<input class="num" inputmode="decimal" autocomplete="off" data-bind="' + path + '" data-type="amount" value="' +
    (value ? num(value) : '') + '"' + (extra || '') + '>';
}

/* ---------- state ---------- */

function fleetOf(battle, pid) {
  var f = battle.fleets.find(function (x) { return x.participant === pid; });
  if (!f) {
    f = {participant: pid, start: {}, end: {}};
    battle.fleets.push(f);
  }
  return f;
}

function battleShips(battle) {
  var ids = {};
  battle.fleets.forEach(function (f) { Object.keys(f.start).forEach(function (id) { ids[id] = true; }); });
  return Object.keys(ids).map(Number).sort(function (a, b) { return a - b; });
}

function persist() {
  clearTimeout(persist.timer);
  persist.timer = setTimeout(function () { store(LS_STATE, S); }, 250);
}

/* ---------- build: input cards ---------- */

function buildSettings() {
  var s = S.settings;
  var ref = s.refRates || {m: '', k: ''};
  $('#settings').innerHTML =
    '<div class="card-title">' + esc(t('settings')) + '</div>' +
    '<div class="stack">' +
    '<div class="field"><span class="field-label">' + esc(t('mode')) + '</span>' +
    '<div class="seg" role="group">' +
    '<button type="button" data-act="mode" data-mode="equal" aria-pressed="' + (s.mode === 'equal') + '">' + esc(t('modeEqual')) + '</button>' +
    '<button type="button" data-act="mode" data-mode="investment" aria-pressed="' + (s.mode === 'investment') + '">' + esc(t('modeInvest')) + '</button>' +
    '</div><span class="hint">' + esc(t('modeHint')) + '</span></div>' +
    '<div class="field"><span class="field-label">' + esc(t('rates')) + '</span><div class="grid2">' +
    rateField('settings.rates.m', s.rates.m, t('rateM')) + rateField('settings.rates.k', s.rates.k, t('rateK')) +
    '</div><span class="hint">' + esc(t('ratesHint')) + '</span></div>' +
    '<div class="field"><span class="field-label">' + esc(t('refRates')) + '</span><div class="grid2">' +
    rateField('settings.refRates.m', ref.m, t('rateM')) + rateField('settings.refRates.k', ref.k, t('rateK')) +
    '</div><span class="hint">' + esc(t('refHint')) + '</span></div>' +
    '<div class="grid2">' +
    '<div class="field"><label for="deficit">' + esc(t('deficit')) + '</label>' +
    '<input id="deficit" class="num" inputmode="numeric" data-bind="settings.deficitMetalShare" data-type="share" value="' +
    Math.round(s.deficitMetalShare * 100) + '"><span class="hint">' + esc(t('deficitMetal')) + '</span></div>' +
    '<div class="field"><span class="field-label">' + esc(t('cargo')) + '</span><div class="seg" role="group">' +
    [202, 203].map(function (id) {
      return '<button type="button" data-act="cargo" data-ship="' + id + '" aria-pressed="' + (s.cargoShip === id) + '">' + esc(shipName(id, LANG, true)) + '</button>';
    }).join('') +
    '</div></div></div>' +
    '<span class="hint">' + esc(t('deficitHint')) + '</span>' +
    '</div>';
}

function rateField(path, value, label) {
  return '<div class="field"><label>' + esc(label) + '</label><input class="num" inputmode="decimal" data-bind="' + path +
    '" data-type="rate" value="' + esc(value === '' || value == null ? '' : String(value).replace('.', LANG === 'de' ? ',' : '.')) + '"></div>';
}

function buildParticipants() {
  var rows = S.participants.map(function (p, i) {
    var base = 'participants.' + i + '.';
    return '<tr>' +
      '<td><input data-bind="' + base + 'name" data-type="text" value="' + esc(p.name) + '" placeholder="' + esc(t('name')) + '"></td>' +
      '<td>' + amountInput(base + 'flightDeut', p.flightDeut) + '</td>' +
      '<td>' + amountInput(base + 'recDeut', p.recDeut) + '</td>' +
      '<td>' + amountInput(base + 'missiles', p.missiles) + '</td>' +
      '<td><button type="button" class="x" data-act="delParticipant" data-i="' + i + '" title="' + esc(t('remove')) + '">✕</button></td>' +
      '</tr>';
  }).join('');
  $('#participants').innerHTML =
    '<div class="card-title">' + esc(t('participants')) + '<span class="spacer"></span><span class="hint">' + S.participants.length + ' / ' + MAX_PARTICIPANTS + '</span></div>' +
    '<p class="card-hint">' + esc(t('participantsHint')) + '</p>' +
    (rows ? '<div class="table-wrap"><table><thead><tr><th>' + esc(t('name')) + '</th><th>' + esc(t('flightDeut')) + '</th><th>' +
      esc(t('recDeut')) + '</th><th>' + esc(t('missiles')) + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '') +
    '<div class="row-actions"><button type="button" class="btn" data-act="addParticipant"' +
    (S.participants.length >= MAX_PARTICIPANTS ? ' disabled' : '') + '>' + esc(t('addParticipant')) + '</button></div>';
}

function buildHelpers() {
  var deut = !!S.settings.helperDeut;
  var rows = S.helpers.map(function (h, i) {
    var base = 'helpers.' + i + '.';
    return '<tr>' +
      '<td><input data-bind="' + base + 'name" data-type="text" value="' + esc(h.name) + '" placeholder="' + esc(t('name')) + '"></td>' +
      '<td><input class="num" inputmode="decimal" data-bind="' + base + 'keepPct" data-type="pct" value="' + esc(h.keepPct) + '"></td>' +
      (deut ? '<td>' + amountInput(base + 'recDeut', h.recDeut) + '</td>' : '') +
      '<td><button type="button" class="x" data-act="delHelper" data-i="' + i + '" title="' + esc(t('remove')) + '">✕</button></td>' +
      '</tr>';
  }).join('');
  $('#helpers').innerHTML =
    '<div class="card-title">' + esc(t('helpers')) + '</div>' +
    '<p class="card-hint">' + esc(t('helpersHint')) + '</p>' +
    '<div class="field" style="margin-bottom:12px"><span class="field-label">' + esc(t('helperDeut')) + '</span>' +
    '<div class="seg" role="group">' +
    '<button type="button" data-act="helperDeut" data-on="0" aria-pressed="' + !deut + '">' + esc(t('helperDeutOff')) + '</button>' +
    '<button type="button" data-act="helperDeut" data-on="1" aria-pressed="' + deut + '">' + esc(t('helperDeutOn')) + '</button>' +
    '</div><span class="hint">' + esc(t('helperDeutHint')) + '</span></div>' +
    (rows ? '<div class="table-wrap"><table><thead><tr><th>' + esc(t('name')) + '</th><th>' + esc(t('keepPct')) + '</th>' +
      (deut ? '<th>' + esc(t('recDeut')) + '</th>' : '') + '<th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '') +
    '<div class="row-actions"><button type="button" class="btn" data-act="addHelper">' + esc(t('addHelper')) + '</button></div>';
}

function buildBattles() {
  var html = S.battles.map(function (b, bi) {
    var ships = battleShips(b);
    var parts = S.participants;
    var head = '<tr><th>' + esc(t('ship')) + '</th>' + parts.map(function (p) {
      return '<th class="group" colspan="2">' + esc(p.name || '?') + '</th>';
    }).join('') + '</tr><tr><th></th>' + parts.map(function () {
      return '<th class="gl">' + esc(t('sent')) + '</th><th>' + esc(t('lost')) + '</th>';
    }).join('') + '</tr>';
    var body = ships.map(function (id) {
      return '<tr><td class="name">' + esc(shipName(id, LANG)) + '</td>' + parts.map(function (p) {
        var f = b.fleets.find(function (x) { return x.participant === p.id; }) || {start: {}, end: {}};
        var start = f.start[id] || 0;
        var lost = Math.max(0, start - (f.end[id] || 0));
        var base = 'battles.' + bi + '.' + p.id + '.' + id;
        return '<td class="gl"><input class="num" inputmode="numeric" data-bind="' + base + '" data-type="sent" value="' + (start ? num(start) : '') + '"></td>' +
          '<td><input class="num" inputmode="numeric" data-bind="' + base + '" data-type="lost" value="' + (lost ? num(lost) : '') + '"></td>';
      }).join('') + '</tr>';
    }).join('');
    var lootRow = '<tr><td class="name">' + esc(t('lootOf')) + ' (' + esc(t('m')) + ' / ' + esc(t('k')) + ' / ' + esc(t('d')) + ')</td>' +
      parts.map(function (p) {
        var f = b.fleets.find(function (x) { return x.participant === p.id; });
        return '<td class="gl" colspan="2"><div class="grid3">' + RES.map(function (r) {
          return '<input class="num" inputmode="numeric" data-bind="battles.' + bi + '.' + p.id + '.' + r + '" data-type="loot" data-loot-of="' +
            bi + ':' + p.id + ':' + r + '" value="' + (f && f.loot ? num(f.loot[r]) : '') + '" title="' + esc(t('lootOverride')) + '">';
        }).join('') + '</div></td>';
      }).join('') + '</tr>';
    var options = LOOT_SHIPS.filter(function (id) { return ships.indexOf(id) < 0; }).map(function (id) {
      return '<option value="' + id + '">' + esc(shipName(id, LANG)) + '</option>';
    }).join('');
    var when = b.time ? new Date(b.time * 1000).toLocaleString(LANG === 'de' ? 'de-DE' : 'en-GB') : '';
    var msg = reportMsg[bi];
    return '<div class="sub">' +
      '<div class="sub-title">' + esc(t('battle')) + ' ' + (bi + 1) + (when ? ' <span class="meta">' + esc(when) + '</span>' : '') +
      '<span class="spacer"></span><button type="button" class="x" data-act="delBattle" data-i="' + bi + '" title="' + esc(t('remove')) + '">✕</button></div>' +
      '<div class="stack">' +
      '<div class="field"><label>' + esc(t('paste')) + '</label><textarea data-paste="' + bi + '" placeholder="' + esc(t('pastePlaceholder')) + '">' +
      esc(pasteText[bi] || '') + '</textarea>' +
      '<div class="row-actions" style="margin-top:6px">' +
      '<div class="seg small" role="group">' +
      '<button type="button" data-act="pasteSide" data-i="' + bi + '" data-side="attacker" aria-pressed="' + (pasteSide[bi] !== 'defender') + '">' + esc(t('sideAttacker')) + '</button>' +
      '<button type="button" data-act="pasteSide" data-i="' + bi + '" data-side="defender" aria-pressed="' + (pasteSide[bi] === 'defender') + '">' + esc(t('sideDefender')) + '</button>' +
      '</div>' +
      '<button type="button" class="btn small" data-act="applyReport" data-i="' + bi + '">' + esc(t('apply')) + '</button>' +
      (msg ? '<span class="hint ' + (msg.ok ? 'ok' : 'err') + '">' + esc(msg.text) + '</span>' : '') + '</div></div>' +
      '<div class="field"><span class="field-label">' + esc(t('loot')) + '</span><div class="grid3">' +
      RES.map(function (r) {
        return '<div class="field"><label>' + esc(t(r === 'm' ? 'metal' : r === 'k' ? 'crystal' : 'deut')) + '</label>' +
          amountInput('battles.' + bi + '.loot.' + r, b.loot[r]) + '</div>';
      }).join('') + '</div></div>' +
      (parts.length
        ? '<div class="table-wrap"><table><thead>' + head + '</thead><tbody>' + body + lootRow + '</tbody></table></div>' +
          '<div class="row-actions"><select class="input" style="width:auto" data-add-ship="' + bi + '"><option value="">' + esc(t('addShip')) + '</option>' + options + '</select></div>'
        : '<p class="hint">' + esc(t('noParticipants')) + '</p>') +
      '</div></div>';
  }).join('');
  $('#battles').innerHTML =
    '<div class="card-title">' + esc(t('battles')) + '</div>' +
    '<p class="card-hint">' + esc(t('battlesHint')) + '</p>' + html +
    '<div class="row-actions"><button type="button" class="btn" data-act="addBattle">' + esc(t('addBattle')) + '</button></div>';
}

function personOptions(selected) {
  return people().map(function (p) {
    return '<option value="' + esc(p.id) + '"' + (p.id === selected ? ' selected' : '') + '>' + esc(p.name || '?') +
      (p.helper ? ' (' + esc(t('helper')) + ')' : '') + '</option>';
  }).join('');
}

function buildRecycling() {
  var rows = S.recycling.map(function (r, i) {
    var base = 'recycling.' + i + '.';
    return '<tr><td><select data-bind="' + base + 'by" data-type="text">' + personOptions(r.by) + '</select></td>' +
      '<td>' + amountInput(base + 'm', r.m, ' placeholder="' + esc(t('metal')) + '" aria-label="' + esc(t('metal')) + '"') + '</td>' +
      '<td>' + amountInput(base + 'k', r.k, ' placeholder="' + esc(t('crystal')) + '" aria-label="' + esc(t('crystal')) + '"') + '</td>' +
      '<td><button type="button" class="x" data-act="delRecycling" data-i="' + i + '" title="' + esc(t('remove')) + '">✕</button></td></tr>';
  }).join('');
  $('#recycling').innerHTML =
    '<div class="card-title">' + esc(t('recycling')) + '</div>' +
    '<p class="card-hint">' + esc(t('recyclingHint')) + '</p>' +
    '<div id="debrisSummary" class="debris-summary"></div>' +
    (rows ? '<div class="table-wrap"><table class="stack-table"><thead><tr><th>' + esc(t('by')) + '</th><th>' + esc(t('metal')) + '</th><th>' +
      esc(t('crystal')) + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '') +
    '<div class="row-actions"><button type="button" class="btn" data-act="addRecycling"' + (people().length ? '' : ' disabled') + '>' +
    esc(t('addRecycling')) + '</button></div>' + recyclePasteField();
}

/* Pasting recycling reports adds a row per report for the chosen person. */
function recyclePasteField() {
  if (!people().length) return '';
  if (!people().some(function (p) { return p.id === recyclePaste.by; })) recyclePaste.by = people()[0].id;
  var msg = recyclePaste.msg;
  return '<div class="field" style="margin-top:10px"><label>' + esc(t('pasteRecycling')) + '</label>' +
    '<textarea data-paste-recycling placeholder="' + esc(t('pasteRecyclingPlaceholder')) + '">' + esc(recyclePaste.text) + '</textarea>' +
    '<div class="row-actions" style="margin-top:6px">' +
    '<select class="input" style="width:auto" data-recycle-by aria-label="' + esc(t('by')) + '">' + personOptions(recyclePaste.by) + '</select>' +
    '<button type="button" class="btn small" data-act="applyRecycling">' + esc(t('apply')) + '</button>' +
    (msg ? '<span class="hint ' + (msg.ok ? 'ok' : 'err') + '">' + esc(msg.text) + '</span>' : '') + '</div></div>';
}

function buildInputs() {
  buildSettings();
  buildParticipants();
  buildBattles();
  buildRecycling();
  buildHelpers();
}

/* ---------- render: results ---------- */

function resCell(r, fmt) {
  return '<td>' + RES.map(function (k) { return '<div>' + (fmt || num)(r[k]) + '</div>'; }).join('') + '</td>';
}

function renderResults(r) {
  var notes = [];
  if (r.warnings.indexOf('too_many_participants') >= 0) notes.push('<div class="note err">' + esc(t('tooMany')) + '</div>');
  if (r.coverage < 1) notes.push('<div class="note warn">' + esc(t('notCovered')) + '</div>');
  if (r.rateWarnings.length) {
    notes.push('<div class="note warn">' + esc(t('rateWarning') + r.rateWarnings.map(function (k) { return t(k === 'm' ? 'metal' : 'crystal'); }).join(', ')) + '</div>');
  }
  if (r.deadline) {
    notes.push('<div class="note">' + esc(t('deadline')) + ': <b>' +
      esc(new Date(r.deadline * 1000).toLocaleString(LANG === 'de' ? 'de-DE' : 'en-GB')) + '</b> · ' + esc(t('deadlineHint')) + '</div>');
  }
  var kpi = function (label, res, big) {
    return '<div class="kpi' + (big ? ' big' : '') + '"><span class="kpi-label">' + esc(label) + '</span>' +
      '<span class="kpi-value">' + num(res.m + res.k + res.d) + '</span>' +
      '<span class="kpi-sub">' + esc(t('m')) + ' ' + fmtShort(res.m, LANG) + ' · ' + esc(t('k')) + ' ' + fmtShort(res.k, LANG) + ' · ' +
      esc(t('d')) + ' ' + fmtShort(res.d, LANG) + '</span></div>';
  };
  var rows = r.people.map(function (p) {
    return '<tr><td class="name">' + esc(p.name || '?') + (p.role === 'helper' ? '<span class="tag">' + esc(t('helper')) + '</span>' : '') +
      '<div class="hint mono">' + (p.role === 'participant' ? Math.round(p.share * 1000) / 10 + ' %' : '') + '</div></td>' +
      '<td class="dim">' + RES.map(function (k) { return '<div>' + esc(t(k)) + '</div>'; }).join('') + '</td>' +
      resCell(p.holds) + resCell(p.costs) + resCell(p.covered) + resCell(p.entitled) + resCell(p.balance, signed) + '</tr>';
  }).join('');
  $('#results').innerHTML =
    '<div class="card-title">' + esc(t('results')) + '</div>' +
    '<div class="hero">' + kpi(t('totalLoot'), r.loot) + kpi(t('recycled'), r.recycled) + kpi(t('costs'), r.costs) + kpi(t('profit'), r.profit, true) +
    '<div class="kpi"><span class="kpi-label">' + esc(t('coverage')) + '</span><span class="kpi-value">' + Math.round(r.coverage * 1000) / 10 +
    ' %</span><span class="kpi-sub">' + esc(t('valueDeut')) + ' ' + fmtShort(Math.round(r.value.profit), LANG) + '</span></div></div>' +
    '<div class="notes">' + notes.join('') + '</div>' +
    (rows ? '<div class="table-wrap"><table><thead><tr><th>' + esc(t('person')) + '</th><th></th><th>' + esc(t('holds')) + '</th><th>' +
      esc(t('costs')) + '</th><th>' + esc(t('covered')) + '</th><th>' + esc(t('entitled')) + '</th><th title="' + esc(t('balanceHint')) + '">' +
      esc(t('balance')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '');
}

function currentTransfers(r) {
  return S.transfers || r.transfers.map(function (x) { return {from: x.from, to: x.to, res: {m: x.res.m, k: x.res.k, d: x.res.d}}; });
}

function cargoShips(res) {
  var cap = S.settings.cargoShip === 202 ? 5000 : 25000;
  var total = res.m + res.k + res.d;
  return total > 0 ? Math.ceil(total / cap) : 0;
}

function transferText(list) {
  var cargo = shipName(S.settings.cargoShip, LANG, true);
  return list.filter(function (x) { return x.res.m + x.res.k + x.res.d > 0; }).map(function (x) {
    var parts = RES.filter(function (k) { return x.res[k] > 0; }).map(function (k) {
      return fmtShort(x.res[k], LANG) + ' ' + t(k === 'm' ? 'metal' : k === 'k' ? 'crystal' : 'deut');
    });
    return personName(x.from) + ' ' + t('sends') + ' ' + parts.join(', ') + ' ' + t('toWord') + ' ' + personName(x.to) +
      ' (' + cargoShips(x.res) + ' ' + cargo + ')';
  }).join('\n');
}

function renderTransfers(r) {
  var list = currentTransfers(r);
  var rows = list.map(function (x, i) {
    var base = 'transfers.' + i + '.';
    return '<tr><td><select data-bind="' + base + 'from" data-type="transfer">' + personOptions(x.from) + '</select></td>' +
      '<td><select data-bind="' + base + 'to" data-type="transfer">' + personOptions(x.to) + '</select></td>' +
      RES.map(function (k) {
        return '<td><input class="num" inputmode="numeric" data-bind="' + base + 'res.' + k + '" data-type="transfer" value="' + (x.res[k] ? num(x.res[k]) : '') + '"></td>';
      }).join('') +
      '<td class="dim" data-ships="' + i + '">' + cargoShips(x.res) + '</td>' +
      '<td><button type="button" class="x" data-act="delTransfer" data-i="' + i + '" title="' + esc(t('remove')) + '">✕</button></td></tr>';
  }).join('');
  $('#transfers').innerHTML =
    '<div class="card-title">' + esc(t('transfers')) + '<span class="hint" style="text-transform:none;letter-spacing:0">' +
    esc(S.transfers ? t('edited') : t('suggestion')) + '</span><span class="spacer"></span>' +
    (S.transfers ? '<button type="button" class="btn small" data-act="useSuggestion">' + esc(t('useSuggestion')) + '</button>' : '') + '</div>' +
    '<p class="card-hint">' + esc(t('transfersHint')) + '</p>' +
    (rows ? '<div class="table-wrap"><table><thead><tr><th>' + esc(t('from')) + '</th><th>' + esc(t('to')) + '</th><th>' + esc(t('metal')) + '</th><th>' +
      esc(t('crystal')) + '</th><th>' + esc(t('deut')) + '</th><th>' + esc(t('ships')) + '</th><th></th></tr></thead><tbody>' + rows +
      '</tbody></table></div>' : '<p class="hint">' + esc(t('noTransfers')) + '</p>') +
    '<div class="row-actions"><button type="button" class="btn" data-act="addTransfer"' + (people().length > 1 ? '' : ' disabled') + '>' +
    esc(t('addTransfer')) + '</button><button type="button" class="btn" data-act="copyText"' + (rows ? '' : ' disabled') + '>' + esc(t('copyText')) + '</button></div>' +
    '<div id="openBox"></div>' +
    (rows ? '<pre class="text" id="transferText">' + esc(transferText(list)) + '</pre>' : '');
  renderOpen(r);
}

function renderOpen(r) {
  var list = currentTransfers(r);
  var left = remaining(r.people.map(function (p) { return {id: p.id, balance: p.balance}; }), list);
  var open = r.people.filter(function (p) {
    var x = left.get(p.id);
    return x && (x.m || x.k || x.d);
  });
  var box = $('#openBox');
  if (!box) return;
  if (!r.people.length) { box.innerHTML = ''; return; }
  box.innerHTML = open.length
    ? '<div class="note warn" style="margin-top:10px">' + esc(t('notSettled')) + '</div><div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>' +
      esc(t('open')) + '</th><th>' + esc(t('metal')) + '</th><th>' + esc(t('crystal')) + '</th><th>' + esc(t('deut')) + '</th></tr></thead><tbody>' +
      open.map(function (p) {
        var x = left.get(p.id);
        return '<tr><td class="name">' + esc(p.name || '?') + '</td><td>' + signed(x.m) + '</td><td>' + signed(x.k) + '</td><td>' + signed(x.d) + '</td></tr>';
      }).join('') + '</tbody></table></div>'
    : '<div class="note" style="margin-top:10px"><span class="pos">✓</span> ' + esc(t('allSettled')) + '</div>';
}

/* Computed loot shares as placeholders of the loot inputs. */
function renderLootHints() {
  S.battles.forEach(function (b, bi) {
    var shares = lootShares(b);
    RES.forEach(function (k) {
      S.participants.forEach(function (p) {
        var el = $('[data-loot-of="' + bi + ':' + p.id + ':' + k + '"]');
        var s = shares.get(p.id);
        if (el) el.placeholder = s ? num(s[k]) : '';
      });
    });
  });
}

/* The state without blank rows (no name and nothing entered), which would otherwise get a share. */
function activeState() {
  var used = {};
  S.battles.forEach(function (b) {
    b.fleets.forEach(function (f) {
      if (Object.keys(f.start).some(function (id) { return f.start[id] > 0; }) || f.loot) used[f.participant] = true;
    });
  });
  S.recycling.forEach(function (r) { if (r.m || r.k) used[r.by] = true; });
  var keep = function (p) { return p.name || used[p.id] || p.flightDeut || p.recDeut || p.missiles; };
  return Object.assign({}, S, {participants: S.participants.filter(keep), helpers: S.helpers.filter(keep)});
}

function render() {
  lastResult = settle(activeState());
  renderResults(lastResult);
  renderTransfers(lastResult);
  renderLootHints();
  renderDebris();
}

/* Debris field: how much was recycled, what is left, and what others took of an emptied field. */
function renderDebris() {
  var el = $('#debrisSummary');
  if (!el) return;
  var d = debrisSummary(S);
  var res = function (x) { return num(x.m) + ' ' + t('metal') + ' · ' + num(x.k) + ' ' + t('crystal'); };
  var lines = [];
  if (d.field) lines.push('<span class="meta">' + esc(t('debrisField')) + '</span> ' + esc(res(d.field)));
  if (d.field || d.left) {
    lines.push('<span class="meta">' + esc(t('debrisRecycled')) + '</span> ' + esc(res(d.recycled)) +
      (d.share != null ? ' (' + Math.round(d.share * 100) + ' %)' : ''));
  }
  if (d.left) lines.push('<span class="meta">' + esc(t('debrisLeft')) + '</span> ' + esc(d.empty ? t('debrisEmpty') : res(d.left)));
  if (d.taken) lines.push('<span class="err">' + esc(t('debrisTaken')) + ' ' + esc(res(d.taken)) + '</span>');
  el.innerHTML = lines.map(function (l) { return '<div>' + l + '</div>'; }).join('');
}

function update() {
  persist();
  render();
}

/* ---------- events ---------- */

function parseRate(raw) {
  var n = parseFloat(String(raw).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function onInput(el) {
  var path = el.getAttribute('data-bind');
  var type = el.getAttribute('data-type');
  var raw = el.value;
  if (type === 'text') {
    setPath(path, raw);
    if (/\.name$/.test(path)) { buildBattles(); buildRecycling(); }
    update();
    return;
  }
  if (type === 'rate') {
    var r = parseRate(raw);
    el.classList.toggle('invalid', raw !== '' && r == null);
    if (/^settings\.refRates/.test(path)) {
      if (!S.settings.refRates) S.settings.refRates = {m: S.settings.rates.m, k: S.settings.rates.k, d: 1};
      if (r != null) setPath(path, r);
      var m = $('[data-bind="settings.refRates.m"]').value;
      var k = $('[data-bind="settings.refRates.k"]').value;
      if (!m && !k) S.settings.refRates = null;
    } else if (r != null) {
      setPath(path, r);
    }
    update();
    return;
  }
  if (type === 'share' || type === 'pct') {
    var v = parseFloat(String(raw).replace(',', '.'));
    // helpers keep at most 20 % by the game rules
    v = Number.isFinite(v) ? Math.min(type === 'pct' ? MAX_HELPER_KEEP : 100, Math.max(0, v)) : 0;
    setPath(path, type === 'share' ? v / 100 : v);
    update();
    return;
  }
  var n = raw.trim() === '' ? 0 : parseAmount(raw);
  el.classList.toggle('invalid', !Number.isFinite(n));
  if (!Number.isFinite(n)) return;
  if (type === 'sent' || type === 'lost' || type === 'loot') {
    var parts = path.split('.');
    var battle = S.battles[Number(parts[1])];
    var f = fleetOf(battle, parts[2]);
    if (type === 'loot') {
      var key = parts[3];
      var cur = f.loot || {m: 0, k: 0, d: 0};
      cur[key] = n;
      var inputs = RES.map(function (k) { return $('[data-loot-of="' + parts[1] + ':' + parts[2] + ':' + k + '"]'); });
      var empty = inputs.every(function (x) { return !x || x.value.trim() === ''; });
      if (empty) delete f.loot; else f.loot = cur;
    } else {
      var id = Number(parts[3]);
      var start = f.start[id] || 0;
      var lost = Math.max(0, start - (f.end[id] || 0));
      if (type === 'sent') { start = n; } else { lost = n; }
      f.start[id] = start;
      f.end[id] = Math.max(0, start - lost);
    }
    update();
    return;
  }
  if (type === 'transfer') {
    if (!S.transfers) S.transfers = currentTransfers(lastResult);
    setPath(path, n);
    var row = $('[data-ships="' + path.split('.')[1] + '"]');
    if (row) row.textContent = cargoShips(S.transfers[Number(path.split('.')[1])].res);
    persist();
    var pre = $('#transferText');
    if (pre) pre.textContent = transferText(S.transfers);
    renderOpen(lastResult);
    return;
  }
  setPath(path, n);
  update();
}

function onChange(el) {
  if (el.matches('select[data-add-ship]')) {
    var id = Number(el.value);
    if (!id) return;
    var b = S.battles[Number(el.getAttribute('data-add-ship'))];
    S.participants.forEach(function (p) {
      var f = fleetOf(b, p.id);
      if (f.start[id] == null) { f.start[id] = 0; f.end[id] = 0; }
    });
    buildBattles();
    update();
    return;
  }
  if (el.matches('select[data-type="transfer"]')) {
    if (!S.transfers) S.transfers = currentTransfers(lastResult);
    setPath(el.getAttribute('data-bind'), el.value);
    persist();
    renderTransfers(lastResult);
    return;
  }
  if (el.matches('select[data-recycle-by]')) { recyclePaste.by = el.value; return; }
  if (el.matches('select[data-bind]')) onInput(el);
}

var ACTIONS = {
  mode: function (el) { S.settings.mode = el.getAttribute('data-mode'); buildSettings(); },
  helperDeut: function (el) { S.settings.helperDeut = el.getAttribute('data-on') === '1'; buildHelpers(); },
  cargo: function (el) { S.settings.cargoShip = Number(el.getAttribute('data-ship')); buildSettings(); },
  addParticipant: function () {
    if (S.participants.length >= MAX_PARTICIPANTS) return;
    S.participants.push({id: newId(S, 'p'), name: '', flightDeut: 0, recDeut: 0, missiles: 0});
    buildInputs();
  },
  delParticipant: function (el) { removePerson(S.participants.splice(Number(el.getAttribute('data-i')), 1)[0]); },
  addHelper: function () {
    S.helpers.push({id: newId(S, 'h'), name: '', keepPct: MAX_HELPER_KEEP, recDeut: 0});
    buildInputs();
  },
  delHelper: function (el) { removePerson(S.helpers.splice(Number(el.getAttribute('data-i')), 1)[0]); },
  addBattle: function () {
    S.battles.push({time: null, loot: {m: 0, k: 0, d: 0}, fleets: []});
    buildBattles();
  },
  delBattle: function (el) {
    var i = Number(el.getAttribute('data-i'));
    S.battles.splice(i, 1);
    pasteText = {};
    pasteSide = {};
    reportMsg = {};
    buildBattles();
  },
  pasteSide: function (el) {
    pasteSide[el.getAttribute('data-i')] = el.getAttribute('data-side');
    buildBattles();
  },
  applyReport: function (el) {
    var i = Number(el.getAttribute('data-i'));
    var res = battleFromReport(S, pasteText[i] || '', pasteSide[i] === 'defender' ? 'defender' : 'attacker');
    if (!res.ok) {
      reportMsg[i] = {ok: false, text: t('reportFailed')};
    } else {
      S.battles[i] = res.battle;
      pasteText[i] = '';
      reportMsg[i] = res.skipped.length ? {ok: false, text: t('reportSkipped') + res.skipped.join(', ')} : {ok: true, text: '✓'};
    }
    buildInputs();
  },
  addRecycling: function () {
    var first = people()[0];
    if (!first) return;
    S.recycling.push({by: first.id, m: 0, k: 0});
    buildRecycling();
  },
  applyRecycling: function () {
    var rows = recyclingFromReports(recyclePaste.text);
    if (!rows.length) {
      recyclePaste.msg = {ok: false, text: t('recyclingFailed')};
    } else {
      rows.forEach(function (r) { S.recycling.push({by: recyclePaste.by, m: r.m, k: r.k, field: r.field}); });
      recyclePaste.text = '';
      recyclePaste.msg = {ok: true, text: '✓ ' + rows.length};
    }
    buildRecycling();
  },
  delRecycling: function (el) { S.recycling.splice(Number(el.getAttribute('data-i')), 1); buildRecycling(); },
  useSuggestion: function () { S.transfers = null; },
  addTransfer: function () {
    if (!S.transfers) S.transfers = currentTransfers(lastResult);
    var list = people();
    S.transfers.push({from: list[0].id, to: list[1].id, res: {m: 0, k: 0, d: 0}});
  },
  delTransfer: function (el) {
    if (!S.transfers) S.transfers = currentTransfers(lastResult);
    S.transfers.splice(Number(el.getAttribute('data-i')), 1);
  },
  copyText: function () { copy(transferText(currentTransfers(lastResult)), t('copied')); }
};

function removePerson(p) {
  if (!p) return;
  S.battles.forEach(function (b) { b.fleets = b.fleets.filter(function (f) { return f.participant !== p.id; }); });
  S.recycling = S.recycling.filter(function (r) { return r.by !== p.id; });
  if (S.transfers) S.transfers = S.transfers.filter(function (x) { return x.from !== p.id && x.to !== p.id; });
  buildInputs();
}

function bind() {
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.matches('textarea[data-paste]')) { pasteText[el.getAttribute('data-paste')] = el.value; return; }
    if (el.matches('textarea[data-paste-recycling]')) { recyclePaste.text = el.value; return; }
    if (el.matches('input[data-bind]')) onInput(el);
  });
  document.addEventListener('change', function (e) { onChange(e.target); });
  document.addEventListener('focusout', function (e) {
    var el = e.target;
    if (el.matches('input[data-type="amount"], input[data-type="sent"], input[data-type="lost"], input[data-type="loot"], input[data-type="transfer"]')) {
      var n = parseAmount(el.value);
      if (Number.isFinite(n) && el.value.trim() !== '') el.value = n ? num(n) : '';
    }
  });
  document.addEventListener('paste', function (e) {
    var el = e.target;
    if (el.matches && el.matches('textarea[data-paste-recycling]')) {
      setTimeout(function () {
        recyclePaste.text = el.value;
        ACTIONS.applyRecycling();
        update();
      }, 0);
      return;
    }
    if (!el.matches || !el.matches('textarea[data-paste]')) return;
    setTimeout(function () {
      pasteText[el.getAttribute('data-paste')] = el.value;
      ACTIONS.applyReport(el.closest('.sub').querySelector('[data-act="applyReport"]'));
      update();
    }, 0);
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (el && ACTIONS[el.getAttribute('data-act')]) {
      ACTIONS[el.getAttribute('data-act')](el);
      update();
      return;
    }
  });
  bindLang(function (lang) {
    LANG = lang;
    buildInputs();
    render();
  });
  bindShare(function () {
    return location.href.split('#')[0] + '#s=' + encodeShare(cleanState(S));
  });
  $('#resetBtn').addEventListener('click', function () {
    if (!window.confirm(t('resetConfirm'))) return;
    S = emptyState();
    pasteText = {};
    recyclePaste = {text: '', by: null, msg: null};
    reportMsg = {};
    buildInputs();
    update();
  });
  window.addEventListener('hashchange', function () {
    if (loadHash()) { buildInputs(); update(); }
  });
}

function loadHash() {
  var m = location.hash.match(/^#s=([\w-]+)/);
  if (!m) return false;
  var state = decodeShare(m[1]);
  if (!state) return false;
  S = state;
  clearHash();
  return true;
}

function init() {
  LANG = initTexts(TEXTS);
  if (!loadHash()) {
    var saved = load(LS_STATE);
    if (saved) S = cleanState(saved);
  }
  if (!S.participants.length && !S.battles.length) {
    S.participants.push({id: newId(S, 'p'), name: '', flightDeut: 0, recDeut: 0, missiles: 0});
    S.participants.push({id: newId(S, 'p'), name: '', flightDeut: 0, recDeut: 0, missiles: 0});
    S.battles.push({time: null, loot: {m: 0, k: 0, d: 0}, fleets: []});
  }
  applyTexts();
  buildInputs();
  bind();
  bindTips();
  render();
}

init();
