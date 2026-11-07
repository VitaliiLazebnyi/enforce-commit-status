/**
 * @file Every Node.js process warning (deprecations, experimental features, unhandled-rejection
 * notices, MaxListenersExceeded, ...) fails the test run. `--throw-deprecation` (see .npmrc)
 * covers deprecations raised before this file runs.
 */
process.on('warning', (warning: Readonly<Error>) => {
  throw new Error(`Node.js process warning: ${warning.name}: ${warning.message}`, {
    cause: warning
  });
});
