import * as core from '@actions/core';
import * as github from '@actions/github';
import ms from 'ms';
import { utils } from './utils.js';

// Interface removed

export async function run(): Promise<void> {
  try {
    // 1. Initialization (ECS-REQ-015)
    const workflowId = core.getInput('workflow-id', { required: true });
    const commitSha = core.getInput('commit-sha') || github.context.sha;
    const token = core.getInput('github-token') || '';
    const pollIntervalRaw = core.getInput('poll-interval') || '15s';
    const timeoutRaw = core.getInput('timeout') || '1h';

    // Parse and enforce minimums
    const pollIntervalMs = utils.parseDuration(pollIntervalRaw);
    
    // Parse timeout (we use ms directly here since it can be anything, but let's default to 1h if invalid)
    let timeoutMs = ms(timeoutRaw as ms.StringValue);
    if (timeoutMs === undefined || isNaN(timeoutMs)) {
      timeoutMs = 3600000; // 1 hour default fallback
    }

    const timeoutBoundary = Date.now() + timeoutMs;
    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;

    // Resolve annotated tags (ECS-REQ-020)
    const resolvedSha = await utils.resolveCommitSha(octokit, owner, repo, commitSha);
    core.info(`Resolved SHA for polling: ${resolvedSha}`);

    // Deterministic Polling Loop (ECS-REQ-019)
    for (;;) {
      // Check timeout boundary (ECS-REQ-016)
      // Check timeout boundary (ECS-REQ-016)
      if (Date.now() > timeoutBoundary) {
        core.setOutput('final-status', 'timeout');
        core.setFailed(`Timeout exceeded (${timeoutRaw}) while waiting for test resolution.`);
        return;
      }

      let runsData;
      try {
        // Query Workflow Runs (ECS-REQ-017)
        const response = await octokit.rest.actions.listWorkflowRuns({
          owner,
          repo,
          workflow_id: workflowId,
          head_sha: resolvedSha
        });
        runsData = response.data;
      } catch (error: unknown) {
        // API Resilience (ECS-REQ-021): bypass 5xx and 429
        const isApiError = error && typeof error === 'object' && 'status' in error;
        if (isApiError) {
          const status = (error as { status: number }).status;
          if (status >= 500 || status === 429) {
            core.warning(`API error encountered (${status}). Retrying next interval.`);
            await utils.sleep(pollIntervalMs);
            continue;
          }
        }
        throw error;
      }

      // Check for 0 runs (ECS-REQ-008)
      if (runsData.total_count === 0 || runsData.workflow_runs.length === 0) {
        core.info('No workflow runs found. Suspending and polling...');
        await utils.sleep(pollIntervalMs);
        continue;
      }

      // Sort by run_attempt descending (ECS-REQ-018)
      const sortedRuns = runsData.workflow_runs.sort((a, b) => (b.run_attempt || 0) - (a.run_attempt || 0));
      const targetRun = sortedRuns[0];

      // Evaluation Matrix
      if (targetRun.status === 'completed') {
        core.setOutput('run-url', targetRun.html_url);
        
        if (targetRun.conclusion === 'success') {
          // ECS-REQ-004
          core.setOutput('final-status', 'success');
          core.info('Tests completed successfully.');
          return;
        } else {
          // ECS-REQ-005, ECS-REQ-006
          core.setOutput('final-status', 'failure');
          core.setFailed(`Tests failed with conclusion: ${targetRun.conclusion || 'unknown'}`);
          return;
        }
      }

      // Pending state (ECS-REQ-007)
      core.info(`Tests currently in state: ${targetRun.status || 'unknown'}. Suspending and polling...`);
      await utils.sleep(pollIntervalMs);
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else if (error && typeof error === 'object' && 'message' in error) {
      core.setFailed(String((error as Record<string, unknown>).message));
    } else {
      core.setFailed('An unexpected error occurred.');
    }
  }
}
