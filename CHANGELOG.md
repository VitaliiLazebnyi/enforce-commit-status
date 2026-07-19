# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed

- **Critical**: the packaged entrypoint never invoked `run()` — the `require.main === module` guard compiled to an always-false comparison in the ncc ESM bundle, so the shipped action was a fail-open no-op that exited 0 without polling. The entrypoint now calls `run()` unconditionally and CI smoke-tests the packaged bundle.
- Run selection now evaluates the most recent run (`created_at`, tie-broken by run id) instead of sorting by `run_attempt`, which contradicted the list endpoint's semantics and could select a stale re-run.
- Rate-limit 403 responses (with `x-ratelimit-remaining: 0` or `retry-after`) are retried like 429/5xx, honoring server-provided delays; annotated-tag resolution now shares the same resilience.
- Invalid `timeout` values now fail the action instead of silently substituting 1h; `poll-interval` clamping to the 10s minimum now emits a warning; negative/zero durations are rejected; durations are capped at Node's `setTimeout` limit (~24.8 days).
- `run-url` is now emitted on timeout when a run had been observed; `final-status: error` is emitted when the action itself fails before reaching a verdict.
- Annotated tags pointing at other annotated tags are peeled; tags pointing at trees/blobs fail fast instead of polling until timeout.
- `commit-sha` is validated as a full 40/64-hex SHA; empty `github-token` fails fast with an actionable message; the token is registered with `core.setSecret`.
- Unknown `workflow-id` values now fail with a contextual message instead of a bare `Not Found`.
- Bundled `undici` updated past the known HTTP header injection / WebSocket DoS advisories; dev-chain audit findings resolved.

### Added

- Real coverage enforcement (`collectCoverageFrom: src/**`), typecheck/format gates, packaged-bundle smoke test, lockfile registry check, SHA-pinned workflow actions, CodeQL, OpenSSF Scorecard, Dependabot, release verification workflow.
- LICENSE, SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, Marketplace branding.
