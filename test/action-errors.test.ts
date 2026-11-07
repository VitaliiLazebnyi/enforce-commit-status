/**
 * @file The failure messages of the shapes an error can take (Error instances, Octokit's plain
 * objects, anything else).
 */
import * as core from '@actions/core';
import {
  TEST_OPTIONS,
  arrange,
  client,
  createClient,
  failures,
  outputs
} from './support/action-harness.ts';
import { describe, expect, it, vi } from 'vitest';
import { run } from '../src/action.ts';

vi.mock(import('@actions/core'));

describe('error messages of Error instances', () => {
  it('handles standard Error instances', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    arrange();
    client.rest.actions.listWorkflowRuns.mockRejectedValueOnce(new Error('Standard Error'));

    await run(createClient);

    expect(failures()).toStrictEqual([['Standard Error']]);
    expect(outputs()).toStrictEqual([['final-status', 'error']]);
    expect(core.debug).not.toHaveBeenCalled();
  });

  it('logs the cause of a wrapped Error at debug level', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    arrange();
    client.rest.actions.listWorkflowRuns.mockRejectedValueOnce(
      new Error('Wrapped', { cause: new Error('Root cause') })
    );

    await run(createClient);

    expect(failures()).toStrictEqual([['Wrapped']]);
    expect(core.debug).toHaveBeenCalledWith('Caused by: Root cause');
  });
});

describe('error messages of other values', () => {
  it.each([
    ['message-bearing non-Error objects', { message: 'Bad Request', status: 400 }, 'Bad Request'],
    ['non-string messages', { message: 42 }, '42']
  ])('reports the message of %s', TEST_OPTIONS, async (_description, error: unknown, message) => {
    expect.hasAssertions();
    arrange();
    client.rest.actions.listWorkflowRuns.mockRejectedValueOnce(error);

    await run(createClient);

    expect(failures()).toStrictEqual([[message]]);
  });

  it.each([
    ['a string', 'Some string error'],
    ['null', null],
    ['an object without a message', { status: 400 }]
  ])('handles %s as an unexpected error', TEST_OPTIONS, async (_description, error: unknown) => {
    expect.hasAssertions();
    arrange();
    client.rest.actions.listWorkflowRuns.mockRejectedValueOnce(error);

    await run(createClient);

    expect(failures()).toStrictEqual([['An unexpected error occurred.']]);
    expect(outputs()).toStrictEqual([['final-status', 'error']]);
  });
});
