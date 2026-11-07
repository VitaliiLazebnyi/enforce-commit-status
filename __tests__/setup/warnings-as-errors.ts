// Every Node.js process warning (deprecations, experimental features, unhandled-rejection notices,
// MaxListenersExceeded, ...) fails the test run. `--throw-deprecation` (see package.json) covers
// deprecations raised before this file runs.
process.on('warning', warning => {
  throw warning;
});
