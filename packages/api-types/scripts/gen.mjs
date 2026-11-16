import { writeFileSync } from 'node:fs';
import { generate, OUT } from './generate.mjs';

writeFileSync(OUT, await generate());
console.log(`wrote ${OUT.pathname}`);
