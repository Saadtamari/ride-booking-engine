import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The 50-concurrent tests do real DB work; give them headroom.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Run test files serially so they don't fight over the same Postgres rows.
    fileParallelism: false,
  },
});
