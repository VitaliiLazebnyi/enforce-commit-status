// @ts-check

/**
 * @file Stryker configuration: every mutant of src/ must be killed (or fail to compile).
 * @import { PartialStrykerOptions } from '@stryker-mutator/api/core'
 */

/**
 * @type {PartialStrykerOptions}
 */
const config = {
  // Mutants that do not compile are discarded by the TypeScript checker instead of being reported
  // as killed by a crashing test run.
  checkers: ['typescript'],
  concurrency: 4,
  coverageAnalysis: 'perTest',
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  ignoreStatic: false,
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  mutate: ['src/**/*.ts'],
  packageManager: 'npm',
  reporters: ['clear-text', 'progress', 'html', 'json'],
  testRunner: 'vitest',
  // Any survivor or uncovered mutant fails the run.
  thresholds: { break: 100, high: 100, low: 100 },
  timeoutMS: 10_000,
  tsconfigFile: 'tsconfig.stryker.json',
  typescriptChecker: { prioritizePerformanceOverAccuracy: false },
  vitest: { configFile: 'vitest.config.ts' }
};

export default config;
