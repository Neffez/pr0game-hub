// Extracts element costs (cost901-903, factor) from the pr0game install.sql for point calculations, and per building
// the planet types, the max level and the requirements (buildings page), per research the max level, the last useful
// level and the requirements (research page).
// Usage: node scripts/gen-costs.mjs <path-to-pr0game/install/install.sql>
import { readFileSync, writeFileSync } from 'node:fs';

const sqlFile = process.argv[2];
if (!sqlFile) {
  console.error('usage: gen-costs.mjs <pr0game/install/install.sql>');
  process.exit(1);
}

const lines = readFileSync(sqlFile, 'utf8').split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith('INSERT INTO `%PREFIX%vars` ('));
const out = {};
const buildings = {};
const research = {};
for (const line of lines.slice(start + 1)) {
  // research: class 100/101, max level, max_useful_level as the last column
  const t = line.match(/^\((1\d\d), 0, '[^']*', 10[01], NULL, '[\d,]+', \d+, [\d.]+, (\d+),.*, (\d+)\),?$/);
  if (t) research[t[1]] = { max: Number(t[2]), useful: Number(t[3]), req: {} };
  const b = line.match(/^\((\d+), 0, '[^']*', 0, NULL, '([\d,]+)', \d+, [\d.]+, (\d+),/);
  if (b && Number(b[1]) < 100) {
    // onPlanetType: 1 planet, 3 moon
    const on = b[2].split(',').map((t) => (t === '3' ? 'moon' : 'planet'));
    buildings[b[1]] = { on, max: Number(b[3]), req: {} };
  }
  // elementID, universe, name, class, ship_type, onPlanetType, onePerPlanet, factor, maxLevel, cost901, cost902, cost903
  // Some rows (shield domes, missiles) have NULL as class and the class number one column later: only id and costs matter here.
  const m = line.match(/^\((\d+), (\d+), '[^']*', (?:NULL|\d+), (?:NULL|\d+|'[^']*'), '[^']*', \d+, ([\d.]+), (?:NULL|\d+), (\d+), (\d+), (\d+)/);
  if (m && m[2] === '0' && Number(m[1]) < 900) out[m[1]] = [Number(m[4]), Number(m[5]), Number(m[6]), Number(m[3])];
  if (line.trimEnd().endsWith(';')) break;
}
// Ships added to the game later are missing in install.sql: costs from the game's info pages.
const extra = {
  222: [30000, 12000, 5000, 1], // Schwerer Kreuzer
  225: [7500, 2500, 0, 1], // Sturmtransporter
  227: [26000, 14000, 5000, 1], // Optimierter Recycler
  231: [500000, 400000, 100000, 1], // Behemoth
  232: [0, 9000000, 0, 1], // Void Titan
};
for (const [id, c] of Object.entries(extra)) out[id] ??= c;
// Costs changed in the running game, install.sql still has the old values.
const changed = {
  205: [6500, 3500, 0, 1], // Schwerer Jäger (install.sql: 6000/4000)
};
Object.assign(out, changed);
writeFileSync(new URL('../packages/parser/src/data/costs.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(`${Object.keys(out).length} elements`);

const reqStart = lines.findIndex((l) => l.startsWith('INSERT INTO `%PREFIX%vars_requriements` ('));
for (const line of lines.slice(reqStart + 1)) {
  // elementID, universe, requireID, requireLevel
  const m = line.match(/^\((\d+), 0, (\d+), (\d+)\)/);
  if (m && buildings[m[1]]) buildings[m[1]].req[m[2]] = Number(m[3]);
  if (m && research[m[1]]) research[m[1]].req[m[2]] = Number(m[3]);
  if (line.trimEnd().endsWith(';')) break;
}
writeFileSync(new URL('../packages/parser/src/data/buildings.json', import.meta.url), JSON.stringify(buildings) + '\n');
console.log(`${Object.keys(buildings).length} buildings`);
writeFileSync(new URL('../packages/parser/src/data/research.json', import.meta.url), JSON.stringify(research) + '\n');
console.log(`${Object.keys(research).length} research`);
