/**
 * @file The action's inputs (ECS-REQ-009..013): validation, defaults and failures.
 */
import * as core from '@actions/core';
import {
  CONTEXT_SHA,
  DEFAULT_INPUTS,
  HEX_SHA,
  MOCK_SHA,
  TEST_OPTIONS,
  arrange,
  client,
  createClient,
  failures,
  makeRun,
  outputs,
  respond
} from './support/action-harness.ts';
import { describe, expect, it, vi } from 'vitest';
import { run } from '../src/action.ts';

vi.mock(import('@actions/core'));

describe('ECS-REQ-009: workflow-id', () => {
  it('fails when the required workflow-id input is missing', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    arrange({ 'github-token': 'mock-token' });

    await run(createClient);

    expect(core.getInput).toHaveBeenCalledWith('workflow-id', { required: true });
    expect(failures()).toStrictEqual([['Input required and not supplied: workflow-id']]);
    expect(outputs()).toStrictEqual([['final-status', 'error']]);
    expect(client.rest.actions.listWorkflowRuns).not.toHaveBeenCalled();
  });
});

describe('ECS-REQ-010: the commit-sha default', () => {
  it('falls back to the workflow context SHA when commit-sha is empty', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    arrange({ 'github-token': 'mock-token', 'workflow-id': 'tests.yml' });
    client.rest.actions.listWorkflowRuns.mockResolvedValue(respond(makeRun()));

    await run(createClient);

    expect(client.rest.git.getTag).toHaveBeenCalledWith({
      owner: 'mock-owner',
      repo: 'mock-repo',
      tag_sha: CONTEXT_SHA
    });
    expect(client.rest.actions.listWorkflowRuns).toHaveBeenCalledWith(
      expect.objectContaining({ head_sha: CONTEXT_SHA })
    );
  });

  it('prefers an explicit commit-sha over the context SHA', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    arrange();
    client.rest.actions.listWorkflowRuns.mockResolvedValue(respond(makeRun()));

    await run(createClient);

    expect(client.rest.actions.listWorkflowRuns).toHaveBeenCalledWith(
      expect.objectContaining({ head_sha: MOCK_SHA })
    );
  });
});

describe('ECS-REQ-010: invalid commit-sha values', () => {
  it.each([
    ['a 39-character prefix', HEX_SHA.slice(1)],
    ['a 41-character value', `${HEX_SHA}0`],
    ['a 63-character value', `${HEX_SHA}${'0'.repeat(23)}`],
    ['a 65-character value', `${HEX_SHA}${'0'.repeat(25)}`],
    ['a leading non-hex character', `g${HEX_SHA.slice(1)}`],
    ['a trailing non-hex character', `${HEX_SHA.slice(1)}g`],
    ['an abbreviated SHA', 'abc123']
  ])('rejects commit-sha values with %s', TEST_OPTIONS, async (_description, sha) => {
    expect.hasAssertions();
    arrange({ ...DEFAULT_INPUTS, 'commit-sha': sha });

    await run(createClient);

    expect(failures()).toStrictEqual([
      [`Input 'commit-sha' must be a full commit SHA (40 or 64 hex characters), got '${sha}'.`]
    ]);
    expect(outputs()).toStrictEqual([['final-status', 'error']]);
    expect(client.rest.actions.listWorkflowRuns).not.toHaveBeenCalled();
  });
});

describe('ECS-REQ-010: valid commit-sha values', () => {
  it.each([
    ['surrounding whitespace (trimmed)', `  ${HEX_SHA}\n`, HEX_SHA],
    [
      'upper case (polled in the lower-case form the API filters by)',
      HEX_SHA.toUpperCase(),
      HEX_SHA
    ],
    [
      'a 64-character SHA-256 id',
      `${HEX_SHA}${HEX_SHA.slice(0, 24)}`,
      `${HEX_SHA}${HEX_SHA.slice(0, 24)}`
    ]
  ])('accepts commit-sha values with %s', TEST_OPTIONS, async (_description, sha, polled) => {
    expect.hasAssertions();
    arrange({ ...DEFAULT_INPUTS, 'commit-sha': sha });
    client.rest.actions.listWorkflowRuns.mockResolvedValue(respond(makeRun()));

    await run(createClient);

    expect(failures()).toStrictEqual([]);
    expect(client.rest.git.getTag).toHaveBeenCalledWith(
      expect.objectContaining({ tag_sha: polled })
    );
    expect(client.rest.actions.listWorkflowRuns).toHaveBeenCalledWith(
      expect.objectContaining({ head_sha: polled })
    );
  });
});

describe('ECS-REQ-011: github-token', () => {
  it('fails fast with an actionable message when github-token is empty', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    arrange({ 'workflow-id': 'tests.yml' });

    await run(createClient);

    expect(failures()).toStrictEqual([
      [`Input 'github-token' is required; pass \${{ github.token }} or a PAT with actions:read.`]
    ]);
    expect(outputs()).toStrictEqual([['final-status', 'error']]);
    expect(core.setSecret).not.toHaveBeenCalled();
  });

  it('registers the token as a secret and passes it to getOctokit', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    arrange();
    client.rest.actions.listWorkflowRuns.mockResolvedValue(respond(makeRun()));

    await run(createClient);

    expect(core.setSecret).toHaveBeenCalledWith('mock-token');
    expect(createClient).toHaveBeenCalledExactlyOnceWith('mock-token');
  });
});
