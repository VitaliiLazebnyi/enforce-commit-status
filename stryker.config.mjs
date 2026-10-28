// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: 'npm',
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.ts' },
  // Mutants that do not compile are discarded by the TypeScript checker instead of being reported
  // as killed by a crashing test run.
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.stryker.json',
  typescriptChecker: { prioritizePerformanceOverAccuracy: false },
  mutate: ['src/**/*.ts'],
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  // Every mutant must be killed (or fail to compile): any survivor or uncovered mutant fails the run.
  thresholds: { high: 100, low: 100, break: 100 },
  ignoreStatic: false,
  timeoutMS: 10_000,
  concurrency: 4
};

export default config;
