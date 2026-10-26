/* Battle simulator worker: runs the battles on the Battlerust engine (WebAssembly) off the page's thread and reports
   progress; the page terminates it to cancel. */
import init, { wasm_fight_battle_rounds } from '@pr0hub/battle/wasm';
import wasmUrl from '@pr0hub/battle/wasm/battlerust_bg.wasm?url';
import { runBattle, summarize } from '@pr0hub/battle';

var ready = init({ module_or_path: wasmUrl });

self.onmessage = function (e) {
  var job = e.data;
  ready.then(function () {
    var list = [];
    var last = Date.now();
    for (var i = 0; i < job.runs; i++) {
      list.push(runBattle(wasm_fight_battle_rounds, job.setup, job.settings));
      if (Date.now() - last > 100) {
        last = Date.now();
        self.postMessage({ id: job.id, type: 'progress', done: i + 1 });
      }
    }
    self.postMessage({ id: job.id, type: 'done', summary: summarize(list) });
  }).catch(function (err) {
    self.postMessage({ id: job.id, type: 'error', message: String(err && err.message || err) });
  });
};
