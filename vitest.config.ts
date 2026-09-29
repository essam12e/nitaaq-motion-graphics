import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts', 'test/visual/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 300_000,
    pool: 'forks',
  },
});
