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
  const m = line.match(/^\((\d+), (\d+), '[^']*', (\d+), (?:NULL|'[^']*'), '[^']*', \d+, ([\d.]+), (?:NULL|\d+), (\d+), (\d+), (\d+)/);
  if (m && m[2] === '0' && Number(m[3]) < 900) out[m[1]] = [Number(m[5]), Number(m[6]), Number(m[7]), Number(m[4])];
  if (line.trimEnd().endsWith(';')) break;
}
writeFileSync(new URL('../packages/parser/src/data/costs.json', import.meta.url), JSON.stringify(out) + '\n');
console.log(`${Object.keys(out).length} elements`);
