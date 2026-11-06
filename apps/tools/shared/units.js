/* Own values for ships, defense and missiles, shared by all tools: the differences from the hub's defaults
   (@pr0hub/core/units) stored in the browser, values from a share link for the session, the header button and the
   editor dialog (paste game page sources, then a form per unit). The page parser is only loaded when a page is
   pasted. Every tool calls initUnits() before it renders, passes unitsLinkValue() into its share link (hash key `uo`)
   and re-renders on onUnitsChange(). */
import { BUILDINGS, RESEARCH } from '@pr0hub/core/buildings';
import { registerUnitNames, techName } from '@pr0hub/core/tech';
import { DEFAULT_UNIT_DEFS, emptyUnit, isUnitId, setActiveUnits, unitCatalog, unitPatch, validateUnits } from '@pr0hub/core/units';
import { decodeUnitOverrides, encodeUnitOverrides, UNITS_HASH as HASH_KEY } from '@pr0hub/core/universe';
import { $, applyTexts, esc, fmtNum, lang, load, store, t, toast } from './shell.js';

export var LS_UNITS = 'pr0tools.units.v1';
/* hash key of the share links */
export var UNITS_HASH = HASH_KEY;

var stored = {};
var fromLink = null;
var listeners = [];

var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
var active = function () { return fromLink ? Object.assign({}, stored, fromLink) : stored; };

function apply() {
  var catalog = unitCatalog(active());
  registerUnitNames(catalog);
  setActiveUnits(catalog);
  syncButton();
}

/* base64url of the JSON (UTF-8), the same format as the hub's links */
var encode = encodeUnitOverrides;
var decode = decodeUnitOverrides;

/* Loads the stored values and, from a share link, its values for this session. `extra`: units of an older format
   (the flight calculator's custom ships) to keep. */
export function initUnits(linkValue, extra) {
  var raw = load(LS_UNITS);
  stored = raw && validateUnits(raw) == null ? raw : {};
  if (extra && extra.stored) {
    stored = Object.assign({}, extra.stored, stored);
    store(LS_UNITS, stored);
  }
  fromLink = linkValue ? decode(linkValue) : null;
  if (extra && extra.link) fromLink = Object.assign({}, extra.link, fromLink || {});
  apply();
}

/* The active differences (stored, with the link's on top). */
export function activeUnitOverrides() { return active(); }

/* Value of the share link's `uo` key: the differences of the units `ids` (all when omitted); '' without any. */
export function unitsLinkValue(ids) {
  var all = active();
  var keys = Object.keys(all).filter(function (id) { return !ids || ids.map(String).indexOf(id) !== -1; });
  if (!keys.length) return '';
  var out = {};
  keys.forEach(function (id) { out[id] = all[id]; });
  return encode(out);
}

export function onUnitsChange(fn) { listeners.push(fn); }

function changed() {
  apply();
  listeners.forEach(function (fn) { fn(); });
}

/* ---------- header button ---------- */

var SHIP_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l3 7h6l-5 4 2 7-6-4-6 4 2-7-5-4h6z"/></svg>';

/* Puts the button before the language switch of the header. */
export function mountUnitsButton() {
  var bar = $('.top-actions');
  if (!bar || $('#unitsBtn')) return;
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn units-btn';
  btn.id = 'unitsBtn';
  btn.innerHTML = SHIP_ICON + '<span class="units-badge" hidden></span>';
  btn.addEventListener('click', openUnits);
  bar.insertBefore(btn, $('#langSeg') || bar.firstChild);
  syncButton();
}

function syncButton() {
  var btn = $('#unitsBtn');
  if (!btn) return;
  var n = Object.keys(active()).length;
  btn.title = t('unitsTitle') + (n ? ' · ' + t('unitsActive', {n: n}) : '');
  btn.setAttribute('aria-label', t('units'));
  btn.classList.toggle('on', n > 0);
  var badge = btn.querySelector('.units-badge');
  badge.hidden = !n;
  badge.textContent = n;
}

/* ---------- editor ---------- */

var draft = {};
var editing = null;
var pasteOpen = false;
var paste = null;
var error = '';

var L = function () { return lang() === 'de' ? 'de' : 'en'; };
var DRIVES = [115, 117, 118];
var FIELDS = ['name', 'cost', 'req', 'one', 'attack', 'shield', 'capacity', 'drives', 'rapidfire'];

function emptyPaste() { return {names: {}, found: {}, from: {}, unknown: [], pasted: [], chosen: {}, listed: {}, busy: false}; }

function merged(id) {
  var patch = Object.assign({}, draft[id] || {});
  delete patch.hidden;
  var o = {};
  o[id] = patch;
  return unitCatalog(o).units[id] || DEFAULT_UNIT_DEFS[id] || emptyUnit(Number(id));
}

function allUnits() {
  var ids = {};
  Object.keys(DEFAULT_UNIT_DEFS).concat(Object.keys(draft)).forEach(function (id) { if (isUnitId(Number(id))) ids[id] = true; });
  return Object.keys(ids).map(Number).sort(function (a, b) { return a - b; }).map(function (id) {
    return {
      id: id,
      unit: merged(id),
      state: draft[id] && draft[id].hidden ? 'hidden' : !DEFAULT_UNIT_DEFS[id] ? 'new' : draft[id] ? 'changed' : 'default',
    };
  });
}

function unitName(id) {
  var u = merged(id);
  return u ? u.name[L()] : techName(id, L());
}

function put(unit) {
  var patch = unitPatch(unit, DEFAULT_UNIT_DEFS[unit.id]);
  var hidden = draft[unit.id] && draft[unit.id].hidden;
  if (hidden) patch.hidden = true;
  if (Object.keys(patch).length) draft[unit.id] = clone(patch);
  else delete draft[unit.id];
}

function setHidden(id, hidden) {
  var cur = Object.assign({}, draft[id] || {});
  if (hidden) cur.hidden = true;
  else delete cur.hidden;
  if (Object.keys(cur).length) draft[id] = cur;
  else delete draft[id];
}

var dialog = null;

export function openUnits() {
  draft = clone(active());
  editing = null;
  paste = emptyPaste();
  pasteOpen = false;
  error = '';
  if (!dialog) build();
  render();
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function build() {
  dialog = document.createElement('dialog');
  dialog.id = 'unitsDialog';
  dialog.setAttribute('aria-labelledby', 'unitsTitle');
  dialog.innerHTML = '<form method="dialog" class="dlg units-dlg">'
    + '<div class="dlg-head"><div><h2 id="unitsTitle" data-t="unitsTitle"></h2><p data-t="unitsSub"></p></div>'
    + '<button class="icon-btn" value="close" data-t-aria="unitsCancel"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button></div>'
    + '<div class="dlg-body" id="unitsBody"></div>'
    + '<div class="dlg-foot"><button type="button" class="btn ghost" data-u="resetAll" data-t="unitsResetAll"></button>'
    + '<span class="units-foot"><button class="btn" value="close" data-t="unitsCancel"></button>'
    + '<button type="button" class="btn primary" data-u="save" data-t="unitsSave"></button></span></div>'
    + '</form>';
  document.body.appendChild(dialog);
  dialog.addEventListener('click', onClick);
  dialog.addEventListener('change', onInput);
  dialog.addEventListener('input', onInput);
}

function n(v) { return fmtNum(v, lang()); }

function render() {
  applyTexts(dialog);
  var html = '';
  if (error) html += '<p class="hint units-error">' + esc(error) + '</p>';
  if (fromLink) html += '<p class="hint">' + esc(t('unitsFromLink')) + '</p>';
  html += '<div class="units-bar"><button type="button" class="btn small" data-u="pasteToggle">' + esc(t('unitsPaste')) + '</button>'
    + '<span class="units-new"><input class="input" id="unitsNewId" type="number" min="200" max="599" placeholder="' + esc(t('unitsNewId')) + '" aria-label="' + esc(t('unitsNewId')) + '">'
    + '<button type="button" class="btn small" data-u="add">' + esc(t('unitsAdd')) + '</button></span></div>';
  if (pasteOpen) html += pasteHtml();
  if (editing) html += formHtml();
  html += '<div class="table-wrap"><table class="units-list"><tbody>' + allUnits().map(function (x) {
    var badge = x.state === 'default' ? '' : ' <span class="units-state ' + x.state + '">' + esc(t('unitsState' + x.state[0].toUpperCase() + x.state.slice(1))) + '</span>';
    return '<tr class="' + (x.state === 'hidden' ? 'off' : '') + '"><td class="mono">' + x.id + '</td>'
      + '<td>' + esc(x.unit.name[L()]) + badge + '<div class="units-cost mono">' + x.unit.cost.map(n).join(' / ') + '</div></td>'
      + '<td class="units-actions"><button type="button" class="btn small" data-u="edit" data-id="' + x.id + '">' + esc(t('unitsEdit')) + '</button>'
      + '<button type="button" class="btn small ghost" data-u="hide" data-id="' + x.id + '">' + esc(t(x.state === 'hidden' ? 'unitsShow' : 'unitsHide')) + '</button>'
      + (x.state !== 'default' ? '<button type="button" class="btn small ghost" data-u="reset" data-id="' + x.id + '">' + esc(t(DEFAULT_UNIT_DEFS[x.id] ? 'unitsReset' : 'unitsDelete')) + '</button>' : '')
      + '</td></tr>';
  }).join('') + '</tbody></table></div>';
  $('#unitsBody', dialog).innerHTML = html;
}

/* ---------- paste ---------- */

function absent() {
  return allUnits().filter(function (x) {
    if (x.state === 'hidden' || paste.found[x.id]) return false;
    var list = x.id < 300 ? paste.listed.fleet : paste.listed.defense;
    return list && list.indexOf(x.id) === -1;
  }).map(function (x) { return x.id; });
}

function withFound(id) {
  var u = clone(merged(id));
  var f = paste.found[id];
  if (f) {
    if (f.name && f.lang) {
      u.name[f.lang] = f.name;
      if (!DEFAULT_UNIT_DEFS[id] && u.name[f.lang === 'de' ? 'en' : 'de'] === '#' + id) u.name = {de: f.name, en: f.name};
      if (u.short.de === '#' + id) u.short = {de: f.name.slice(0, 6).trim(), en: f.name.slice(0, 6).trim()};
    }
    if (f.cost) u.cost = f.cost;
    if (f.req) u.req = f.req;
    if (f.one) u.one = true;
    if (f.attack != null) u.attack = f.attack;
    if (f.shield != null) u.shield = f.shield;
    if (f.capacity != null) u.capacity = f.capacity;
    if (f.drives !== undefined) u.drives = f.drives;
    if (f.rapidfire) u.rapidfire = f.rapidfire;
  }
  if (paste.from[id]) u.rapidfire = Object.assign({}, u.rapidfire, paste.from[id]);
  return u;
}

function show(field, u) {
  switch (field) {
    case 'name': return u.name.de + ' / ' + u.name.en;
    case 'cost': return u.cost.map(n).join(' / ');
    case 'req': return Object.keys(u.req).map(function (id) { return techName(id, L()) + ' ' + u.req[id]; }).join(', ') || '–';
    case 'one': return t(u.one ? 'unitsYes' : 'unitsNo');
    case 'drives': return u.drives ? u.drives.speed.map(function (s, i) { return u.drives.tech[i] ? techName(DRIVES[i], L()) + ' ' + n(s) : ''; }).filter(Boolean).join(', ') : '–';
    case 'rapidfire': return Object.keys(u.rapidfire).map(function (id) { return unitName(id) + ' ' + u.rapidfire[id]; }).join(', ') || '–';
    default: return n(u[field]);
  }
}

function preview() {
  var ids = {};
  Object.keys(paste.found).concat(Object.keys(paste.from)).forEach(function (id) { ids[id] = true; });
  var known = allUnits().map(function (x) { return x.id; });
  var out = Object.keys(ids).map(Number).sort(function (a, b) { return a - b; }).map(function (id) {
    var before = merged(id);
    var after = withFound(id);
    var changes = FIELDS.filter(function (k) { return JSON.stringify(before[k]) !== JSON.stringify(after[k]); })
      .map(function (k) { return {field: k, from: show(k, before), to: show(k, after)}; });
    if (draft[id] && draft[id].hidden && paste.found[id]) changes.unshift({field: 'present', from: t('unitsNo'), to: t('unitsYes')});
    var f = paste.found[id];
    var structure = f && f.structure != null && f.structure !== after.cost[0] + after.cost[1] ? f.structure : null;
    return {id: id, isNew: known.indexOf(id) === -1, name: (f && f.name) || unitName(id), changes: changes, structure: structure, hide: false};
  }).filter(function (p) { return p.changes.length || p.isNew || p.structure != null; });
  return out.concat(absent().map(function (id) {
    return {id: id, isNew: false, name: unitName(id), changes: [{field: 'present', from: t('unitsYes'), to: t('unitsNo')}], structure: null, hide: true};
  }));
}

function pasteHtml() {
  var html = '<div class="units-paste"><p class="hint">' + esc(t('unitsPasteHint')) + '</p>'
    + '<textarea id="unitsHtml" spellcheck="false" placeholder="' + esc(t('unitsPastePh')) + '"></textarea>'
    + '<div class="units-bar"><button type="button" class="btn small primary" data-u="read"' + (paste.busy ? ' disabled' : '') + '>' + esc(t(paste.busy ? 'unitsReading' : 'unitsRead')) + '</button>'
    + paste.pasted.map(function (p) { return '<span class="units-chip">' + esc(p) + '</span>'; }).join('') + '</div>';
  if (paste.unknown.length) html += '<p class="hint units-warn">' + esc(t('unitsUnknown', {names: paste.unknown.join(', ')})) + '</p>';
  if (paste.pasted.length) {
    var list = preview();
    if (!list.length) html += '<p class="hint">' + esc(t('unitsNothingNew')) + '</p>';
    html += list.map(function (p) {
      return '<div class="units-found"><label class="units-check"><input type="checkbox" data-u="choose" data-id="' + p.id + '"' + (paste.chosen[p.id] ? ' checked' : '') + '>'
        + '<b>' + p.id + ' ' + esc(p.name) + '</b>' + (p.isNew ? ' <span class="units-state new">' + esc(t('unitsStateNew')) + '</span>' : '') + '</label><ul>'
        + p.changes.map(function (c) { return '<li><span class="units-muted">' + esc(t('unitsF_' + c.field)) + ':</span> <s class="units-muted">' + esc(c.from) + '</s> → ' + esc(c.to) + '</li>'; }).join('')
        + (p.structure != null ? '<li class="units-warn">' + esc(t('unitsStructure', {n: n(p.structure)})) + '</li>' : '')
        + '</ul></div>';
    }).join('');
    html += '<div class="units-bar"><button type="button" class="btn small primary" data-u="takeOver">' + esc(t('unitsTakeOver')) + '</button>'
      + '<button type="button" class="btn small ghost" data-u="discard">' + esc(t('unitsDiscard')) + '</button></div>';
  }
  return html + '</div>';
}

function read() {
  var text = $('#unitsHtml', dialog).value;
  if (!text.trim() || paste.busy) return;
  paste.busy = true;
  error = '';
  render();
  var names = {};
  allUnits().forEach(function (x) { names[x.unit.name.de] = x.id; names[x.unit.name.en] = x.id; });
  Object.assign(names, paste.names);
  import('@pr0hub/core/unitPages').then(function (mod) {
    var page = mod.parseUnitPage(text, names);
    paste.busy = false;
    if (!page) {
      error = t('unitsNoPage');
      render();
      return;
    }
    page.units.forEach(function (u) {
      if (u.name) paste.names[u.name] = u.id;
      var before = paste.found[u.id] || {id: u.id};
      var next = Object.assign({}, before, u);
      delete next.rapidfireFrom;
      next.lang = u.name ? page.lang : before.lang;
      next.req = page.kind === 'shipyard' && !u.req ? before.req : (u.req || before.req);
      paste.found[u.id] = next;
      Object.keys(u.rapidfireFrom || {}).forEach(function (shooter) {
        paste.from[shooter] = Object.assign({}, paste.from[shooter] || {});
        paste.from[shooter][u.id] = u.rapidfireFrom[shooter];
        if (paste.chosen[shooter] == null) paste.chosen[shooter] = true;
      });
      if (paste.chosen[u.id] == null) paste.chosen[u.id] = true;
    });
    if (page.kind === 'shipyard' && page.mode) {
      var seen = (paste.listed[page.mode] || []).concat(page.units.map(function (u) { return u.id; }));
      paste.listed[page.mode] = seen;
      // preselected unless much of the list is missing (rather a cut page than a smaller universe)
      var ofList = function (id) { return page.mode === 'fleet' ? id < 300 : id >= 400; };
      var missing = absent().filter(ofList);
      var size = allUnits().filter(function (x) { return ofList(x.id) && x.state !== 'hidden'; }).length;
      missing.forEach(function (id) { if (paste.chosen[id] == null) paste.chosen[id] = missing.length <= size / 2; });
    }
    paste.unknown = paste.unknown.filter(function (name) { return !paste.names[name]; }).concat(page.unknown.filter(function (name) { return paste.unknown.indexOf(name) === -1; }));
    var kind = page.kind === 'shipyard' ? 'unitsKindShipyard' : page.kind === 'techtree' ? 'unitsKindTechtree' : 'unitsKindInfo';
    paste.pasted.push(t(kind, {n: page.units.length}));
    render();
  }).catch(function (e) {
    paste.busy = false;
    error = String(e && e.message || e);
    render();
  });
}

function takeOver() {
  preview().forEach(function (p) {
    if (!paste.chosen[p.id]) return;
    if (p.hide) return setHidden(p.id, true);
    var unhide = draft[p.id] && draft[p.id].hidden && paste.found[p.id];
    put(withFound(p.id));
    if (unhide) setHidden(p.id, false);
  });
  paste = emptyPaste();
  pasteOpen = false;
}

/* ---------- form ---------- */

function edit(id) {
  var u = clone(merged(id));
  editing = {unit: u, flies: !!u.drives,
    req: Object.keys(u.req).map(function (r) { return {id: Number(r), level: u.req[r]}; }),
    rf: Object.keys(u.rapidfire).map(function (r) { return {id: Number(r), shots: u.rapidfire[r]}; })};
  if (!u.drives) u.drives = {speed: [0, 0, 0], tech: [0, 0, 0], consumption: [0, 0, 0]};
}

function field(label, key, value, type) {
  return '<label class="field"><span class="field-label">' + esc(label) + '</span><input data-f="' + key + '" ' + (type === 'text' ? 'maxlength="64"' : 'type="number" min="0"') + ' value="' + esc(value) + '"></label>';
}

function formHtml() {
  var u = editing.unit;
  var reqOptions = Object.keys(BUILDINGS).concat(Object.keys(RESEARCH));
  var html = '<div class="units-form"><h3>' + u.id + ' ' + esc(u.name[L()]) + '</h3><div class="units-grid">'
    + field(t('unitsF_name') + ' DE', 'name.de', u.name.de, 'text') + field(t('unitsF_name') + ' EN', 'name.en', u.name.en, 'text')
    + field(t('unitsF_short') + ' DE', 'short.de', u.short.de, 'text') + field(t('unitsF_short') + ' EN', 'short.en', u.short.en, 'text')
    + field(techName(901, L()), 'cost.0', u.cost[0]) + field(techName(902, L()), 'cost.1', u.cost[1]) + field(techName(903, L()), 'cost.2', u.cost[2])
    + field(t('unitsF_attack'), 'attack', u.attack) + field(t('unitsF_shield'), 'shield', u.shield)
    + (u.id < 300 ? field(t('unitsF_capacity'), 'capacity', u.capacity) : '')
    + '</div><p class="hint">' + esc(t('unitsHull', {n: n((Number(u.cost[0]) + Number(u.cost[1])) / 10)})) + '</p>'
    + '<label class="units-check"><input type="checkbox" data-f="one"' + (u.one ? ' checked' : '') + '> ' + esc(t('unitsF_one')) + '</label>';
  if (u.id < 300) {
    html += '<label class="units-check"><input type="checkbox" data-f="flies"' + (editing.flies ? ' checked' : '') + '> ' + esc(t('unitsFlies')) + '</label>';
    if (editing.flies) {
      html += DRIVES.map(function (d, i) {
        return '<div class="units-drive"><b>' + esc(techName(d, L())) + '</b>'
          + field(t('unitsSpeed'), 'drives.speed.' + i, u.drives.speed[i]) + field(t('unitsConsumption'), 'drives.consumption.' + i, u.drives.consumption[i])
          + field(t('unitsFrom'), 'drives.tech.' + i, u.drives.tech[i]) + '</div>';
      }).join('') + '<p class="hint">' + esc(t('unitsFromHint')) + '</p>';
    }
  }
  html += '<h4>' + esc(t('unitsF_req')) + '</h4>' + editing.req.map(function (r, i) {
    return '<div class="units-row"><select class="input" data-r="req.' + i + '.id">' + reqOptions.map(function (id) {
      return '<option value="' + id + '"' + (Number(id) === r.id ? ' selected' : '') + '>' + esc(techName(id, L())) + '</option>';
    }).join('') + '</select><input class="input" type="number" min="1" data-r="req.' + i + '.level" value="' + r.level + '">'
      + '<button type="button" class="icon-btn" data-u="delReq" data-i="' + i + '" aria-label="' + esc(t('unitsDelete')) + '">×</button></div>';
  }).join('') + '<button type="button" class="btn small ghost" data-u="addReq">' + esc(t('unitsAddReq')) + '</button>';
  html += '<h4>' + esc(t('unitsF_rapidfire')) + '</h4>' + editing.rf.map(function (r, i) {
    return '<div class="units-row"><select class="input" data-r="rf.' + i + '.id">' + allUnits().map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === r.id ? ' selected' : '') + '>' + esc(x.unit.name[L()]) + '</option>';
    }).join('') + '</select><input class="input" type="number" min="2" data-r="rf.' + i + '.shots" value="' + r.shots + '">'
      + '<button type="button" class="icon-btn" data-u="delRf" data-i="' + i + '" aria-label="' + esc(t('unitsDelete')) + '">×</button></div>';
  }).join('') + '<button type="button" class="btn small ghost" data-u="addRf">' + esc(t('unitsAddRf')) + '</button>'
    + '<p class="hint">' + esc(t('unitsShotsHint')) + '</p>';
  return html + '<div class="units-bar"><button type="button" class="btn small primary" data-u="apply">' + esc(t('unitsApply')) + '</button>'
    + '<button type="button" class="btn small ghost" data-u="cancelEdit">' + esc(t('unitsCancel')) + '</button></div></div>';
}

function applyForm() {
  var u = editing.unit;
  var num = function (v) { return Math.max(0, Math.floor(Number(v) || 0)); };
  var req = {};
  editing.req.forEach(function (r) { if (r.id && num(r.level) > 0) req[r.id] = num(r.level); });
  var rf = {};
  editing.rf.forEach(function (r) { if (r.id && num(r.shots) > 1) rf[r.id] = num(r.shots); });
  var nameDe = String(u.name.de).trim() || '#' + u.id;
  var shortDe = String(u.short.de).trim() || '#' + u.id;
  put({
    id: u.id,
    name: {de: nameDe, en: String(u.name.en).trim() || nameDe},
    short: {de: shortDe, en: String(u.short.en).trim() || shortDe},
    cost: [num(u.cost[0]), num(u.cost[1]), num(u.cost[2])],
    req: req,
    one: !!u.one,
    attack: Math.max(0, Number(u.attack) || 0),
    shield: Math.max(0, Number(u.shield) || 0),
    rapidfire: rf,
    capacity: u.id < 300 ? num(u.capacity) : 0,
    drives: u.id < 300 && editing.flies ? {speed: u.drives.speed.map(num), tech: u.drives.tech.map(num), consumption: u.drives.consumption.map(num)} : null,
  });
  editing = null;
}

/* ---------- events ---------- */

function setPath(obj, path, value) {
  var keys = path.split('.');
  var last = keys.pop();
  keys.forEach(function (k) { obj = obj[k]; });
  obj[last] = value;
}

function onInput(e) {
  var el = e.target;
  if (el.dataset.f && editing) {
    if (el.dataset.f === 'one') editing.unit.one = el.checked;
    else if (el.dataset.f === 'flies') {
      editing.flies = el.checked;
      if (e.type === 'change') render();
    } else setPath(editing.unit, el.dataset.f, el.type === 'number' ? el.value : el.value);
  } else if (el.dataset.r && editing) {
    var p = el.dataset.r.split('.');
    editing[p[0]][Number(p[1])][p[2]] = Number(el.value);
  } else if (el.dataset.u === 'choose') {
    paste.chosen[el.dataset.id] = el.checked;
  }
}

function onClick(e) {
  var el = e.target.closest('[data-u]');
  if (!el || el.dataset.u === 'choose') return;
  var id = Number(el.dataset.id);
  switch (el.dataset.u) {
    case 'pasteToggle': pasteOpen = !pasteOpen; break;
    case 'read': return read();
    case 'takeOver': takeOver(); break;
    case 'discard': paste = emptyPaste(); break;
    case 'add': {
      var newId = Number($('#unitsNewId', dialog).value);
      if (!isUnitId(newId)) { error = t('unitsIdInvalid'); break; }
      error = '';
      if (!DEFAULT_UNIT_DEFS[newId] && !draft[newId]) {
        var u = emptyUnit(newId);
        draft[newId] = {name: u.name, cost: u.cost};
      }
      edit(newId);
      break;
    }
    case 'edit': edit(id); break;
    case 'hide': setHidden(id, !(draft[id] && draft[id].hidden)); break;
    case 'reset': delete draft[id]; if (editing && editing.unit.id === id) editing = null; break;
    case 'apply': applyForm(); break;
    case 'cancelEdit': editing = null; break;
    case 'addReq': editing.req.push({id: 21, level: 1}); break;
    case 'delReq': editing.req.splice(Number(el.dataset.i), 1); break;
    case 'addRf': editing.rf.push({id: 202, shots: 2}); break;
    case 'delRf': editing.rf.splice(Number(el.dataset.i), 1); break;
    case 'resetAll':
      if (!window.confirm(t('unitsResetAllConfirm'))) return;
      draft = {};
      editing = null;
      break;
    case 'save': {
      var problem = validateUnits(draft);
      if (problem != null) { error = problem; break; }
      stored = clone(draft);
      fromLink = null;
      store(LS_UNITS, stored);
      dialog.close();
      changed();
      toast(t('unitsActive', {n: Object.keys(stored).length}));
      return;
    }
    default: return;
  }
  render();
}
