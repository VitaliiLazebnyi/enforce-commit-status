/**
 * @file API resilience (ECS-REQ-021): retried and non-retried API errors.
 */
import * as core from '@actions/core';
import {
  DEFAULT_INPUTS,
  LIST_RUNS_PARAMETERS,
  TEST_OPTIONS,
  arrange,
  client,
  createClient,
  failures,
  makeRun,
  outputs,
  respond,
  warnings
} from './support/action-harness.ts';
import { describe, expect, it, vi } from 'vitest';
import { run } from '../src/action.ts';

vi.mock(import('@actions/core'));

describe('ECS-REQ-021: transient errors', () => {
  it.each([
    [502, 'Bad Gateway'],
    [429, 'Too Many Requests']
  ])('retries HTTP %i responses', TEST_OPTIONS, async (status, message) => {
    expect.hasAssertions();
    const sleeps = arrange();
    client.rest.actions.listWorkflowRuns
      .mockRejectedValueOnce({ message, status })
      .mockResolvedValueOnce(respond(makeRun()));

    await run(createClient);

    expect(client.rest.actions.listWorkflowRuns).toHaveBeenCalledTimes(2);
    expect(warnings()).toStrictEqual([
      [`API error encountered (${String(status)}). Retrying next interval.`]
    ]);
    expect(sleeps()).toStrictEqual([[15_000]]);
    expect(outputs()).toContainEqual(['final-status', 'success']);
  });

  it(
    'regression: ignores x-ratelimit-reset on 5xx errors while quota remains',
    TEST_OPTIONS,
    async () => {
      expect.hasAssertions();
      const sleeps = arrange();
      // GitHub sends x-ratelimit-reset on every response; honoring it here would stall a
      // transient error until the rate-limit window resets (up to an hour).
      client.rest.actions.listWorkflowRuns
        .mockRejectedValueOnce({
          message: 'Bad Gateway',
          response: { headers: { 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '3700' } },
          status: 502
        })
        .mockResolvedValueOnce(respond(makeRun()));

      await run(createClient);

      expect(sleeps()).toStrictEqual([[15_000]]);
      expect(outputs()).toContainEqual(['final-status', 'success']);
    }
  );
});

describe('ECS-REQ-021: requested delays', () => {
  it('honors retry-after headers longer than the poll interval', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    const sleeps = arrange({ ...DEFAULT_INPUTS, timeout: '5m' });
    client.rest.actions.listWorkflowRuns
      .mockRejectedValueOnce({ response: { headers: { 'retry-after': '45' } }, status: 429 })
      .mockResolvedValueOnce(respond(makeRun()));

    await run(createClient);

    expect(sleeps()).toStrictEqual([[45_000]]);
    expect(outputs()).toContainEqual(['final-status', 'success']);
  });

  it(
    'waits for the rate-limit reset on 403 responses with an exhausted quota',
    TEST_OPTIONS,
    async () => {
      expect.hasAssertions();
      const sleeps = arrange();
      client.rest.actions.listWorkflowRuns
        .mockRejectedValueOnce({
          response: { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '130' } },
          status: 403
        })
        .mockResolvedValueOnce(respond(makeRun()));

      await run(createClient);

      expect(warnings()).toStrictEqual([['API error encountered (403). Retrying next interval.']]);
      expect(sleeps()).toStrictEqual([[30_000]]);
      expect(outputs()).toContainEqual(['final-status', 'success']);
    }
  );

  it('caps retry delays at the remaining timeout budget', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    const sleeps = arrange();
    client.rest.actions.listWorkflowRuns.mockRejectedValue({
      response: { headers: { 'retry-after': '3600' } },
      status: 429
    });

    await run(createClient);

    expect(sleeps()).toStrictEqual([[60_001]]);
    expect(outputs()).toStrictEqual([['final-status', 'timeout']]);
  });
});

describe('ECS-REQ-021: errors that are not retried', () => {
  it.each([
    [403, 'Resource not accessible by integration'],
    [401, 'Unauthorized']
  ])(
    'fails fast on HTTP %i responses without rate-limit headers',
    TEST_OPTIONS,
    async (status, message) => {
      expect.hasAssertions();
      const sleeps = arrange();
      client.rest.actions.listWorkflowRuns.mockRejectedValueOnce({ message, status });

      await run(createClient);

      expect(failures()).toStrictEqual([[message]]);
      expect(outputs()).toStrictEqual([['final-status', 'error']]);
      expect(client.rest.actions.listWorkflowRuns).toHaveBeenCalledExactlyOnceWith(
        LIST_RUNS_PARAMETERS
      );
      expect(sleeps()).toStrictEqual([]);
    }
  );

  it(
    'reports a contextual error when the workflow does not exist (404)',
    TEST_OPTIONS,
    async () => {
      expect.hasAssertions();
      arrange();
      client.rest.actions.listWorkflowRuns.mockRejectedValueOnce({
        message: 'Not Found',
        status: 404
      });

      await run(createClient);

      expect(failures()).toStrictEqual([
        [
          "Workflow 'tests.yml' not found in mock-owner/mock-repo (HTTP 404). " +
            "Check the workflow-id input and the token's actions:read permission."
        ]
      ]);
      expect(outputs()).toStrictEqual([['final-status', 'error']]);
      expect(core.debug).toHaveBeenCalledWith('Caused by: Not Found');
    }
  );
});
