/**
 * @file Vitest configuration: 100% coverage of src/, and any process warning fails the run.
 */
import { defineConfig } from 'vitest/config';

// The length of a SHA-1 commit id in hex digits.
const SHA1_HEX_LENGTH = 40;

export default defineConfig({
  test: {
    // `.only` fails the run instead of silently narrowing it (also on a developer machine).
    allowOnly: false,
    clearMocks: true,
    coverage: {
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        perFile: true,
        statements: 100
      }
    },
    // The GitHub Actions context of the tests (github.context reads it when it is imported).
    env: {
      GITHUB_REPOSITORY: 'mock-owner/mock-repo',
      GITHUB_SHA: 'b'.repeat(SHA1_HEX_LENGTH)
    },
    environment: 'node',
    // The workers that run the code under test also fail on pending (documentation-only)
    // deprecations; the npm scripts as a whole run with --throw-deprecation (.npmrc).
    execArgv: ['--throw-deprecation', '--pending-deprecation'],
    // A test without an assertion fails.
    expect: { requireAssertions: true },
    include: ['test/**/*.test.ts'],
    passWithNoTests: false,
    restoreMocks: true,
    setupFiles: ['test/setup/warnings-as-errors.ts']
  }
});
