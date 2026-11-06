/* Tabs of independent calculations (flight calculator, battle simulator, loot calculator): the tab bar with a name
   and a key result per tab, adding (up to a maximum), closing with undo, renaming by double-click and the stored
   list. Each tool keeps its own state per tab and says what a tab shows; the look is .calc-tabs in tools.css. */
import { $, esc, t, toast } from './shell.js';

/* Texts of the tab bar; the tools add their own tabsAria, tabNew and tabCopied. */
export var TABS_TEXTS = {
  de: {
    tabRename: 'Doppelklick zum Umbenennen',
    tabClose: 'Tab schließen',
    tabNewAria: 'Neuer Tab',
    tabName: 'Tab-Name',
    tabsMax: 'Höchstens {n} Tabs',
    tabClosed: 'Tab geschlossen',
    undo: 'Rückgängig',
    linkNewTab: 'Link in neuem Tab geöffnet',
  },
  en: {
    tabRename: 'Double-click to rename',
    tabClose: 'Close tab',
    tabNewAria: 'New tab',
    tabName: 'Tab name',
    tabsMax: 'Maximum of {n} tabs reached',
    tabClosed: 'Tab closed',
    undo: 'Undo',
    linkNewTab: 'Link opened in a new tab',
  },
};

/*
 * opts:
 *   bar       selector of the tab bar (default '#calcTabs')
 *   max       most tabs (default 12)
 *   autoName  function (tab) -> name shown while the tab has no own one
 *   label     optional function (tab, name) -> shown name (e.g. with a wave number)
 *   summary   function (tab) -> {text, past} or a string: key result below the name ('—' when empty)
 *   onSwitch  function (tab, previous): show the tab's state (previous is null after closing the active tab)
 *   onClose   optional function (tab) before a tab is removed
 *   onAdd     function (): the + button (usually ctl.open(...))
 *   persist   function (): store the tabs (ctl.saved(...))
 * Tabs are objects {id, name, state, ...own fields}.
 */
export function createTabs(opts) {
  var max = opts.max || 12;
  var bar = function () { return $(opts.bar || '#calcTabs'); };
  var seq = 0;
  var closed = null;
  var ctl = {list: [], active: null, max: max};

  function shown(tab) {
    var name = tab.name || opts.autoName(tab);
    return opts.label ? opts.label(tab, name) : name;
  }

  /* A new tab object (not yet in the list). */
  ctl.make = function (state, name, extra) {
    seq += 1;
    return Object.assign({id: 't' + seq, name: typeof name === 'string' && name ? name : null, state: state}, extra || {});
  };

  ctl.render = function () {
    var el = bar();
    if (!el) return;
    var many = ctl.list.length > 1;
    var html = ctl.list.map(function (tab) {
      return '<div class="ctab' + (tab === ctl.active ? ' active' : '') + '" data-tab="' + tab.id + '">'
        + '<button type="button" class="ctab-main" role="tab" aria-selected="' + (tab === ctl.active) + '" title="' + esc(t('tabRename')) + '">'
        + '<span class="ctab-name"></span><span class="ctab-sum"></span></button>'
        + (many ? '<button type="button" class="ctab-close" aria-label="' + esc(t('tabClose')) + '" title="' + esc(t('tabClose')) + '">×</button>' : '')
        + '</div>';
    }).join('');
    if (ctl.list.length < max) {
      html += '<button type="button" class="ctab-add" id="addTab" data-tab-add title="' + esc(t('tabNew')) + '" aria-label="' + esc(t('tabNewAria')) + '">+</button>';
    }
    el.innerHTML = html;
    ctl.update();
  };

  /* Names and key results only (cheap, after every change). */
  ctl.update = function () {
    var el = bar();
    if (!el) return;
    ctl.list.forEach(function (tab) {
      var box = el.querySelector('[data-tab="' + tab.id + '"]');
      if (!box) return;
      var name = box.querySelector('.ctab-name');
      if (name) name.textContent = shown(tab);
      var sum = opts.summary(tab);
      if (typeof sum === 'string') sum = {text: sum};
      var sumEl = box.querySelector('.ctab-sum');
      sumEl.textContent = sum && sum.text ? sum.text : '—';
      sumEl.classList.toggle('past', !!(sum && sum.past));
    });
  };

  ctl.switchTo = function (tab) {
    var prev = ctl.active;
    ctl.active = tab;
    opts.onSwitch(tab, prev);
    ctl.render();
    opts.persist();
  };

  /* Adds a tab after the active one and shows it; null at the maximum. */
  ctl.open = function (state, name, extra) {
    if (ctl.list.length >= max) {
      toast(t('tabsMax', {n: max}));
      return null;
    }
    var tab = ctl.make(state, name, extra);
    ctl.list.splice(ctl.list.indexOf(ctl.active) + 1, 0, tab);
    ctl.switchTo(tab);
    var box = bar() && bar().querySelector('[data-tab="' + tab.id + '"]');
    if (box && box.scrollIntoView) box.scrollIntoView({block: 'nearest', inline: 'nearest'});
    return tab;
  };

  ctl.close = function (tab) {
    if (ctl.list.length < 2) return;
    var index = ctl.list.indexOf(tab);
    if (opts.onClose) opts.onClose(tab);
    ctl.list.splice(index, 1);
    closed = {tab: tab, index: index};
    if (tab === ctl.active) {
      opts.onSwitch(ctl.active = ctl.list[Math.min(index, ctl.list.length - 1)], null);
      ctl.render();
      opts.persist();
    } else {
      ctl.render();
      opts.persist();
    }
    toast(t('tabClosed'), {label: t('undo'), fn: function () {
      if (!closed || ctl.list.length >= max) return;
      ctl.list.splice(Math.min(closed.index, ctl.list.length), 0, closed.tab);
      var restored = closed.tab;
      closed = null;
      ctl.switchTo(restored);
    }});
  };

  ctl.rename = function (tab) {
    var el = bar() && bar().querySelector('[data-tab="' + tab.id + '"] .ctab-name');
    if (!el) return;
    var input = document.createElement('input');
    input.className = 'ctab-rename';
    input.maxLength = 40;
    input.value = tab.name || opts.autoName(tab);
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
        tab.name = value && value !== opts.autoName(tab) ? value : null;
        opts.persist();
      }
      ctl.render();
    }
    input.addEventListener('keydown', function (e) {
      // Enter only names the tab (no submit of the page)
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
      if (e.key === 'Escape') { e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', function () { finish(true); });
  };

  ctl.bind = function () {
    var el = bar();
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-tab-add]')) {
        opts.onAdd();
        return;
      }
      var box = e.target.closest('[data-tab]');
      if (!box || e.target.closest('.ctab-rename')) return;
      var tab = ctl.byId(box.dataset.tab);
      if (e.target.closest('.ctab-close')) ctl.close(tab);
      else if (tab !== ctl.active) ctl.switchTo(tab);
    });
    el.addEventListener('dblclick', function (e) {
      var box = e.target.closest('[data-tab]');
      if (box && !e.target.closest('.ctab-close')) ctl.rename(ctl.byId(box.dataset.tab));
    });
  };

  ctl.byId = function (id) {
    return ctl.list.filter(function (x) { return x.id === id; })[0];
  };

  /* Restores stored tabs {active, tabs: [...]}; fromSaved(x) -> {state, name, ...own fields}. False when none. */
  ctl.restore = function (saved, fromSaved) {
    if (!saved || !Array.isArray(saved.tabs) || !saved.tabs.length) return false;
    saved.tabs.slice(0, max).forEach(function (x) {
      var tab = Object.assign({}, fromSaved(x || {}));
      var state = tab.state;
      var name = tab.name;
      delete tab.state;
      delete tab.name;
      ctl.list.push(ctl.make(state, name, tab));
    });
    ctl.active = ctl.list[Math.min(Math.max(0, saved.active | 0), ctl.list.length - 1)];
    return true;
  };

  /* Starts with a single tab (no stored ones). */
  ctl.start = function (state, name, extra) {
    ctl.list.push(ctl.make(state, name, extra));
    ctl.active = ctl.list[0];
  };

  /* A link at page load: a new tab next to the stored ones, else it fills the active tab; `extra`: the tab's own fields. */
  ctl.openAtStart = function (state, hadState, extra) {
    if (hadState && ctl.list.length < max) {
      var tab = ctl.make(state, null, extra);
      ctl.list.splice(ctl.list.indexOf(ctl.active) + 1, 0, tab);
      ctl.active = tab;
    } else {
      Object.assign(ctl.active, extra || {}, {state: state});
    }
  };

  /* What to store: toSaved(tab) -> plain object. */
  ctl.saved = function (toSaved) {
    return {active: ctl.list.indexOf(ctl.active), tabs: ctl.list.map(toSaved)};
  };

  return ctl;
}
