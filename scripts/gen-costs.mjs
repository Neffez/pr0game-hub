// Extracts element costs (cost901-903, factor) from the pr0game install.sql for point calculations.
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
for (const line of lines.slice(start + 1)) {
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
