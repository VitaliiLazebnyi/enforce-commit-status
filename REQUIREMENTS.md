# Requirements: Enforce Commit Status Action

This document serves as the single source of truth for the `enforce-commit-status` GitHub Action. It strictly represents current, active specifications.

## 1. Objective & Context

- **Architecture**: Repository utilizes decoupled workflows; Workflow A (Tests) executes on commits; Workflow B (Build) executes on tag creation.
- **Problem State**: Tag creation operates asynchronously with test execution; builds initiate irrespective of test status.
- **Resolution**: Synchronous gatekeeper action; suspends build runner pending definitive test resolution; strictly prevents untested or failed code compilation.

### Requirements

- **ECS-REQ-001 (Synchronous Gatekeeper)**: The action must operate as a synchronous gatekeeper, suspending the runner pending definitive test resolution and preventing execution if tests have not passed. The packaged entrypoint (`dist/index.js`) must invoke the polling logic unconditionally, and CI must smoke-test the packaged bundle to prove it executes.

## 2. Technical Stack

- **Implementation constraint**: TypeScript executing on Node.js.
- **Language**: TypeScript—enforces strict structural typing for GitHub API JSON payloads; eliminates runtime type errors during state evaluation.
- **Runtime**: Node.js (v24 LTS)—native execution environment for JavaScript GitHub Actions; ensures near-zero cold start latency.

### Core Dependencies

- `@actions/core`: parses inputs; formats execution logs; manages state outputs and rigid exit codes.
- `@actions/github`: instantiates pre-authenticated Octokit REST client. Note: plain REST calls return a single page; the action requests `per_page: 100`, which is sufficient for `head_sha`-filtered queries.
- `ms`: parses human-readable duration strings (e.g., 15s, 45m, 1h) into standard millisecond integers.
- **Build Tooling**: `@vercel/ncc`—compiles TypeScript source and dependencies into a deterministic, singular `index.js` artifact; bypasses `node_modules` resolution at runtime.

### Requirements

- **ECS-REQ-002 (Platform & Runtime)**: The implementation must be in TypeScript and execute on Node.js v24 LTS. `package.json` must declare a matching `engines` field and the Node type definitions must track the v24 line.
- **ECS-REQ-003 (Core Dependencies)**: The action must strictly use `@actions/core`, `@actions/github`, `ms`, and `@vercel/ncc` (for building the deterministic artifact).

## 3. State Evaluation Matrix

The action polls the GitHub API and evaluates the status and conclusion of the matched test run.

| API status                                                                                                                    | API conclusion                                                                                                                                            | Action Output | Rationale                                                                                                                                                                 |
| :---------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `completed`                                                                                                                   | `success`                                                                                                                                                 | PASS (Exit 0) | Proceed: Tests passed.                                                                                                                                                    |
| `completed`                                                                                                                   | Any other value (`failure`, `cancelled`, `timed_out`, `action_required`, `skipped`, `stale`, `neutral`, `startup_failure`, `null`, unknown/future values) | FAIL (Exit 1) | Halt: Fail-closed on any non-success resolution. Note: this is deliberately stricter than GitHub's own required-status-check semantics, which treat `neutral` as passing. |
| Any status other than `completed` (`queued`, `in_progress`, `waiting`, `pending`, `requested`, `null`, unknown/future values) | (any)                                                                                                                                                     | WAIT (Poll)   | Suspend: Tests not yet resolved.                                                                                                                                          |
| (Empty API Response / 0 runs)                                                                                                 | (None)                                                                                                                                                    | WAIT (Poll)   | Suspend: Tests uninitiated.                                                                                                                                               |

### Requirements

- **ECS-REQ-004 (State: Success)**: If API status is `completed` and conclusion is `success`, the action must output PASS (Exit 0).
- **ECS-REQ-005 (State: Failure)**: If API status is `completed` and conclusion is `failure`, the action must output FAIL (Exit 1).
- **ECS-REQ-006 (State: Terminal Non-Success)**: If API status is `completed` and conclusion is anything other than `success` (including `cancelled`, `timed_out`, `action_required`, `skipped`, `stale`, `neutral`, `startup_failure`, `null`, and unknown values), the action must output FAIL (Exit 1) — fail-closed by design.
- **ECS-REQ-007 (State: Pending)**: If API status is anything other than `completed` (including `queued`, `in_progress`, `waiting`, `pending`, `requested`, and unknown values), the action must Suspend and Poll.
- **ECS-REQ-008 (State: Uninitiated)**: If the API response contains 0 runs, the action must Suspend and Poll.

## 4. I/O Interface

### Inputs

| Input           | Required | Default               | Description                                                                                                                                        |
| :-------------- | :------- | :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workflow-id`   | Yes      | -                     | Filename or ID of the Tests workflow (e.g., `tests.yml`).                                                                                          |
| `commit-sha`    | No       | `${{ github.sha }}`   | Target Commit SHA (full 40- or 64-character hash). Annotated tags are automatically resolved to their underlying commit.                           |
| `github-token`  | No       | `${{ github.token }}` | Authentication token for the Actions API. Requires `actions:read` (and `contents:read` for annotated-tag resolution).                              |
| `poll-interval` | No       | `15s`                 | Polling frequency. Accepts duration strings (e.g., `10s`, `1m`). Minimum: `10s` (lower values are clamped with a warning).                         |
| `timeout`       | No       | `1h`                  | Maximum suspension duration before failing the step. Accepts duration strings (e.g., `45m`, `2h`). Invalid or non-positive values fail the action. |

### Outputs

| Output         | Description                                                                                                            |
| :------------- | :--------------------------------------------------------------------------------------------------------------------- |
| `final-status` | Resolved conclusion: `success`, `failure`, `timeout`, or `error` (the action itself failed before reaching a verdict). |
| `run-url`      | HTML URL of the matched test run. Also emitted on timeout when a run was observed; unset if no run was ever matched.   |

### Requirements

- **ECS-REQ-009 (Input: workflow-id)**: Must accept a required `workflow-id` string; a missing value must fail the action immediately.
- **ECS-REQ-010 (Input: commit-sha)**: Must accept an optional `commit-sha` defaulting to the current GitHub SHA. The value must be validated as a full commit SHA (40 or 64 hex characters, after trimming); anything else fails fast with a descriptive error. A valid SHA is lower-cased before polling: the API reports and filters `head_sha` in lower case.
- **ECS-REQ-011 (Input: github-token)**: Must accept an optional `github-token` defaulting to the GitHub API token. An explicitly empty token must fail fast with an actionable message, and the token must be registered as a secret (`core.setSecret`).
- **ECS-REQ-012 (Input: poll-interval)**: Must accept an optional `poll-interval` parsed via `ms` defaulting to `15s`, enforcing a strict minimum of `10s`. Sub-minimum values are clamped to `10s` with a visible warning; unparsable or non-positive values fail the action.
- **ECS-REQ-013 (Input: timeout)**: Must accept an optional `timeout` parsed via `ms` defaulting to `1h`. Unparsable or non-positive values must fail the action with `Invalid duration format: <value>` / `Duration must be positive: <value>` — there is no silent fallback. Durations are capped at 2,147,483,647 ms (~24.8 days, Node's `setTimeout` limit).
- **ECS-REQ-014 (Outputs Emission)**: The action must emit `final-status` on every exit path (`success`, `failure`, `timeout`, or `error`), and `run-url` whenever a run was matched — including the timeout path when a pending run had been observed.

## 5. Execution Flow

Implementation strictly follows deterministic loop execution.

1. **Initialization**: Parse and validate inputs; convert duration strings to milliseconds via `ms`; calculate `timeout_boundary` (Current Time + `timeout`).
2. **Polling Engine**: Compare current time to `timeout_boundary`. If `current_time > timeout_boundary`: output timeout status (and `run-url` if a run was observed); Exit 1. On the first successful iteration, resolve annotated tags to the underlying commit SHA (inside the resilient request wrapper). Send `GET /repos/{owner}/{repo}/actions/workflows/{workflow-id}/runs?head_sha={resolved_commit_sha}&per_page=100`.
3. **Data Processing**: If `total_count == 0`: sleep `poll-interval` (bounded by remaining timeout budget); loop step 2. If `total_count > 0`: select the most recent run (maximum `created_at`, ties broken by run `id`).
4. **Evaluation**: Map the selected run to the State Evaluation Matrix.
   - **PASS**: Output `run-url`; Exit 0.
   - **FAIL**: Output `run-url`; Exit 1.
   - **WAIT**: Sleep `poll-interval` (bounded by remaining timeout budget); loop step 2.

### Requirements

- **ECS-REQ-015 (Initialization Logic)**: Must reliably parse duration strings to integers and calculate a definitive `timeout_boundary`.
- **ECS-REQ-016 (Timeout Enforcement)**: The polling loop must exit with a failure (Exit 1) and record a timeout status when `current_time > timeout_boundary`. Sleeps must be bounded by the remaining timeout budget so the configured timeout is a ceiling (± one loop iteration's API latency), not a floor.
- **ECS-REQ-017 (Workflow Query)**: Queries must correctly invoke the Actions API referencing the `workflow-id` and `head_sha`, requesting `per_page: 100`.
- **ECS-REQ-018 (Run Selection)**: The list endpoint returns one entry per workflow run, each already reflecting only its latest attempt (previous attempts are only reachable via the separate attempts endpoint). When multiple runs are returned, the action must evaluate exclusively the most recent run — maximum `created_at`, ties broken by run `id`. _(Revised: the previous `run_attempt`-descending sort contradicted real API semantics and could select a stale re-run.)_
- **ECS-REQ-019 (Deterministic Polling)**: The implementation must use a deterministic loop, systematically sleeping for `poll-interval` without recursion.

## 6. Edge Case Mitigations

| Edge Case             | Vector                                                                                                                    | Required Mitigation                                                                                                                                                                                                                                                               |
| :-------------------- | :------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Annotated Tags**    | `github.sha` yields tag object rather than commit object; API queries return 0 runs.                                      | Execute `GET /repos/{o}/{r}/git/tags/{sha}`. If HTTP 200 with `object.type == 'commit'`: use `object.sha`. If `object.type == 'tag'` (nested annotated tags): peel iteratively (depth cap 10). If the tag targets a tree/blob: fail fast. If HTTP 404: proceed with original SHA. |
| **Multiple Runs**     | Several runs exist for an identical SHA (re-runs, multiple trigger events); a stale run could overshadow the current one. | Select the most recent run by `created_at` (ties broken by `id`); evaluate exclusively that run. (Covered by ECS-REQ-018)                                                                                                                                                         |
| **Squash Merge**      | Merging generates novel commit on target branch; tests executed on distinct PR commits.                                   | Explicit configuration requirement: workflow must trigger on target branch push, or tag must target precise PR commit.                                                                                                                                                            |
| **Workflow Mismatch** | Tag pushed directly to target branch; tests configured strictly for PRs; 0 runs triggered.                                | Timeout constraint enforces failure; untested code remains unbuilt.                                                                                                                                                                                                               |
| **API Volatility**    | High-frequency polling triggers HTTP 429 or rate-limit 403; network instability yields HTTP 5xx.                          | Enforce 10s minimum `poll-interval`; encapsulate API requests (including tag resolution) in try/catch blocks; retry 5xx, 429, and 403-with-rate-limit-headers responses on the next interval, honoring `retry-after`, or `x-ratelimit-reset` once the quota is exhausted.         |

### Requirements

- **ECS-REQ-020 (Annotated Tag Resolution)**: If the provided SHA represents an annotated tag object, the action must dynamically resolve it to the underlying **commit** SHA via the Git Database API — peeling nested tag objects (bounded depth) and failing fast when a tag targets a non-commit object — while handling 404s gracefully.
- **ECS-REQ-021 (API Resilience)**: All network requests (tag resolution and run polling) must be encapsulated in try/catch blocks. HTTP 5xx, HTTP 429, and HTTP 403 responses carrying rate-limit headers (`x-ratelimit-remaining: 0` or `retry-after`) must be bypassed and retried on the subsequent interval, honoring a server-provided `retry-after` delay or, when the quota is exhausted (`x-ratelimit-remaining: 0`), the `x-ratelimit-reset` time. GitHub sends `x-ratelimit-reset` on every response, so it is ignored while quota remains. All other errors fail the action immediately, emitting `final-status: error`. _(Revised: previously named only 5xx and 429.)_

---

_[ARCHIVED]_

- **ECS-REQ-018 (pre-revision)**: "Sort the result array by `run_attempt` descending and evaluate index `[0]`." Obsolete: the list endpoint returns one entry per run (latest attempt only), so attempts of the same run never coexist in the response; sorting different runs by `run_attempt` could select a stale, manually re-run workflow over a newer run.
- **ECS-REQ-013 (pre-revision)**: silent fallback to 1h for unparsable timeout values. Obsolete: invalid input now fails the action explicitly.
