/* Battle simulator worker: runs the battles on the Battlerust engine (WebAssembly) off the page's thread and reports
   progress; the page terminates it to cancel. */
import init, { wasm_fight_battle_rounds } from '@pr0hub/battle/wasm';
import wasmUrl from '@pr0hub/battle/wasm/battlerust_bg.wasm?url';
import { simulateRefined } from '@pr0hub/battle';
import { unitCatalog } from '@pr0hub/core/units';

var ready = init({ module_or_path: wasmUrl });

self.onmessage = function (e) {
  var job = e.data;
  ready.then(function () {
    var units = unitCatalog(job.units || {});
    var last = Date.now();
    // small battles run longer than asked for, until their loss chances are steady
    var summary = simulateRefined(wasm_fight_battle_rounds, job.setup, job.runs, job.settings, {
      units: units,
      progress: function (share) {
        if (Date.now() - last <= 100) return;
        last = Date.now();
        self.postMessage({ id: job.id, type: 'progress', share: share });
      },
    });
    self.postMessage({ id: job.id, type: 'done', summary: summary });
  }).catch(function (err) {
    self.postMessage({ id: job.id, type: 'error', message: String(err && err.message || err) });
  });
};
