import * as core from '@actions/core';
import * as github from '@actions/github';
import { utils } from './utils.js';

// ECS-REQ-012: strict minimum polling frequency.
const MIN_POLL_INTERVAL_MS = 10_000;

// Full SHA-1 (40 hex chars) or SHA-256 (64 hex chars) object id.
const COMMIT_SHA_PATTERN = /^[\da-f]{40}(?:[\da-f]{24})?$/i;

interface WorkflowRunLike {
  created_at: string;
  id: number;
}

interface Inputs {
  workflowId: string;
  commitSha: string;
  token: string;
  pollIntervalMs: number;
  timeoutRaw: string;
  timeoutMs: number;
}

/**
 * ECS-REQ-018: the list endpoint returns one entry per run, each already
 * reflecting only its latest attempt, so the most recent run is selected
 * (by created_at, tie-broken by id) rather than sorting by run_attempt.
 * @param runs - The (non-empty) runs of the workflow for the commit.
 * @returns The most recent run.
 */
function selectMostRecentRun<T extends WorkflowRunLike>(runs: readonly [T, ...T[]]): T {
  const createdAt = (run: T): number => Date.parse(run.created_at) || 0;
  const [first, ...rest] = runs;
  let latest = first;
  for (const candidate of rest) {
    const order = createdAt(candidate) - createdAt(latest) || candidate.id - latest.id;
    if (order > 0) {
      latest = candidate;
    }
  }
  return latest;
}

/**
 * Reads and validates the action inputs (ECS-REQ-009..013, ECS-REQ-015).
 * @returns The validated inputs.
 * @throws {Error} When an input is missing or invalid.
 */
function readInputs(): Inputs {
  const workflowId = core.getInput('workflow-id', { required: true });
  const token = core.getInput('github-token');
  if (!token) {
    throw new Error(
      "Input 'github-token' is required; pass ${{ github.token }} or a PAT with actions:read."
    );
  }
  core.setSecret(token);

  const commitSha = (core.getInput('commit-sha') || github.context.sha).trim();
  if (!COMMIT_SHA_PATTERN.test(commitSha)) {
    throw new Error(
      `Input 'commit-sha' must be a full commit SHA (40 or 64 hex characters), got '${commitSha}'.`
    );
  }

  const pollIntervalRaw = core.getInput('poll-interval') || '15s';
  let pollIntervalMs = utils.parseDuration(pollIntervalRaw);
  if (pollIntervalMs < MIN_POLL_INTERVAL_MS) {
    core.warning(`poll-interval '${pollIntervalRaw}' is below the 10s minimum; using 10s.`);
    pollIntervalMs = MIN_POLL_INTERVAL_MS;
  }
  const timeoutRaw = core.getInput('timeout') || '1h';
  const timeoutMs = utils.parseDuration(timeoutRaw);

  return {
    workflowId,
    // The API reports (and filters `head_sha` by) lower-case object ids.
    commitSha: commitSha.toLowerCase(),
    token,
    pollIntervalMs,
    timeoutRaw,
    timeoutMs
  };
}

/**
 * Formats a caught value as a failure message.
 * @param error - The caught value.
 * @returns The message to report.
 */
function errorMessage(error: unknown): string {
  // Error instances and Octokit's plain error objects both carry a message.
  return typeof error === 'object' && error !== null && 'message' in error
    ? String(error.message)
    : 'An unexpected error occurred.';
}

/**
 * Polls the workflow runs of the commit until the most recent one resolves or the timeout
 * expires, and reports the verdict.
 * @param inputs - The validated inputs.
 * @returns A promise that resolves once the verdict is reported.
 */
async function poll(inputs: Inputs): Promise<void> {
  const { workflowId, commitSha, pollIntervalMs, timeoutRaw } = inputs;
  const timeoutBoundary = Date.now() + inputs.timeoutMs;
  const octokit = github.getOctokit(inputs.token);
  const { owner, repo } = github.context.repo;

  // ECS-REQ-016: sleeps never run the wall clock meaningfully past the
  // boundary (the +1 lets the strict '>' check fire after a capped sleep).
  const boundedSleep = (desiredMs: number): Promise<void> =>
    utils.sleep(Math.min(desiredMs, timeoutBoundary - Date.now() + 1));

  let resolvedSha: string | undefined;
  let lastRunUrl: string | undefined;

  // Deterministic Polling Loop (ECS-REQ-019)
  for (;;) {
    // Check timeout boundary (ECS-REQ-016)
    if (Date.now() > timeoutBoundary) {
      core.setOutput('final-status', 'timeout');
      if (lastRunUrl !== undefined) {
        core.setOutput('run-url', lastRunUrl);
      }
      core.setFailed(`Timeout exceeded (${timeoutRaw}) while waiting for test resolution.`);
      return;
    }

    let runs;
    try {
      // Resolve annotated tags once (ECS-REQ-020), inside the resilient
      // wrapper so transient errors during resolution retry (ECS-REQ-021).
      if (resolvedSha === undefined) {
        resolvedSha = await utils.resolveCommitSha(octokit, owner, repo, commitSha);
        core.info(`Resolved SHA for polling: ${resolvedSha}`);
      }

      // Query Workflow Runs (ECS-REQ-017)
      const response = await octokit.rest.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id: workflowId,
        head_sha: resolvedSha,
        per_page: 100
      });
      runs = response.data.workflow_runs;
    } catch (error: unknown) {
      // API Resilience (ECS-REQ-021): retry 5xx, 429, and rate-limit 403s,
      // honoring retry-after / x-ratelimit-reset when provided.
      if (utils.isRetryableApiError(error)) {
        const status = String(utils.getErrorStatus(error));
        core.warning(`API error encountered (${status}). Retrying next interval.`);
        await boundedSleep(Math.max(pollIntervalMs, utils.getRetryAfterMs(error)));
        continue;
      }
      // Tag-resolution 404s are consumed inside resolveCommitSha, so a 404
      // here always means the workflow itself was not found.
      if (utils.getErrorStatus(error) === 404) {
        throw new Error(
          `Workflow '${workflowId}' not found in ${owner}/${repo} (HTTP 404). ` +
            `Check the workflow-id input and the token's actions:read permission.`,
          { cause: error }
        );
      }
      throw error;
    }

    // Check for 0 runs (ECS-REQ-008)
    const [firstRun, ...otherRuns] = runs;
    if (firstRun === undefined) {
      core.info(`No workflow runs found for SHA ${resolvedSha}. Suspending and polling...`);
      await boundedSleep(pollIntervalMs);
      continue;
    }

    // Select the most recent run (ECS-REQ-018)
    const targetRun = selectMostRecentRun([firstRun, ...otherRuns]);
    lastRunUrl = targetRun.html_url;

    // Evaluation Matrix
    if (targetRun.status === 'completed') {
      core.setOutput('run-url', targetRun.html_url);
      if (targetRun.conclusion === 'success') {
        // ECS-REQ-004
        core.setOutput('final-status', 'success');
        core.info('Tests completed successfully.');
      } else {
        // ECS-REQ-005, ECS-REQ-006: any non-success conclusion fails closed.
        core.setOutput('final-status', 'failure');
        core.setFailed(`Tests failed with conclusion: ${targetRun.conclusion ?? 'unknown'}`);
      }
      return;
    }

    // Pending state (ECS-REQ-007): any non-completed status waits.
    core.info(
      `Tests currently in state: ${targetRun.status ?? 'unknown'}. Suspending and polling...`
    );
    await boundedSleep(pollIntervalMs);
  }
}

/**
 * Runs the action: validates the inputs, then gates on the test workflow of the commit.
 * Every failure is reported through `core.setFailed`; the returned promise never rejects.
 * @returns A promise that resolves once the verdict (or the error) is reported.
 */
export async function run(): Promise<void> {
  try {
    await poll(readInputs());
  } catch (error: unknown) {
    core.setOutput('final-status', 'error');
    core.setFailed(errorMessage(error));
    // The underlying API error of a wrapped failure, for step debug logging.
    if (error instanceof Error && error.cause !== undefined) {
      core.debug(`Caused by: ${errorMessage(error.cause)}`);
    }
  }
}
