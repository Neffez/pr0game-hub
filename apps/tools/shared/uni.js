/* Universe settings shared by the tools with a settings dialog (flight calculator, battle simulator): fields, hash
   keys, texts and the dialog's fields. All tools store them under one key, so a universe set up once fits them all;
   each tool keeps the keys of the others. */
import { esc, t } from './shell.js';

export var LS_UNI = 'pr0fc.uni.v1';

/* Fields; group, label and hint are text keys. */
export var UNI_FIELDS = [
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
  {group: 'groupClock', key: 'clock_offset', label: 'uClock', step: 1, hint: 'uClockHint'},
  {group: 'groupBattle', key: 'fleet_debris', label: 'uFleetDebris', step: 1, min: 0, max: 100, hint: 'uFleetDebrisHint'},
  {group: 'groupBattle', key: 'defense_debris', label: 'uDefenseDebris', step: 1, min: 0, max: 100, hint: 'uDefenseDebrisHint'},
  {group: 'groupBattle', key: 'moon_factor', label: 'uMoonFactor', step: 'any', min: 0, hint: 'uMoonFactorHint'},
  {group: 'groupBattle', key: 'max_moon_chance', label: 'uMaxMoon', step: 1, min: 0, max: 100},
  {group: 'groupBattle', key: 'big_shields', label: 'uBigShields', type: 'toggle', hint: 'uBigShieldsHint'}
];
export var SHAPES = [[0, 'shapeLinear'], [1, 'shapeRing'], [2, 'shapeSphere']];
var TOGGLE = [[0, 'toggleOff'], [1, 'toggleOn']];

/* Defaults of the battle values (game config: fleet_debris_percentage, def_debris_percentage, moon_factor,
   moon_chance; shield domes as ship shields off); the flight values default in ../src/core.ts (DEFAULT_UNI). */
export var BATTLE_UNI_DEFAULTS = {fleet_debris: 30, defense_debris: 0, moon_factor: 1, max_moon_chance: 20, big_shields: 0};

/* Hash keys (compatible with the in-game calculator links and the hub's links). */
export var UNI_HASH = {
  uni_type: 'ut', galaxy_type: 'gt', max_galaxy: 'mg', max_system: 'ms', max_planets: 'mp',
  galaxy_distance_factor: 'gdf', system_distance_factor: 'sdf', system_distance: 'sd',
  planet_distance_factor: 'pdf', planet_distance: 'pd', game_speed: 'gs',
  expo_hold_multiplier: 'ehm', honor_boost: 'hb',
  fleet_debris: 'fd', defense_debris: 'dd', moon_factor: 'mf', max_moon_chance: 'mc', big_shields: 'bs'
};

export var UNI_TEXTS = {
  de: {
    uniSettings: 'Universumseinstellungen',
    storedLocally: 'Lokal in deinem Browser gespeichert.',
    close: 'Schließen',
    defaults: 'Standard',
    done: 'Fertig',
    info: 'Info',
    uniSummary: 'Speed ×{speed} · {gal} Gal{shape}',
    shapeRingShort: ' · Ring',
    shapeSphereShort: ' · Kugel',
    groupSpeed: 'Geschwindigkeit', groupLayout: 'Aufbau', groupDistances: 'Entfernungen', groupClock: 'Uhr', groupBattle: 'Kampf',
    uGameSpeed: 'Flottengeschwindigkeit', uGameSpeedHint: '1 = normal, 2 = doppelt so schnell',
    uExpoHold: 'Expeditions-Haltefaktor', uExpoHoldHint: 'Teilt die Haltezeit der Expedition',
    uHonor: 'Deuterium-Faktor', uHonorHint: 'Ehren-Boost auf den Verbrauch',
    uGalaxies: 'Galaxien', uSystems: 'Systeme', uPlanets: 'Planetenpositionen',
    uUniType: 'Galaxien sind …', uGalaxyType: 'Systeme sind …',
    uGalFactor: 'Galaxie-Faktor', uSysFactor: 'System-Faktor', uSysBase: 'System-Grundentfernung',
    uPlanetFactor: 'Planeten-Faktor', uPlanetBase: 'Planeten-Grundentfernung',
    uClock: 'Versatz der Spieluhr (s)',
    uClockHint: 'Positiv, wenn die Spieluhr deinem Gerät voraus ist. Vergleich sie mit der Uhr im Spiel, damit Countdowns sekundengenau sind.',
    uFleetDebris: 'Flotte ins Trümmerfeld (%)', uFleetDebrisHint: 'Anteil der zerstörten Schiffe (Metall und Kristall), der im Trümmerfeld landet.',
    uDefenseDebris: 'Verteidigung ins Trümmerfeld (%)', uDefenseDebrisHint: 'Anteil der zerstörten Verteidigung, die nicht wieder aufgebaut wird (rund 30 %), der im Trümmerfeld landet.',
    uMoonFactor: 'Mondfaktor', uMoonFactorHint: 'Mondchance: 1 % je 100.000 Trümmerfeld mal diesem Faktor.',
    uMaxMoon: 'Höchste Mondchance (%)',
    uBigShields: 'Schildkuppeln zuerst', uBigShieldsHint: 'Wenn im Universum aktiv: Die Schildkuppeln müssen fallen, bevor andere Einheiten getroffen werden können.',
    toggleOff: 'aus', toggleOn: 'an',
    shapeLinear: 'linear', shapeRing: 'ein Ring (geht rundherum)', shapeSphere: 'eine Kugel (alle gleich weit)',
    uniReset: 'Universum auf Standard zurückgesetzt'
  },
  en: {
    uniSettings: 'Universe settings',
    storedLocally: 'Stored locally in your browser.',
    close: 'Close',
    defaults: 'Defaults',
    done: 'Done',
    info: 'Info',
    uniSummary: 'Speed ×{speed} · {gal} gal{shape}',
    shapeRingShort: ' · ring',
    shapeSphereShort: ' · sphere',
    groupSpeed: 'Speed', groupLayout: 'Layout', groupDistances: 'Distances', groupClock: 'Clock', groupBattle: 'Battle',
    uGameSpeed: 'Fleet speed', uGameSpeedHint: '1 = normal, 2 = twice as fast',
    uExpoHold: 'Expedition hold factor', uExpoHoldHint: 'Divides the expedition hold time',
    uHonor: 'Deuterium factor', uHonorHint: 'Honor boost applied to consumption',
    uGalaxies: 'Galaxies', uSystems: 'Systems', uPlanets: 'Planet positions',
    uUniType: 'Galaxies are …', uGalaxyType: 'Systems are …',
    uGalFactor: 'Galaxy factor', uSysFactor: 'System factor', uSysBase: 'System base distance',
    uPlanetFactor: 'Planet factor', uPlanetBase: 'Planet base distance',
    uClock: 'Game clock offset (s)',
    uClockHint: 'Positive if the game clock is ahead of your device. Compare with the clock in the game so countdowns are accurate to the second.',
    uFleetDebris: 'Fleet into debris (%)', uFleetDebrisHint: 'Share of the destroyed ships (metal and crystal) that ends up in the debris field.',
    uDefenseDebris: 'Defense into debris (%)', uDefenseDebrisHint: 'Share of the destroyed defense that is not rebuilt (about 30 %) that ends up in the debris field.',
    uMoonFactor: 'Moon factor', uMoonFactorHint: 'Moon chance: 1 % per 100,000 debris times this factor.',
    uMaxMoon: 'Highest moon chance (%)',
    uBigShields: 'Shield domes first', uBigShieldsHint: 'When active in the universe: the shield domes must fall before other units can be hit.',
    toggleOff: 'off', toggleOn: 'on',
    shapeLinear: 'linear', shapeRing: 'a ring (wrap around)', shapeSphere: 'a sphere (all equally far)',
    uniReset: 'Universe reset to defaults'
  }
};

/* The dialog's fieldsets for the given groups (in their order), each as {group: [field html]}. */
export function uniFieldGroups(groups) {
  var out = {};
  groups.forEach(function (g) { out[g] = []; });
  UNI_FIELDS.forEach(function (f) {
    if (!out[f.group]) return;
    var html;
    if (f.type === 'shape' || f.type === 'toggle') {
      html = '<div class="field"><div class="label-row"><label for="u-' + f.key + '">' + esc(t(f.label)) + '</label>'
        + (f.hint ? '<button type="button" class="tip" aria-label="' + esc(t('info')) + '" data-tip="' + esc(t(f.hint)) + '"></button>' : '') + '</div>'
        + '<select id="u-' + f.key + '" data-uni="' + f.key + '">'
        + (f.type === 'shape' ? SHAPES : TOGGLE).map(function (s) { return '<option value="' + s[0] + '">' + esc(t(s[1])) + '</option>'; }).join('') + '</select></div>';
    } else {
      html = '<div class="field"><div class="label-row"><label for="u-' + f.key + '">' + esc(t(f.label)) + '</label>'
        + (f.hint ? '<button type="button" class="tip" aria-label="' + esc(t('info')) + '" data-tip="' + esc(t(f.hint)) + '"></button>' : '') + '</div>'
        + '<input id="u-' + f.key + '" data-uni="' + f.key + '" type="number" step="' + f.step + '"'
        + (f.min !== undefined ? ' min="' + f.min + '"' : '') + (f.max !== undefined ? ' max="' + f.max + '"' : '') + ' inputmode="decimal"></div>';
    }
    out[f.group].push(html);
  });
  return out;
}

export function fieldsetsHtml(groups) {
  return Object.keys(groups).map(function (g) {
    return '<fieldset><legend>' + esc(t(g)) + '</legend>' + groups[g].join('') + '</fieldset>';
  }).join('');
}

/* Inputs of the dialog show the values (not the one being typed in). */
export function syncUniInputs(U) {
  Array.prototype.slice.call(document.querySelectorAll('[data-uni]')).forEach(function (input) {
    if (document.activeElement !== input) input.value = U[input.dataset.uni];
  });
}

export function uniSummary(U) {
  var shape = Number(U.uni_type) === 1 ? t('shapeRingShort') : (Number(U.uni_type) === 2 ? t('shapeSphereShort') : '');
  return t('uniSummary', {speed: U.game_speed, gal: U.max_galaxy, shape: shape});
}

export function openDialog(dlg) {
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
}
