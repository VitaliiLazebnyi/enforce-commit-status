/**
 * @file The timeout (ECS-REQ-016, ECS-REQ-019) and the resolution of annotated tags while polling
 * (ECS-REQ-020).
 */
import {
  DEFAULT_INPUTS,
  GET_TAG_PARAMETERS,
  TEST_OPTIONS,
  arrange,
  client,
  createClient,
  failures,
  infos,
  makeRun,
  outputs,
  pending,
  respond,
  warnings
} from './support/action-harness.ts';
import { describe, expect, it, vi } from 'vitest';
import { run } from '../src/action.ts';

vi.mock(import('@actions/core'));

describe('ECS-REQ-016, ECS-REQ-019: the timeout', () => {
  it('times out, reporting the last observed run URL', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    const sleeps = arrange();
    client.rest.actions.listWorkflowRuns.mockResolvedValue(
      pending({ html_url: 'https://pending.url' })
    );

    await run(createClient);

    expect(failures()).toStrictEqual([
      ['Timeout exceeded (1m) while waiting for test resolution.']
    ]);
    expect(outputs()).toStrictEqual([
      ['final-status', 'timeout'],
      ['run-url', 'https://pending.url']
    ]);
    // Four 15s polls reach the 60s boundary exactly; the capped 1 ms sleep crosses it.
    expect(sleeps()).toStrictEqual([[15_000], [15_000], [15_000], [15_000], [1]]);
    expect(client.rest.actions.listWorkflowRuns).toHaveBeenCalledTimes(5);
  });

  it('caps the last sleep at the remaining timeout budget', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    const sleeps = arrange({ ...DEFAULT_INPUTS, 'poll-interval': '45s' });
    client.rest.actions.listWorkflowRuns.mockResolvedValue(pending());

    await run(createClient);

    expect(sleeps()).toStrictEqual([[45_000], [15_001]]);
    expect(client.rest.actions.listWorkflowRuns).toHaveBeenCalledTimes(2);
    expect(outputs()).toContainEqual(['final-status', 'timeout']);
  });

  it('omits run-url on timeout when no run was ever observed', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    arrange();
    client.rest.actions.listWorkflowRuns.mockResolvedValue(respond());

    await run(createClient);

    expect(outputs()).toStrictEqual([['final-status', 'timeout']]);
    expect(failures()).toStrictEqual([
      ['Timeout exceeded (1m) while waiting for test resolution.']
    ]);
  });
});

describe('ECS-REQ-020: annotated tags while polling', () => {
  it(
    'polls with the underlying commit SHA when the input is an annotated tag',
    TEST_OPTIONS,
    async () => {
      expect.hasAssertions();
      arrange();
      const underlying = 'c'.repeat(40);
      client.rest.git.getTag.mockResolvedValue({
        data: { object: { sha: underlying, type: 'commit' } }
      });
      client.rest.actions.listWorkflowRuns.mockResolvedValue(respond(makeRun()));

      await run(createClient);

      expect(infos()).toStrictEqual([
        [`Resolved SHA for polling: ${underlying}`],
        ['Tests completed successfully.']
      ]);
      expect(client.rest.actions.listWorkflowRuns).toHaveBeenCalledWith(
        expect.objectContaining({ head_sha: underlying })
      );
    }
  );

  it('resolves the tag only once across polls', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    arrange();
    client.rest.actions.listWorkflowRuns
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(respond(makeRun()));

    await run(createClient);

    expect(client.rest.git.getTag).toHaveBeenCalledExactlyOnceWith(GET_TAG_PARAMETERS);
    expect(client.rest.actions.listWorkflowRuns).toHaveBeenCalledTimes(2);
  });
});

describe('ECS-REQ-020, ECS-REQ-021: transient errors while resolving a tag', () => {
  it('retries transient errors during tag resolution', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    arrange();
    client.rest.git.getTag
      .mockRejectedValueOnce({ message: 'Bad Gateway', status: 502 })
      .mockRejectedValue({ status: 404 });
    client.rest.actions.listWorkflowRuns.mockResolvedValue(respond(makeRun()));

    await run(createClient);

    expect(warnings()).toStrictEqual([['API error encountered (502). Retrying next interval.']]);
    expect(client.rest.git.getTag).toHaveBeenCalledTimes(2);
    expect(outputs()).toContainEqual(['final-status', 'success']);
    expect(failures()).toStrictEqual([]);
  });

  it('keeps the resolved SHA when listing the runs fails transiently', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    arrange();
    client.rest.actions.listWorkflowRuns
      .mockRejectedValueOnce({ message: 'Bad Gateway', status: 502 })
      .mockResolvedValueOnce(respond(makeRun()));

    await run(createClient);

    expect(client.rest.git.getTag).toHaveBeenCalledExactlyOnceWith(GET_TAG_PARAMETERS);
    expect(outputs()).toContainEqual(['final-status', 'success']);
  });
});
