# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed

- Upper-case `commit-sha` values were accepted but polled verbatim; the API reports and filters
  `head_sha` in lower case, so such a gate never matched a run and timed out. The SHA is now
  lower-cased before polling.
- A retryable error (5xx, 429) whose response carried `x-ratelimit-reset` while quota remained made
  the action wait until the rate-limit window reset (up to an hour, capped by `timeout`) instead of
  retrying on the next interval. `x-ratelimit-reset` is now honored only when
  `x-ratelimit-remaining` is `0`.
- **Critical**: the packaged entrypoint never invoked `run()` — the `require.main === module` guard
  compiled to an always-false comparison in the ncc ESM bundle, so the shipped action was a
  fail-open no-op that exited 0 without polling. The entrypoint now calls `run()` unconditionally
  and CI smoke-tests the packaged bundle.
- Run selection now evaluates the most recent run (`created_at`, tie-broken by run id) instead of
  sorting by `run_attempt`, which contradicted the list endpoint's semantics and could select a
  stale re-run.
- Rate-limit 403 responses (with `x-ratelimit-remaining: 0` or `retry-after`) are retried like
  429/5xx, honoring server-provided delays; annotated-tag resolution now shares the same resilience.
- Invalid `timeout` values now fail the action instead of silently substituting 1h; `poll-interval`
  clamping to the 10s minimum now emits a warning; negative/zero durations are rejected; durations
  are capped at Node's `setTimeout` limit (~24.8 days).
- `run-url` is now emitted on timeout when a run had been observed; `final-status: error` is emitted
  when the action itself fails before reaching a verdict.
- Annotated tags pointing at other annotated tags are peeled; tags pointing at trees/blobs fail fast
  instead of polling until timeout.
- `commit-sha` is validated as a full 40/64-hex SHA; empty `github-token` fails fast with an
  actionable message; the token is registered with `core.setSecret`.
- Unknown `workflow-id` values now fail with a contextual message instead of a bare `Not Found`.
- Bundled `undici` updated past the known HTTP header injection / WebSocket DoS advisories;
  dev-chain audit findings resolved.

### Added

- Zero-warning, zero-suppression quality gates: strict `tsc`, ESLint `strictTypeChecked` with
  additional plugins and `--max-warnings 0`, Vitest with 100% coverage and warnings-as-errors,
  Stryker mutation testing (every mutant killed), knip, jscpd, rumdl (Markdown), typos, actionlint,
  ShellCheck, zizmor, gitleaks, an outdated-dependency check with documented holds, a suppression
  scanner and a warning gate in every workflow.
- The underlying API error of a wrapped failure (e.g. an unknown workflow) is logged at debug level.
- Real coverage enforcement (`collectCoverageFrom: src/**`), typecheck/format gates, packaged-bundle
  smoke test, lockfile registry check, SHA-pinned workflow actions, CodeQL, OpenSSF Scorecard,
  Dependabot, release verification workflow.
- LICENSE, SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, Marketplace branding.

### Changed

- Every rule of ESLint, `typescript-eslint` and every ESLint plugin is an error; the few rules that
  are off say why in `eslint.config.ts` (now TypeScript). The polling loop is split into small,
  typed functions (`src/inputs.ts`, `src/runs.ts`, `src/requests.ts`); behavior is unchanged.
- `script/check` runs every check, locally and in CI. New checks: yamllint (strict, every rule but
  key ordering), editorconfig-checker, shfmt, ShellCheck at every severity (also on the `run:`
  blocks of the workflows), knip in production mode, MD013 and every opt-in rule of rumdl, and the
  zizmor binary with its online audits.
- Every CI job blocks network egress except the endpoints it lists
  (`step-security/harden-runner`); `setup-node` no longer caches dependencies; Dependency review
  fails on vulnerabilities in development dependencies too; npm is installed from a tarball verified
  against the SHA-512 of `packageManager`; Dependabot also updates the Python tools.
- Tests run on Vitest instead of Jest: Jest's ESM mode needs `--experimental-vm-modules` (an
  `ExperimentalWarning` on every run) and Jest 30 depends on `deepmerge`, which has an advisory
  (GHSA-gcqx-w48m-w2h4) without a fixed release.
- Every dependency, GitHub Action and CI tool updated to its newest release (holds documented in
  `script/outdated.json`).
- Dependencies refreshed on 2026-11-07: npm 12.2.2, ESLint 10.14.0, Vitest 5.1.0, knip 6.44.2,
  `eslint-plugin-jsdoc` 65.4.5, `eslint-plugin-regexp` 3.3.3, typos 1.52.0, `github/codeql-action`
  4.39.3 and `zizmorcore/zizmor-action` 0.8.1. The development dependency `minimatch` is overridden
  to 11.0.5 to resolve GHSA-g3hv-75wg-m249 (no release of ESLint, `typescript-eslint` or Stryker
  allows minimatch 11 yet). The bundled runtime is unchanged.
