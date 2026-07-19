import * as core from '@actions/core';
import * as github from '@actions/github';
import { utils } from './utils.js';

// ECS-REQ-012: strict minimum polling frequency.
const MIN_POLL_INTERVAL_MS = 10000;

// Full SHA-1 (40 hex chars) or SHA-256 (64 hex chars) object id.
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}([0-9a-f]{24})?$/i;

interface WorkflowRunLike {
  created_at: string;
  id: number;
}

/**
 * ECS-REQ-018: the list endpoint returns one entry per run, each already
 * reflecting only its latest attempt, so the most recent run is selected
 * (by created_at, tie-broken by id) rather than sorting by run_attempt.
 */
function selectMostRecentRun<T extends WorkflowRunLike>(runs: T[]): T {
  return runs.reduce((latest, candidate) => {
    const latestTime = Date.parse(latest.created_at) || 0;
    const candidateTime = Date.parse(candidate.created_at) || 0;
    if (candidateTime !== latestTime) {
      return candidateTime > latestTime ? candidate : latest;
    }
    return candidate.id > latest.id ? candidate : latest;
  });
}

export async function run(): Promise<void> {
  try {
    // 1. Initialization (ECS-REQ-015)
    const workflowId = core.getInput('workflow-id', { required: true });
    const commitSha = (core.getInput('commit-sha') || github.context.sha).trim();
    const token = core.getInput('github-token');
    const pollIntervalRaw = core.getInput('poll-interval') || '15s';
    const timeoutRaw = core.getInput('timeout') || '1h';

    if (!token) {
      throw new Error(
        "Input 'github-token' is required; pass ${{ github.token }} or a PAT with actions:read."
      );
    }
    core.setSecret(token);

    if (!COMMIT_SHA_PATTERN.test(commitSha)) {
      throw new Error(
        `Input 'commit-sha' must be a full commit SHA (40 or 64 hex characters), got '${commitSha}'.`
      );
    }

    const requestedIntervalMs = utils.parseDuration(pollIntervalRaw);
    let pollIntervalMs = requestedIntervalMs;
    if (requestedIntervalMs < MIN_POLL_INTERVAL_MS) {
      core.warning(`poll-interval '${pollIntervalRaw}' is below the 10s minimum; using 10s.`);
      pollIntervalMs = MIN_POLL_INTERVAL_MS;
    }
    const timeoutMs = utils.parseDuration(timeoutRaw);

    const timeoutBoundary = Date.now() + timeoutMs;
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    // ECS-REQ-016: sleeps never run the wall clock meaningfully past the
    // boundary (the +1 lets the strict '>' check fire after a capped sleep).
    const boundedSleep = (desiredMs: number): Promise<void> => {
      const remainingMs = Math.max(timeoutBoundary - Date.now() + 1, 0);
      return utils.sleep(Math.min(desiredMs, remainingMs));
    };

    let resolvedSha: string | null = null;
    let lastRunUrl: string | null = null;

    // Deterministic Polling Loop (ECS-REQ-019)
    for (;;) {
      // Check timeout boundary (ECS-REQ-016)
      if (Date.now() > timeoutBoundary) {
        core.setOutput('final-status', 'timeout');
        if (lastRunUrl !== null) {
          core.setOutput('run-url', lastRunUrl);
        }
        core.setFailed(`Timeout exceeded (${timeoutRaw}) while waiting for test resolution.`);
        return;
      }

      let runsData;
      try {
        // Resolve annotated tags once (ECS-REQ-020), inside the resilient
        // wrapper so transient errors during resolution retry (ECS-REQ-021).
        if (resolvedSha === null) {
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
        runsData = response.data;
      } catch (error: unknown) {
        // API Resilience (ECS-REQ-021): retry 5xx, 429, and rate-limit 403s,
        // honoring retry-after / x-ratelimit-reset when provided.
        if (utils.isRetryableApiError(error)) {
          const status = utils.getErrorStatus(error);
          const retryAfterMs = utils.getRetryAfterMs(error) ?? 0;
          core.warning(`API error encountered (${status}). Retrying next interval.`);
          await boundedSleep(Math.max(pollIntervalMs, retryAfterMs));
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
      if (runsData.total_count === 0 || runsData.workflow_runs.length === 0) {
        core.info(`No workflow runs found for SHA ${resolvedSha}. Suspending and polling...`);
        await boundedSleep(pollIntervalMs);
        continue;
      }

      // Select the most recent run (ECS-REQ-018)
      const targetRun = selectMostRecentRun(runsData.workflow_runs);
      lastRunUrl = targetRun.html_url;

      // Evaluation Matrix
      if (targetRun.status === 'completed') {
        core.setOutput('run-url', targetRun.html_url);

        if (targetRun.conclusion === 'success') {
          // ECS-REQ-004
          core.setOutput('final-status', 'success');
          core.info('Tests completed successfully.');
          return;
        } else {
          // ECS-REQ-005, ECS-REQ-006: any non-success conclusion fails closed.
          core.setOutput('final-status', 'failure');
          core.setFailed(`Tests failed with conclusion: ${targetRun.conclusion || 'unknown'}`);
          return;
        }
      }

      // Pending state (ECS-REQ-007): any non-completed status waits.
      core.info(
        `Tests currently in state: ${targetRun.status || 'unknown'}. Suspending and polling...`
      );
      await boundedSleep(pollIntervalMs);
    }
  } catch (error: unknown) {
    core.setOutput('final-status', 'error');
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else if (error && typeof error === 'object' && 'message' in error) {
      core.setFailed(String((error as Record<string, unknown>).message));
    } else {
      core.setFailed('An unexpected error occurred.');
    }
  }
}
