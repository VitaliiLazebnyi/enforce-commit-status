# Requirements: Enforce Commit Status Action

This document serves as the single source of truth for the `enforce-commit-status` GitHub Action. It strictly represents current, active specifications.

## 1. Objective & Context

*   **Architecture**: Repository utilizes decoupled workflows; Workflow A (Tests) executes on commits; Workflow B (Build) executes on tag creation.
*   **Problem State**: Tag creation operates asynchronously with test execution; builds initiate irrespective of test status.
*   **Resolution**: Synchronous gatekeeper action; suspends build runner pending definitive test resolution; strictly prevents untested or failed code compilation.

### Requirements
*   **ECS-REQ-001 (Synchronous Gatekeeper)**: The action must operate as a synchronous gatekeeper, suspending the runner pending definitive test resolution and preventing execution if tests have not passed.

## 2. Technical Stack

*   **Implementation constraint**: TypeScript executing on Node.js.
*   **Language**: TypeScript—enforces strict structural typing for GitHub API JSON payloads; eliminates runtime type errors during state evaluation.
*   **Runtime**: Node.js (v24 LTS)—native execution environment for JavaScript GitHub Actions; ensures near-zero cold start latency.

### Core Dependencies
*   `@actions/core`: parses inputs; formats execution logs; manages state outputs and rigid exit codes.
*   `@actions/github`: instantiates pre-authenticated Octokit REST client; natively handles API pagination.
*   `ms`: parses human-readable duration strings (e.g., 15s, 45m, 1h) into standard millisecond integers.
*   **Build Tooling**: `@vercel/ncc`—compiles TypeScript source and dependencies into a deterministic, singular `index.js` artifact; bypasses `node_modules` resolution at runtime.

### Requirements
*   **ECS-REQ-002 (Platform & Runtime)**: The implementation must be in TypeScript and execute on Node.js v24 LTS.
*   **ECS-REQ-003 (Core Dependencies)**: The action must strictly use `@actions/core`, `@actions/github`, `ms`, and `@vercel/ncc` (for building the deterministic artifact).

## 3. State Evaluation Matrix

The action polls the GitHub API and evaluates the status and conclusion of the matched test run.

| API status | API conclusion | Action Output | Rationale |
| :--- | :--- | :--- | :--- |
| `completed` | `success` | PASS (Exit 0) | Proceed: Tests passed. |
| `completed` | `failure` | FAIL (Exit 1) | Halt: Tests failed. |
| `completed` | `cancelled`, `timed_out`, `action_required`, `skipped`, `stale` | FAIL (Exit 1) | Halt: Non-success resolution. |
| `queued`, `in_progress`, `waiting`, `pending` | `null` | WAIT (Poll) | Suspend: Tests executing. |
| (Empty API Response / 0 runs) | (None) | WAIT (Poll) | Suspend: Tests uninitiated. |

### Requirements
*   **ECS-REQ-004 (State: Success)**: If API status is `completed` and conclusion is `success`, the action must output PASS (Exit 0).
*   **ECS-REQ-005 (State: Failure)**: If API status is `completed` and conclusion is `failure`, the action must output FAIL (Exit 1).
*   **ECS-REQ-006 (State: Terminal Non-Success)**: If API status is `completed` and conclusion is `cancelled`, `timed_out`, `action_required`, `skipped`, or `stale`, the action must output FAIL (Exit 1).
*   **ECS-REQ-007 (State: Pending)**: If API status is `queued`, `in_progress`, `waiting`, or `pending` (with a `null` conclusion), the action must Suspend and Poll.
*   **ECS-REQ-008 (State: Uninitiated)**: If the API response contains 0 runs, the action must Suspend and Poll.

## 4. I/O Interface

### Inputs
| Input | Required | Default | Description |
| :--- | :--- | :--- | :--- |
| `workflow-id` | Yes | - | Filename or ID of the Tests workflow. |
| `commit-sha` | No | `${{ github.sha }}` | Target Commit SHA. |
| `github-token` | No | `${{ github.token }}` | Authentication token for Actions API. |
| `poll-interval` | No | `15s` | Polling frequency. Accepts duration strings (e.g., 10s, 1m). Minimum: `10s`. |
| `timeout` | No | `1h` | Maximum suspension duration. Accepts duration strings (e.g., 45m, 2h). |

### Outputs
| Output | Description |
| :--- | :--- |
| `final-status` | Resolved conclusion (`success`, `failure`, `timeout`). |
| `run-url` | HTML URL of matched test run. |

### Requirements
*   **ECS-REQ-009 (Input: workflow-id)**: Must accept a required `workflow-id` string.
*   **ECS-REQ-010 (Input: commit-sha)**: Must accept an optional `commit-sha` defaulting to the current GitHub SHA.
*   **ECS-REQ-011 (Input: github-token)**: Must accept an optional `github-token` defaulting to the GitHub API token.
*   **ECS-REQ-012 (Input: poll-interval)**: Must accept an optional `poll-interval` parsed via `ms` defaulting to `15s`, enforcing a strict minimum of `10s`.
*   **ECS-REQ-013 (Input: timeout)**: Must accept an optional `timeout` parsed via `ms` defaulting to `1h`.
*   **ECS-REQ-014 (Outputs Emission)**: The action must emit `final-status` and `run-url` as standard GitHub Actions outputs.

## 5. Execution Flow

Implementation strictly follows deterministic loop execution.

1.  **Initialization**: Parse inputs; convert duration strings to milliseconds via `ms`; calculate `timeout_boundary` (Current Time + `timeout`); verify SHA type. If `commit-sha` corresponds to annotated tag: resolve to underlying commit SHA.
2.  **Polling Engine**: Compare current time to `timeout_boundary`. If `current_time > timeout_boundary`: output timeout error; Exit 1. Send `GET /repos/{owner}/{repo}/actions/workflows/{workflow-id}/runs?head_sha={resolved_commit_sha}`.
3.  **Data Processing**: If `total_count == 0`: sleep `poll-interval`; loop step 2. If `total_count > 0`: sort array by `run_attempt` descending; isolate index `[0]`.
4.  **Evaluation**: Map isolated run to State Evaluation Matrix.
    *   **PASS**: Output `run-url`; Exit 0.
    *   **FAIL**: Output `run-url`; Exit 1.
    *   **WAIT**: Sleep `poll-interval`; loop step 2.

### Requirements
*   **ECS-REQ-015 (Initialization Logic)**: Must reliably parse duration strings to integers and calculate a definitive `timeout_boundary`.
*   **ECS-REQ-016 (Timeout Enforcement)**: The polling loop must exit with a failure (Exit 1) and record a timeout status when `current_time > timeout_boundary`.
*   **ECS-REQ-017 (Workflow Query)**: Queries must correctly invoke the Actions API referencing the `workflow-id` and `head_sha`.
*   **ECS-REQ-018 (Attempt Resolution)**: When multiple runs are returned, the result array must be sorted by `run_attempt` descending, exclusively evaluating the first index `[0]`.
*   **ECS-REQ-019 (Deterministic Polling)**: The implementation must use a deterministic loop, systematically sleeping for `poll-interval` without recursion.

## 6. Edge Case Mitigations

| Edge Case | Vector | Required Mitigation |
| :--- | :--- | :--- |
| **Annotated Tags** | `github.sha` yields tag object rather than commit object; API queries return 0 runs. | Execute `GET /repos/{o}/{r}/git/tags/{sha}`. If HTTP 200: extract `object.sha`. If HTTP 404: proceed with original SHA. |
| **Run Iterations** | Multiple attempts exist for identical SHA; older failures overshadow recent successes. | Sort API response by `run_attempt` descending; evaluate exclusively the `[0]` index. (Covered by ECS-REQ-018) |
| **Squash Merge** | Merging generates novel commit on target branch; tests executed on distinct PR commits. | Explicit configuration requirement: workflow must trigger on target branch push, or tag must target precise PR commit. |
| **Workflow Mismatch** | Tag pushed directly to target branch; tests configured strictly for PRs; 0 runs triggered. | Timeout constraint enforces failure; untested code remains unbuilt. |
| **API Volatility** | High-frequency polling triggers HTTP 429; network instability yields HTTP 5xx. | Enforce 10s minimum `poll-interval`; encapsulate API requests in try/catch blocks; bypass 5xx responses; retry on subsequent interval. |

### Requirements
*   **ECS-REQ-020 (Annotated Tag Resolution)**: If the provided SHA represents an annotated tag object, the action must dynamically resolve it to the underlying commit SHA via the Git Database API (handling 404s gracefully).
*   **ECS-REQ-021 (API Resilience)**: Network requests must be encapsulated in try/catch blocks; HTTP 5xx responses must be bypassed and retried; HTTP 429 must be mitigated via the minimum 10s `poll-interval`.

---

*[ARCHIVED]*
*(No obsolete requirements currently exist.)*
