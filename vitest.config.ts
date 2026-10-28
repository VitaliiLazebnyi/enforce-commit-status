import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['__tests__/setup/warnings-as-errors.ts'],
    // The workers that run the code under test also fail on pending (documentation-only)
    // deprecations; the npm scripts as a whole run with --throw-deprecation (.npmrc).
    execArgv: ['--throw-deprecation', '--pending-deprecation'],
    // `.only` fails the run instead of silently narrowing it (also on a developer machine).
    allowOnly: false,
    passWithNoTests: false,
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'lcov', 'json-summary'],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100
      }
    }
  }
});
