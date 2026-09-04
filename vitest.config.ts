import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.test.tsx',
      'packages/*/src/**/*.integration.test.ts',
    ],
    testTimeout: 20000,
    environment: 'node',
    passWithNoTests: true,
  },
});
