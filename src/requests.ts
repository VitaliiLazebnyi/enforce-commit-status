/**
 * @file The API requests of a poll and their resilience (ECS-REQ-017, ECS-REQ-020, ECS-REQ-021).
 */
import * as core from '@actions/core';
import { type TagClient, utilities } from './utilities.ts';
import type { Inputs } from './inputs.ts';
import type { WorkflowRun } from './runs.ts';

/**
 * The parameters of the "list workflow runs for a workflow" request.
 */
type ListRunsParameters = {
  readonly head_sha: string;
  readonly owner: string;
  readonly per_page: number;
  readonly repo: string;
  readonly workflow_id: string;
};

/**
 * The part of the Octokit client the action uses.
 */
type ActionsClient = {
  readonly rest: TagClient['rest'] & {
    readonly actions: {
      readonly listWorkflowRuns: (
        parameters: ListRunsParameters
      ) => Promise<{ readonly data: { readonly workflow_runs: readonly WorkflowRun[] } }>;
    };
  };
};

/**
 * Creates the API client for a token.
 */
export type ClientFactory = (token: string) => ActionsClient;

/**
 * What every poll of one action run shares.
 */
export type PollContext = {
  readonly client: ActionsClient;
  readonly inputs: Inputs;
  readonly owner: string;
  readonly repository: string;
  readonly timeoutBoundary: number;
};

/**
 * The outcome of one API request: its value, or the delay before the request is retried.
 * @template T - The type of the request's value.
 */
export type RequestResult<T> =
  | { readonly delayMs: number; readonly succeeded: false }
  | { readonly succeeded: true; readonly value: T };

// The most runs one request returns; the most recent run of the commit is among them.
const RUNS_PER_PAGE = 100;
const HTTP_NOT_FOUND = 404;

/**
 * Decides how a failed API request continues (API resilience, ECS-REQ-021): 5xx, 429 and
 * rate-limit 403 responses are retried, honoring retry-after / x-ratelimit-reset.
 * @param context - The poll context.
 * @param error - The error of the request.
 * @returns The delay before the request is retried.
 * @throws {Error} The error itself when it is not retryable; a 404 names the workflow.
 */
function retryDelay(context: PollContext, error: unknown): number {
  if (utilities.isRetryableApiError(error)) {
    const status = String(utilities.getErrorStatus(error));
    core.warning(`API error encountered (${status}). Retrying next interval.`);
    return Math.max(context.inputs.pollIntervalMs, utilities.getRetryAfterMs(error));
  }
  // Tag-resolution 404s are consumed inside resolveCommitSha, so a 404
  // here always means the workflow itself was not found.
  if (utilities.getErrorStatus(error) === HTTP_NOT_FOUND) {
    const { inputs, owner, repository } = context;
    throw new Error(
      `Workflow '${inputs.workflowId}' not found in ${owner}/${repository} (HTTP 404). ` +
        "Check the workflow-id input and the token's actions:read permission.",
      { cause: error }
    );
  }
  throw error;
}

/**
 * Sends one API request; a retryable failure becomes the delay before the retry.
 * @template T - The value of the request.
 * @param context - The poll context.
 * @param send - Sends the request.
 * @returns The value, or the delay before the retry.
 * @rejects {Error} The error of a request that is not retryable (see retryDelay).
 */
export async function request<T>(
  context: PollContext,
  send: () => Promise<T>
): Promise<RequestResult<T>> {
  try {
    return { succeeded: true, value: await send() };
  } catch (error: unknown) {
    return { delayMs: retryDelay(context, error), succeeded: false };
  }
}

/**
 * Resolves annotated tags to the commit (ECS-REQ-020).
 * @param context - The poll context.
 * @returns The commit SHA.
 */
export async function resolveSha(context: PollContext): Promise<string> {
  const resolvedSha = await utilities.resolveCommitSha(context.client, {
    owner: context.owner,
    repository: context.repository,
    sha: context.inputs.commitSha
  });
  core.info(`Resolved SHA for polling: ${resolvedSha}`);
  return resolvedSha;
}

/**
 * Lists the runs of the test workflow for the commit (ECS-REQ-017).
 * @param context - The client, inputs and repository every poll shares.
 * @param resolvedSha - The commit SHA (annotated tags already resolved).
 * @returns The runs of the workflow for the commit, one entry per run.
 */
export async function listRuns(
  context: PollContext,
  resolvedSha: string
): Promise<readonly WorkflowRun[]> {
  const { data } = await context.client.rest.actions.listWorkflowRuns({
    head_sha: resolvedSha,
    owner: context.owner,
    per_page: RUNS_PER_PAGE,
    repo: context.repository,
    workflow_id: context.inputs.workflowId
  });
  return data.workflow_runs;
}
