/**
 * @file The state evaluation matrix (ECS-REQ-004..008, ECS-REQ-017): pass, fail and wait.
 */
import {
  MOCK_SHA,
  TEST_OPTIONS,
  arrange,
  client,
  createClient,
  failures,
  infos,
  makeRun,
  outputs,
  pending,
  respond
} from './support/action-harness.ts';
import { describe, expect, it, vi } from 'vitest';
import { run } from '../src/action.ts';

vi.mock(import('@actions/core'));

describe('ECS-REQ-004, ECS-REQ-017: a successful run', () => {
  it('outputs PASS and queries the correct workflow and SHA', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    const sleeps = arrange();
    client.rest.actions.listWorkflowRuns.mockResolvedValue(respond(makeRun()));

    await run(createClient);

    expect(client.rest.actions.listWorkflowRuns).toHaveBeenCalledWith({
      head_sha: MOCK_SHA,
      owner: 'mock-owner',
      per_page: 100,
      repo: 'mock-repo',
      workflow_id: 'tests.yml'
    });
    expect(outputs()).toStrictEqual([
      ['run-url', 'https://run.url'],
      ['final-status', 'success']
    ]);
    expect(infos()).toStrictEqual([
      [`Resolved SHA for polling: ${MOCK_SHA}`],
      ['Tests completed successfully.']
    ]);
    expect({ failures: failures(), sleeps: sleeps() }).toStrictEqual({ failures: [], sleeps: [] });
  });
});

describe('ECS-REQ-005, ECS-REQ-006: a failed run', () => {
  it.each([
    'failure',
    'cancelled',
    'timed_out',
    'action_required',
    'skipped',
    'stale',
    'neutral',
    'startup_failure'
  ])('outputs FAIL for terminal conclusion %s', TEST_OPTIONS, async conclusion => {
    expect.hasAssertions();
    const sleeps = arrange();
    client.rest.actions.listWorkflowRuns.mockResolvedValue(respond(makeRun({ conclusion })));

    await run(createClient);

    expect(outputs()).toStrictEqual([
      ['run-url', 'https://run.url'],
      ['final-status', 'failure']
    ]);
    expect(failures()).toStrictEqual([[`Tests failed with conclusion: ${conclusion}`]]);
    expect(sleeps()).toStrictEqual([]);
  });

  it('outputs FAIL for completed runs with a null conclusion', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    arrange();
    client.rest.actions.listWorkflowRuns.mockResolvedValue(respond(makeRun({ conclusion: null })));

    await run(createClient);

    expect(outputs()).toContainEqual(['final-status', 'failure']);
    expect(failures()).toStrictEqual([['Tests failed with conclusion: unknown']]);
  });
});

describe('ECS-REQ-007, ECS-REQ-019: a pending run', () => {
  it.each(['queued', 'in_progress', 'waiting', 'pending', 'requested'])(
    'suspends and re-polls while tests are %s',
    TEST_OPTIONS,
    async status => {
      expect.hasAssertions();
      const sleeps = arrange();
      client.rest.actions.listWorkflowRuns
        .mockResolvedValueOnce(pending({ status }))
        .mockResolvedValueOnce(respond(makeRun()));

      await run(createClient);

      expect(client.rest.actions.listWorkflowRuns).toHaveBeenCalledTimes(2);
      expect(infos()).toContainEqual([
        `Tests currently in state: ${status}. Suspending and polling...`
      ]);
      expect(sleeps()).toStrictEqual([[15_000]]);
      expect(outputs()).toContainEqual(['final-status', 'success']);
    }
  );
});

describe('ECS-REQ-007, ECS-REQ-008: no status and no runs', () => {
  it('reports unknown for runs missing a status', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    arrange();
    client.rest.actions.listWorkflowRuns
      .mockResolvedValueOnce(pending({ status: null }))
      .mockResolvedValueOnce(respond(makeRun()));

    await run(createClient);

    expect(infos()).toContainEqual([
      'Tests currently in state: unknown. Suspending and polling...'
    ]);
    expect(outputs()).toContainEqual(['final-status', 'success']);
  });

  it('suspends when 0 runs exist, then resolves', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    const sleeps = arrange();
    client.rest.actions.listWorkflowRuns
      .mockResolvedValueOnce(respond())
      .mockResolvedValueOnce(respond(makeRun()));

    await run(createClient);

    expect(client.rest.actions.listWorkflowRuns).toHaveBeenCalledTimes(2);
    expect(infos()).toContainEqual([
      `No workflow runs found for SHA ${MOCK_SHA}. Suspending and polling...`
    ]);
    expect(sleeps()).toStrictEqual([[15_000]]);
    expect(outputs()).toContainEqual(['final-status', 'success']);
  });
});
