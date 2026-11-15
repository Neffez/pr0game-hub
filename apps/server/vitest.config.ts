import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // every JSON answer of the tests is checked against openapi.yaml (test/contract.ts)
    setupFiles: ['test/contractSetup.ts'],
  },
});
