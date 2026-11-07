/**
 * @file The selection of the most recent run (ECS-REQ-018).
 */
import {
  LIST_RUNS_PARAMETERS,
  TEST_OPTIONS,
  arrange,
  client,
  createClient,
  makeRun,
  outputs,
  respond
} from './support/action-harness.ts';
import { describe, expect, it, vi } from 'vitest';
import { run } from '../src/action.ts';

vi.mock(import('@actions/core'));

describe('ECS-REQ-018: selection by creation time', () => {
  it('evaluates the most recent run by created_at, regardless of id', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    arrange();
    client.rest.actions.listWorkflowRuns.mockResolvedValue(
      respond(
        makeRun({ created_at: '2026-07-01T00:00:00Z', html_url: 'https://old.url', id: 10 }),
        makeRun({
          conclusion: 'failure',
          created_at: '2026-07-02T00:00:00Z',
          html_url: 'https://new.url',
          id: 2
        }),
        makeRun({ created_at: '2026-06-30T00:00:00Z', html_url: 'https://oldest.url', id: 9 })
      )
    );

    await run(createClient);

    expect(client.rest.actions.listWorkflowRuns).toHaveBeenCalledExactlyOnceWith(
      LIST_RUNS_PARAMETERS
    );
    expect(outputs()).toStrictEqual([
      ['run-url', 'https://new.url'],
      ['final-status', 'failure']
    ]);
  });

  it('prefers a run with a valid created_at over one without', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    arrange();
    client.rest.actions.listWorkflowRuns.mockResolvedValue(
      respond(
        makeRun({ html_url: 'https://dated.url', id: 1 }),
        makeRun({ conclusion: 'failure', created_at: '', html_url: 'https://undated.url', id: 7 })
      )
    );

    await run(createClient);

    expect(outputs()).toStrictEqual([
      ['run-url', 'https://dated.url'],
      ['final-status', 'success']
    ]);
  });
});

describe('ECS-REQ-018: ties', () => {
  it('breaks created_at ties by run id', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    arrange();
    client.rest.actions.listWorkflowRuns.mockResolvedValue(
      respond(
        makeRun({ conclusion: 'failure', created_at: '', html_url: 'https://old.url', id: 5 }),
        makeRun({ created_at: '', html_url: 'https://new.url', id: 9 }),
        makeRun({ conclusion: 'failure', created_at: '', html_url: 'https://older.url', id: 3 })
      )
    );

    await run(createClient);

    expect(outputs()).toStrictEqual([
      ['run-url', 'https://new.url'],
      ['final-status', 'success']
    ]);
  });

  it('keeps the first-listed run when created_at and id are identical', TEST_OPTIONS, async () => {
    expect.hasAssertions();
    arrange();
    client.rest.actions.listWorkflowRuns.mockResolvedValue(
      respond(
        makeRun({ html_url: 'https://first.url' }),
        makeRun({ html_url: 'https://second.url' })
      )
    );

    await run(createClient);

    expect(outputs()).toContainEqual(['run-url', 'https://first.url']);
  });
});
