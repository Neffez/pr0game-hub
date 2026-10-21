// Extracts element names (tech: block) from the pr0game language files.
// Usage: node scripts/gen-tech.mjs <path-to-pr0game/language>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const langDir = process.argv[2];
if (!langDir) {
  console.error('usage: gen-tech.mjs <pr0game/language>');
  process.exit(1);
}

const out = {};
for (const lang of ['de', 'en', 'pi']) {
  const lines = readFileSync(join(langDir, lang, 'TECH.yaml'), 'utf8').split(/\r?\n/);
  // "tech:" = full names, "shortNames:" = abbreviations used in battle reports
  const block = (key) => {
    const names = {};
    for (const line of lines.slice(lines.indexOf(key) + 1)) {
      if (!line.startsWith('  ')) break;
      const m = line.match(/^\s+'?(\d+)'?:\s*(.+)$/);
      if (m) names[m[1]] = m[2].replace(/^'(.*)'$/, '$1').replace(/''/g, "'").trim();
    }
    return names;
  };
  out[lang] = block('tech:');
  out[`${lang}Short`] = block('shortNames:');
}
writeFileSync(new URL('../packages/parser/src/data/tech.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`de: ${Object.keys(out.de).length}, en: ${Object.keys(out.en).length}, pi: ${Object.keys(out.pi).length}`);
