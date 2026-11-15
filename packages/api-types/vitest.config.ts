import { defineConfig } from 'vitest/config';

// test/types.test.ts asserts the helper types: checked by tsc in vitest's typecheck mode
export default defineConfig({ test: { typecheck: { enabled: true, include: ['test/types.test.ts'], tsconfig: 'tsconfig.test.json' } } });
