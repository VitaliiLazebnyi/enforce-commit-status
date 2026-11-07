/**
 * @file The action: validates the inputs, polls the runs of the test workflow for the commit and
 * reports the verdict of the most recent run (REQUIREMENTS.md).
 */
import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  type ClientFactory,
  type PollContext,
  type RequestResult,
  listRuns,
  request,
  resolveSha
} from './requests.ts';
import { type Inputs, readInputs } from './inputs.ts';
import { type WorkflowRun, selectMostRecentRun } from './runs.ts';
import { utilities } from './utilities.ts';

/**
 * What one poll hands to the next.
 */
type PollState = {
  /**
   * The URL of the most recent run seen so far, reported on timeout.
   */
  readonly lastRunUrl: string | undefined;

  /**
   * The commit SHA once annotated tags are resolved (resolved only once, ECS-REQ-020).
   */
  readonly resolvedSha: string | undefined;
};

/**
 * What one poll hands to the next once the commit is resolved.
 */
type ResolvedState = PollState & {
  readonly resolvedSha: string;
};

/**
 * The outcome of one poll: the verdict is reported, or the next poll follows a delay.
 */
type PollStep =
  | { readonly delayMs: number; readonly done: false; readonly state: PollState }
  | { readonly done: true };

// Lets the strict '>' timeout check fire after a sleep capped at the boundary (ECS-REQ-016).
const BOUNDARY_SLACK_MS = 1;

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
 * Reports the verdict of a completed run (ECS-REQ-004..006).
 * @param workflowRun - The completed run.
 */
function reportVerdict(workflowRun: WorkflowRun): void {
  core.setOutput('run-url', workflowRun.html_url);
  if (workflowRun.conclusion === 'success') {
    // ECS-REQ-004
    core.setOutput('final-status', 'success');
    core.info('Tests completed successfully.');
    return;
  }
  // ECS-REQ-005, ECS-REQ-006: any non-success conclusion fails closed.
  core.setOutput('final-status', 'failure');
  core.setFailed(`Tests failed with conclusion: ${workflowRun.conclusion ?? 'unknown'}`);
}

/**
 * Evaluates the runs of one poll (the evaluation matrix of REQUIREMENTS.md).
 * @param context - The poll context.
 * @param state - What the polls found, with the commit SHA.
 * @param runs - The runs of the test workflow for the commit.
 * @returns Whether the verdict is reported, or the delay before the next poll.
 */
function evaluate(
  context: PollContext,
  state: ResolvedState,
  runs: readonly WorkflowRun[]
): PollStep {
  const { pollIntervalMs } = context.inputs;
  const workflowRun = selectMostRecentRun(runs);
  if (workflowRun === undefined) {
    // ECS-REQ-008
    core.info(`No workflow runs found for SHA ${state.resolvedSha}. Suspending and polling...`);
    return { delayMs: pollIntervalMs, done: false, state };
  }
  if (workflowRun.status === 'completed') {
    reportVerdict(workflowRun);
    return { done: true };
  }
  // Pending state (ECS-REQ-007): any non-completed status waits.
  core.info(
    `Tests currently in state: ${workflowRun.status ?? 'unknown'}. Suspending and polling...`
  );
  return {
    delayMs: pollIntervalMs,
    done: false,
    state: { ...state, lastRunUrl: workflowRun.html_url }
  };
}

/**
 * Polls once: resolves the commit (once), lists its runs and evaluates them.
 * @param context - The client, inputs and repository every poll shares.
 * @param state - What the previous polls found.
 * @returns Whether the verdict is reported, or the delay before the next poll.
 */
async function pollOnce(context: PollContext, state: PollState): Promise<PollStep> {
  const resolved: RequestResult<string> =
    state.resolvedSha === undefined
      ? await request(context, async () => resolveSha(context))
      : { succeeded: true, value: state.resolvedSha };
  if (!resolved.succeeded) {
    return { delayMs: resolved.delayMs, done: false, state };
  }
  const resolvedState: ResolvedState = { ...state, resolvedSha: resolved.value };
  const listed = await request(context, async () => listRuns(context, resolvedState.resolvedSha));
  return listed.succeeded
    ? evaluate(context, resolvedState, listed.value)
    : { delayMs: listed.delayMs, done: false, state: resolvedState };
}

/**
 * Sleeps, but never meaningfully past the timeout boundary (ECS-REQ-016).
 * @param context - The poll context.
 * @param desiredMs - The requested delay.
 * @returns A promise that resolves after the delay.
 */
async function boundedSleep(context: PollContext, desiredMs: number): Promise<void> {
  await utilities.sleep(
    Math.min(desiredMs, context.timeoutBoundary - Date.now() + BOUNDARY_SLACK_MS)
  );
}

/**
 * Reports the timeout (ECS-REQ-016).
 * @param context - The poll context.
 * @param state - What the polls found.
 */
function reportTimeout(context: PollContext, state: PollState): void {
  core.setOutput('final-status', 'timeout');
  if (state.lastRunUrl !== undefined) {
    core.setOutput('run-url', state.lastRunUrl);
  }
  core.setFailed(
    `Timeout exceeded (${context.inputs.timeoutRaw}) while waiting for test resolution.`
  );
}

/**
 * The polling loop: polls until the verdict is reported or the timeout expires.
 * @param context - The client, inputs, repository and timeout boundary of the action run.
 * @returns A promise that resolves once the verdict (or the timeout) is reported.
 */
async function pollUntilResolved(context: PollContext): Promise<void> {
  let state: PollState = { lastRunUrl: undefined, resolvedSha: undefined };
  // Deterministic polling loop (ECS-REQ-019), bounded by the timeout (ECS-REQ-016).
  while (Date.now() <= context.timeoutBoundary) {
    const step = await pollOnce(context, state);
    if (step.done) {
      return;
    }
    ({ state } = step);
    await boundedSleep(context, step.delayMs);
  }
  reportTimeout(context, state);
}

/**
 * Polls the workflow runs of the commit until the most recent one resolves or the timeout
 * expires, and reports the verdict.
 * @param inputs - The validated inputs.
 * @param createClient - Creates the API client for the token.
 * @returns A promise that resolves once the verdict is reported.
 */
async function poll(inputs: Inputs, createClient: ClientFactory): Promise<void> {
  const timeoutBoundary = Date.now() + inputs.timeoutMs;
  const { owner, repo: repository } = github.context.repo;
  const context: PollContext = {
    client: createClient(inputs.token),
    inputs,
    owner,
    repository,
    timeoutBoundary
  };
  await pollUntilResolved(context);
}

/**
 * Runs the action: validates the inputs, then gates on the test workflow of the commit.
 * Every failure is reported through `core.setFailed`; the returned promise never rejects.
 * @param createClient - Creates the API client for the token: Octokit (`github.getOctokit`)
 * unless a test passes a double.
 * @returns A promise that resolves once the verdict (or the error) is reported.
 */
export async function run(createClient: ClientFactory = github.getOctokit): Promise<void> {
  try {
    await poll(readInputs(), createClient);
  } catch (error: unknown) {
    core.setOutput('final-status', 'error');
    core.setFailed(errorMessage(error));
    // The underlying API error of a wrapped failure, for step debug logging.
    if (Error.isError(error) && error.cause !== undefined) {
      core.debug(`Caused by: ${errorMessage(error.cause)}`);
    }
  }
}
