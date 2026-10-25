/* Shared page shell of the pr0game tools: DOM helpers, storage, language (German/English) with static texts,
   toast, copying the share link and info tooltips. Each tool brings its own TEXTS (same keys in de and en). */

export var LANGS = ['de', 'en'];
/* One language for all tools; the loot calculator stored its own before. */
var LS_LANG = 'pr0tools.lang';
var LEGACY_LANG_KEYS = ['pr0loot.lang.v1'];

/* Texts of the shared header, merged under each tool's own texts. */
export var COMMON_TEXTS = {
  de: {
    share: 'Link teilen',
    shareTitle: 'Link mit allen Eingaben kopieren',
    shared: 'Link mit allen Eingaben kopiert',
    language: 'Sprache',
    allTools: 'Alle pr0game-Tools',
    linkLoaded: 'Werte aus dem Link übernommen',
    copied: 'Kopiert: {text}',
  },
  en: {
    share: 'Share link',
    shareTitle: 'Copy a link with all inputs',
    shared: 'Link with all inputs copied',
    language: 'Language',
    allTools: 'All pr0game tools',
    linkLoaded: 'Values loaded from link',
    copied: 'Copied: {text}',
  },
};

var TEXTS = COMMON_TEXTS;
var LANG = 'en';

export function $(sel, root) { return (root || document).querySelector(sel); }
export function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

export function esc(value) {
  return String(value).replace(/[&<>"']/g, function (ch) {
    return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch];
  });
}

export function load(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}

export function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
}

/* ---------- language ---------- */

/* Stored choice, then the one of an earlier tool, then the browser language. */
export function storedLang() {
  var keys = [LS_LANG].concat(LEGACY_LANG_KEYS);
  for (var i = 0; i < keys.length; i++) {
    var value = load(keys[i]);
    if (LANGS.indexOf(value) !== -1) return value;
  }
  return /^de\b/i.test((typeof navigator !== 'undefined' && navigator.language) || '') ? 'de' : 'en';
}

/* Sets the texts of the page and picks the language; returns it. */
export function initTexts(texts) {
  TEXTS = {};
  LANGS.forEach(function (l) { TEXTS[l] = Object.assign({}, COMMON_TEXTS[l], texts[l]); });
  LANG = storedLang();
  return LANG;
}

export function lang() { return LANG; }

export function setLang(value) {
  if (LANGS.indexOf(value) === -1) return;
  LANG = value;
  store(LS_LANG, value);
}

/* Text in the page language (English as fallback), `{name}` placeholders filled from `vars`. */
export function t(key, vars) {
  var text = (TEXTS[LANG] && TEXTS[LANG][key]) != null ? TEXTS[LANG][key] : TEXTS.en && TEXTS.en[key] != null ? TEXTS.en[key] : key;
  if (vars) {
    text = String(text).replace(/\{(\w+)\}/g, function (m, name) { return vars[name] != null ? vars[name] : m; });
  }
  return text;
}

/* Static texts of the markup: data-t (text), data-t-title, data-t-tip, data-t-ph (placeholder), data-t-aria,
   data-t-label (data-label of generated fields); the page title from the `title` text. */
export function applyTexts(root) {
  var scope = root || document;
  document.documentElement.lang = LANG;
  if (!root && TEXTS.en && TEXTS.en.title) document.title = t('title') + ' · pr0game';
  $$('[data-t]', scope).forEach(function (el) { el.textContent = t(el.getAttribute('data-t')); });
  $$('[data-t-title]', scope).forEach(function (el) { el.title = t(el.getAttribute('data-t-title')); });
  $$('[data-t-tip]', scope).forEach(function (el) { el.setAttribute('data-tip', t(el.getAttribute('data-t-tip'))); });
  $$('[data-t-ph]', scope).forEach(function (el) { el.placeholder = t(el.getAttribute('data-t-ph')); });
  $$('[data-t-aria]', scope).forEach(function (el) { el.setAttribute('aria-label', t(el.getAttribute('data-t-aria'))); });
  $$('[data-t-label]', scope).forEach(function (el) { el.setAttribute('data-label', t(el.getAttribute('data-t-label'))); });
  $$('#langSeg [data-lang]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === LANG)); });
}

/* The DE/EN switch in the header (#langSeg): stores the choice, applies the static texts, then `onChange`. */
export function bindLang(onChange) {
  var seg = $('#langSeg');
  if (!seg) return;
  seg.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-lang]');
    if (!btn || btn.getAttribute('data-lang') === LANG) return;
    setLang(btn.getAttribute('data-lang'));
    applyTexts();
    if (onChange) onChange(LANG);
  });
}

/* Thousands separators like the game: 1.234.567 (German) or 1,234,567 (English). */
export function fmtNum(n, language) {
  var r = Math.round(Number(n) || 0);
  var s = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, (language || LANG) === 'de' ? '.' : ',');
  return (r < 0 ? '-' : '') + s;
}

/* ---------- toast and copying ---------- */

var toastTimer = null;
var toastAction = null;
var toastBound = false;

/* Short message at the bottom (#toast); with `action` ({label, fn}) it stays longer and runs fn on a click. */
export function toast(text, action) {
  var el = $('#toast');
  if (!el) return;
  if (!toastBound) {
    toastBound = true;
    el.addEventListener('click', function () {
      if (!toastAction) return;
      var fn = toastAction.fn;
      toastAction = null;
      el.classList.remove('show', 'action');
      fn();
    });
  }
  el.textContent = text;
  toastAction = action || null;
  if (action) {
    var b = document.createElement('b');
    b.textContent = action.label;
    el.appendChild(b);
  }
  el.classList.toggle('action', !!action);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    el.classList.remove('show', 'action');
    toastAction = null;
  }, action ? 5000 : 1800);
}

function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  var ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
  document.body.removeChild(ta);
  return ok;
}

/* Copies text to the clipboard and confirms with `done` (default: the text itself). */
export function copy(text, done) {
  var confirm = function () { toast(done || text); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(confirm, function () { fallbackCopy(text); confirm(); });
  } else {
    fallbackCopy(text);
    confirm();
  }
}

/* The share button in the header (#shareBtn): copies the link `build()` returns. */
export function bindShare(build) {
  var btn = $('#shareBtn');
  if (!btn) return;
  btn.addEventListener('click', function () { copy(build(), t('shared')); });
}

/* Removes the hash after a share link was taken over, so reloading does not apply it again. */
export function clearHash() {
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
}

/* ---------- tooltips ---------- */

var tipBubble = null;
var tipOwner = null;

function showTip(btn) {
  if (!btn.dataset.tip) return;
  if (!tipBubble) {
    tipBubble = document.createElement('div');
    tipBubble.className = 'tip-bubble';
    tipBubble.id = 'tipBubble';
    tipBubble.setAttribute('role', 'tooltip');
  }
  /* Inside a modal dialog the bubble has to live in the top layer too. */
  var host = btn.closest('dialog') || document.body;
  if (tipBubble.parentNode !== host) host.appendChild(tipBubble);
  if (tipOwner && tipOwner !== btn) tipOwner.setAttribute('aria-expanded', 'false');
  tipBubble.textContent = btn.dataset.tip;
  tipBubble.hidden = false;
  tipOwner = btn;
  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-describedby', 'tipBubble');
  var r = btn.getBoundingClientRect();
  var w = tipBubble.offsetWidth;
  var h = tipBubble.offsetHeight;
  var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  var top = r.bottom + 8;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
  tipBubble.style.left = left + 'px';
  tipBubble.style.top = top + 'px';
}

function hideTip() {
  if (tipBubble) tipBubble.hidden = true;
  if (tipOwner) {
    tipOwner.setAttribute('aria-expanded', 'false');
    tipOwner.removeAttribute('aria-describedby');
    tipOwner = null;
  }
}

/* Info buttons (.tip with data-tip): bubble on hover, focus and tap. */
export function bindTips() {
  document.addEventListener('mouseover', function (e) {
    var btn = e.target.closest && e.target.closest('.tip');
    if (btn) showTip(btn);
  });
  document.addEventListener('mouseout', function (e) {
    var btn = e.target.closest && e.target.closest('.tip');
    if (btn && !btn.contains(e.relatedTarget) && document.activeElement !== btn) hideTip();
  });
  document.addEventListener('focusin', function (e) {
    if (e.target.classList && e.target.classList.contains('tip')) showTip(e.target);
  });
  document.addEventListener('focusout', function (e) {
    if (e.target === tipOwner) hideTip();
  });
  /* Capture phase: a tap toggles the bubble without triggering labels or summaries. */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.tip');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      if (tipOwner === btn && !tipBubble.hidden) hideTip(); else showTip(btn);
    } else if (tipOwner) {
      hideTip();
    }
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && tipOwner) hideTip();
  });
  window.addEventListener('scroll', hideTip, true);
  window.addEventListener('resize', hideTip);
}
