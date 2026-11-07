/**
 * @file The test double of the GitHub API client and of the action's environment (inputs, clock,
 * sleeps) that every test of the action shares.
 */
import * as core from '@actions/core';
import { utilities } from '../../src/utilities.ts';
import { vi } from 'vitest';

/**
 * A workflow run, as the list endpoint returns it.
 */
export type MockRun = {
  readonly conclusion: string | null;
  readonly created_at: string;
  readonly html_url: string;
  readonly id: number;
  readonly status: string | null;
};

/**
 * The response of the list endpoint.
 */
type RunsResponse = {
  readonly data: { readonly total_count: number; readonly workflow_runs: readonly MockRun[] };
};

/**
 * The response of the "get a tag" endpoint.
 */
type TagResponse = {
  readonly data: { readonly object: { readonly sha: string; readonly type: string } };
};

/**
 * The parameters of the "get a tag" endpoint.
 */
type GetTagParameters = {
  readonly owner: string;
  readonly repo: string;
  readonly tag_sha: string;
};

/**
 * The parameters of the list endpoint.
 */
type ListRunsParameters = {
  readonly head_sha: string;
  readonly owner: string;
  readonly per_page: number;
  readonly repo: string;
  readonly workflow_id: string;
};

/**
 * The action inputs, by name.
 */
type Inputs = Readonly<Record<string, string>>;

/**
 * The SHA of the workflow run's context, used when the commit-sha input is empty: GITHUB_SHA of the
 * test environment (vitest.config.ts).
 */
export const CONTEXT_SHA = 'b'.repeat(40);

/**
 * The commit-sha input of the default inputs.
 */
export const MOCK_SHA = 'a'.repeat(40);

/**
 * Every hex digit, so that a narrowed character class in the SHA pattern is detected.
 */
export const HEX_SHA = '0123456789abcdef'.repeat(3).slice(0, 40);

/**
 * The parameters of the list request for the default inputs.
 */
export const LIST_RUNS_PARAMETERS = {
  head_sha: MOCK_SHA,
  owner: 'mock-owner',
  per_page: 100,
  repo: 'mock-repo',
  workflow_id: 'tests.yml'
};

/**
 * The parameters of the tag lookup for the default inputs.
 */
export const GET_TAG_PARAMETERS = { owner: 'mock-owner', repo: 'mock-repo', tag_sha: MOCK_SHA };

/**
 * The options every test passes: a timeout well above the time a test of the action takes.
 */
export const TEST_OPTIONS = { timeout: 5000 };

/**
 * The mocked API client that the mocked `github.getOctokit` returns.
 */
export const client = {
  rest: {
    actions: {
      listWorkflowRuns: vi.fn<(parameters: ListRunsParameters) => Promise<RunsResponse>>()
    },
    git: { getTag: vi.fn<(parameters: GetTagParameters) => Promise<TagResponse>>() }
  }
};

/**
 * The client factory the tests pass to `run()`: it returns the mocked client.
 */
export const createClient = vi.fn<(token: string) => typeof client>(() => client);

/**
 * The inputs most tests run with.
 */
export const DEFAULT_INPUTS: Inputs = {
  'commit-sha': MOCK_SHA,
  'github-token': 'mock-token',
  'poll-interval': '15s',
  timeout: '1m',
  'workflow-id': 'tests.yml'
};

/**
 * Makes the mocked `core.getInput` return the given inputs ('' for any other input), failing on a
 * missing required input like the real one.
 * @param inputs - The action inputs, by name.
 */
function setInputs(inputs: Inputs): void {
  vi.mocked(core.getInput).mockImplementation(
    (name: string, options?: Readonly<core.InputOptions>) => {
      const value = inputs[name] ?? '';
      if (value === '' && options?.required === true) {
        throw new Error(`Input required and not supplied: ${name}`);
      }
      return value;
    }
  );
}

/**
 * Prepares a test of the action: the given inputs, a tag lookup that finds no tag (HTTP 404), and
 * a virtual clock that each mocked sleep advances by the time slept, which keeps the number of
 * polls deterministic however often the action reads the clock.
 * @param inputs - The action inputs, by name.
 * @returns The delays the action slept, in order.
 */
export function arrange(inputs: Inputs = DEFAULT_INPUTS): () => readonly (readonly unknown[])[] {
  client.rest.actions.listWorkflowRuns.mockReset();
  client.rest.git.getTag.mockReset();
  client.rest.git.getTag.mockRejectedValue({ status: 404 });
  setInputs(inputs);
  const clock = { now: 100_000 };

  /**
   * Reads the virtual clock (a function, not a value: the clock moves on every sleep).
   * @returns The virtual time in epoch milliseconds.
   */
  function readClock(): number {
    return clock.now;
  }
  vi.spyOn(Date, 'now').mockImplementation(readClock);
  const sleep = vi.spyOn(utilities, 'sleep').mockImplementation(async milliseconds => {
    clock.now += milliseconds;
    await Promise.resolve();
  });
  return () => sleep.mock.calls;
}

/**
 * Builds a run: by default the most recent one, completed successfully.
 * @param overrides - The fields that differ from the default run.
 * @returns A workflow run as the list endpoint returns it.
 */
export function makeRun(overrides: Partial<MockRun> = {}): MockRun {
  return {
    conclusion: 'success',
    created_at: '2026-07-01T00:00:00Z',
    html_url: 'https://run.url',
    id: 1,
    status: 'completed',
    ...overrides
  };
}

/**
 * Builds a response of the list endpoint.
 * @param runs - The runs the response lists.
 * @returns The response.
 */
export function respond(...runs: readonly MockRun[]): RunsResponse {
  return { data: { total_count: runs.length, workflow_runs: runs } };
}

/**
 * Builds a response that lists one run still in progress.
 * @param overrides - The fields that differ from the default pending run.
 * @returns The response.
 */
export function pending(overrides: Partial<MockRun> = {}): RunsResponse {
  return respond(makeRun({ conclusion: null, status: 'in_progress', ...overrides }));
}

/**
 * The outputs the action set, in order.
 * @returns The arguments of every `core.setOutput` call.
 */
export function outputs(): readonly (readonly unknown[])[] {
  return vi.mocked(core.setOutput).mock.calls;
}

/**
 * The info messages the action logged, in order.
 * @returns The arguments of every `core.info` call.
 */
export function infos(): readonly (readonly unknown[])[] {
  return vi.mocked(core.info).mock.calls;
}

/**
 * The warnings the action logged, in order.
 * @returns The arguments of every `core.warning` call.
 */
export function warnings(): readonly (readonly unknown[])[] {
  return vi.mocked(core.warning).mock.calls;
}

/**
 * The failures the action reported, in order.
 * @returns The arguments of every `core.setFailed` call.
 */
export function failures(): readonly (readonly unknown[])[] {
  return vi.mocked(core.setFailed).mock.calls;
}
