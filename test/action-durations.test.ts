/**
 * @file The action's duration inputs: poll-interval (ECS-REQ-012) and timeout (ECS-REQ-013).
 */
import {
  DEFAULT_INPUTS,
  TEST_OPTIONS,
  arrange,
  client,
  createClient,
  failures,
  makeRun,
  outputs,
  pending,
  respond,
  warnings
} from './support/action-harness.ts';
import { describe, expect, it, vi } from 'vitest';
import { run } from '../src/action.ts';

vi.mock(import('@actions/core'));

describe('ECS-REQ-012: the poll-interval minimum', () => {
  it('warns and clamps poll-interval values below the 10s minimum', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    const sleeps = arrange({ ...DEFAULT_INPUTS, 'poll-interval': '9999ms' });
    client.rest.actions.listWorkflowRuns
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(respond(makeRun()));

    await run(createClient);

    expect(warnings()).toStrictEqual([
      ["poll-interval '9999ms' is below the 10s minimum; using 10s."]
    ]);
    expect(sleeps()).toStrictEqual([[10_000]]);
    expect(outputs()).toContainEqual(['final-status', 'success']);
  });

  it('accepts a poll-interval of exactly 10s without a warning', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    const sleeps = arrange({ ...DEFAULT_INPUTS, 'poll-interval': '10s' });
    client.rest.actions.listWorkflowRuns
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(respond(makeRun()));

    await run(createClient);

    expect(warnings()).toStrictEqual([]);
    expect(sleeps()).toStrictEqual([[10_000]]);
  });
});

describe('ECS-REQ-012: the poll-interval default and format', () => {
  it('defaults poll-interval to 15s', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    const sleeps = arrange({ ...DEFAULT_INPUTS, 'poll-interval': '' });
    client.rest.actions.listWorkflowRuns
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(respond(makeRun()));

    await run(createClient);

    expect(sleeps()).toStrictEqual([[15_000]]);
  });

  it('fails on invalid poll-interval values', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    arrange({ ...DEFAULT_INPUTS, 'poll-interval': 'nonsense' });

    await run(createClient);

    expect(failures()).toStrictEqual([['Invalid duration format: nonsense']]);
    expect(outputs()).toStrictEqual([['final-status', 'error']]);
    expect(client.rest.actions.listWorkflowRuns).not.toHaveBeenCalled();
  });
});

describe('ECS-REQ-013: invalid timeout values', () => {
  it(
    'fails on invalid timeout values instead of silently substituting 1h',
    TEST_OPTIONS,
    async () => {
      expect.hasAssertions();
      arrange({ ...DEFAULT_INPUTS, timeout: 'invalid' });

      await run(createClient);

      expect(failures()).toStrictEqual([['Invalid duration format: invalid']]);
      expect(outputs()).toStrictEqual([['final-status', 'error']]);
      expect(client.rest.actions.listWorkflowRuns).not.toHaveBeenCalled();
    }
  );

  it('rejects negative timeout values', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    arrange({ ...DEFAULT_INPUTS, timeout: '-1h' });

    await run(createClient);

    expect(failures()).toStrictEqual([['Duration must be positive: -1h']]);
    expect(client.rest.actions.listWorkflowRuns).not.toHaveBeenCalled();
  });
});

describe('ECS-REQ-013: the timeout default', () => {
  it('defaults timeout to 1h', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    const sleeps = arrange({ ...DEFAULT_INPUTS, timeout: '' });
    client.rest.actions.listWorkflowRuns.mockResolvedValue(pending());

    await run(createClient);

    // 3600s / 15s = 240 full sleeps reach the boundary exactly; one more 1 ms sleep crosses it.
    expect(sleeps()).toHaveLength(241);
    expect(failures()).toStrictEqual([
      ['Timeout exceeded (1h) while waiting for test resolution.']
    ]);
  });
});
