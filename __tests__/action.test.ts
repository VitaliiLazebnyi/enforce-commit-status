import * as core from '@actions/core';
import * as github from '@actions/github';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/action.js';
import { utils } from '../src/utils.js';

const CONTEXT_SHA = 'b'.repeat(40);
const MOCK_SHA = 'a'.repeat(40);
// Every hex digit, so that a narrowed character class in the SHA pattern is detected.
const HEX_SHA = '0123456789abcdef'.repeat(3).slice(0, 40);

interface MockRun {
  id: number;
  created_at: string;
  status: string | null;
  conclusion: string | null;
  html_url: string;
}

interface RunsResponse {
  data: { total_count: number; workflow_runs: MockRun[] };
}

interface TagResponse {
  data: { object: { sha: string; type: string } };
}

const mocks = vi.hoisted(() => ({
  getTag:
    vi.fn<(parameters: { owner: string; repo: string; tag_sha: string }) => Promise<TagResponse>>(),
  listWorkflowRuns:
    vi.fn<
      (parameters: {
        owner: string;
        repo: string;
        workflow_id: string;
        head_sha: string;
        per_page: number;
      }) => Promise<RunsResponse>
    >()
}));

vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  setOutput: vi.fn(),
  setFailed: vi.fn(),
  setSecret: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  debug: vi.fn()
}));

vi.mock('@actions/github', () => ({
  getOctokit: vi.fn(() => ({
    rest: {
      git: { getTag: mocks.getTag },
      actions: { listWorkflowRuns: mocks.listWorkflowRuns }
    }
  })),
  context: {
    repo: { owner: 'mock-owner', repo: 'mock-repo' },
    sha: 'b'.repeat(40)
  }
}));

const setInputs = (inputs: Record<string, string>): void => {
  vi.mocked(core.getInput).mockImplementation((name, options) => {
    const value = inputs[name] ?? '';
    if (!value && options?.required === true) {
      throw new Error(`Input required and not supplied: ${name}`);
    }
    return value;
  });
};

const DEFAULT_INPUTS = {
  'workflow-id': 'tests.yml',
  'commit-sha': MOCK_SHA,
  'github-token': 'mock-token',
  'poll-interval': '15s',
  timeout: '1m'
};

const makeRun = (overrides: Partial<MockRun> = {}): MockRun => ({
  id: 1,
  created_at: '2026-07-01T00:00:00Z',
  status: 'completed',
  conclusion: 'success',
  html_url: 'http://run.url',
  ...overrides
});

const respond = (...runs: MockRun[]): RunsResponse => ({
  data: { total_count: runs.length, workflow_runs: runs }
});

const pending = (overrides: Partial<MockRun> = {}): RunsResponse =>
  respond(makeRun({ status: 'in_progress', conclusion: null, ...overrides }));

const outputs = (): unknown[][] => vi.mocked(core.setOutput).mock.calls;
const infos = (): unknown[][] => vi.mocked(core.info).mock.calls;
const warnings = (): unknown[][] => vi.mocked(core.warning).mock.calls;
const failures = (): unknown[][] => vi.mocked(core.setFailed).mock.calls;

describe('Enforce Commit Status Action', () => {
  let now = 100_000;

  beforeEach(() => {
    mocks.getTag.mockRejectedValue({ status: 404 });
    setInputs(DEFAULT_INPUTS);
    now = 100_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    // Advancing the virtual clock inside the mocked sleep keeps iteration
    // counts deterministic regardless of how often Date.now() is consulted.
    vi.spyOn(utils, 'sleep').mockImplementation(milliseconds => {
      now += milliseconds;
      return Promise.resolve();
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  const sleeps = (): unknown[][] => vi.mocked(utils.sleep).mock.calls;

  describe('Initialization (ECS-REQ-009..013)', () => {
    it('ECS-REQ-009: fails when the required workflow-id input is missing', async () => {
      setInputs({ 'github-token': 'mock-token' });

      await run();

      expect(core.getInput).toHaveBeenCalledWith('workflow-id', { required: true });
      expect(failures()).toStrictEqual([['Input required and not supplied: workflow-id']]);
      expect(outputs()).toStrictEqual([['final-status', 'error']]);
      expect(mocks.listWorkflowRuns).not.toHaveBeenCalled();
    });

    it('ECS-REQ-010: falls back to the workflow context SHA when commit-sha is empty', async () => {
      setInputs({ 'workflow-id': 'tests.yml', 'github-token': 'mock-token' });
      mocks.listWorkflowRuns.mockResolvedValue(respond(makeRun()));

      await run();

      expect(mocks.getTag).toHaveBeenCalledWith({
        owner: 'mock-owner',
        repo: 'mock-repo',
        tag_sha: CONTEXT_SHA
      });
      expect(mocks.listWorkflowRuns).toHaveBeenCalledWith(
        expect.objectContaining({ head_sha: CONTEXT_SHA })
      );
    });

    it('ECS-REQ-010: prefers an explicit commit-sha over the context SHA', async () => {
      mocks.listWorkflowRuns.mockResolvedValue(respond(makeRun()));

      await run();

      expect(mocks.listWorkflowRuns).toHaveBeenCalledWith(
        expect.objectContaining({ head_sha: MOCK_SHA })
      );
    });

    it.each([
      ['a 39-character prefix', HEX_SHA.slice(1)],
      ['a 41-character value', `${HEX_SHA}0`],
      ['a 63-character value', `${HEX_SHA}${'0'.repeat(23)}`],
      ['a 65-character value', `${HEX_SHA}${'0'.repeat(25)}`],
      ['a leading non-hex character', `g${HEX_SHA.slice(1)}`],
      ['a trailing non-hex character', `${HEX_SHA.slice(1)}g`],
      ['an abbreviated SHA', 'abc123']
    ])('rejects commit-sha values with %s', async (_description, sha) => {
      setInputs({ ...DEFAULT_INPUTS, 'commit-sha': sha });

      await run();

      expect(failures()).toStrictEqual([
        [`Input 'commit-sha' must be a full commit SHA (40 or 64 hex characters), got '${sha}'.`]
      ]);
      expect(outputs()).toStrictEqual([['final-status', 'error']]);
      expect(mocks.listWorkflowRuns).not.toHaveBeenCalled();
    });

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
    ])('ECS-REQ-010: accepts commit-sha values with %s', async (_description, sha, polled) => {
      setInputs({ ...DEFAULT_INPUTS, 'commit-sha': sha });
      mocks.listWorkflowRuns.mockResolvedValue(respond(makeRun()));

      await run();

      expect(failures()).toStrictEqual([]);
      expect(mocks.getTag).toHaveBeenCalledWith(expect.objectContaining({ tag_sha: polled }));
      expect(mocks.listWorkflowRuns).toHaveBeenCalledWith(
        expect.objectContaining({ head_sha: polled })
      );
    });

    it('ECS-REQ-011: fails fast with an actionable message when github-token is empty', async () => {
      setInputs({ 'workflow-id': 'tests.yml' });

      await run();

      expect(failures()).toStrictEqual([
        ["Input 'github-token' is required; pass ${{ github.token }} or a PAT with actions:read."]
      ]);
      expect(outputs()).toStrictEqual([['final-status', 'error']]);
      expect(core.setSecret).not.toHaveBeenCalled();
    });

    it('ECS-REQ-011: registers the token as a secret and passes it to getOctokit', async () => {
      mocks.listWorkflowRuns.mockResolvedValue(respond(makeRun()));

      await run();

      expect(core.setSecret).toHaveBeenCalledWith('mock-token');
      expect(github.getOctokit).toHaveBeenCalledWith('mock-token');
    });

    it('ECS-REQ-012: warns and clamps poll-interval values below the 10s minimum', async () => {
      setInputs({ ...DEFAULT_INPUTS, 'poll-interval': '9999ms' });
      mocks.listWorkflowRuns
        .mockResolvedValueOnce(pending())
        .mockResolvedValueOnce(respond(makeRun()));

      await run();

      expect(warnings()).toStrictEqual([
        ["poll-interval '9999ms' is below the 10s minimum; using 10s."]
      ]);
      expect(sleeps()).toStrictEqual([[10_000]]);
      expect(outputs()).toContainEqual(['final-status', 'success']);
    });

    it('ECS-REQ-012: accepts a poll-interval of exactly 10s without a warning', async () => {
      setInputs({ ...DEFAULT_INPUTS, 'poll-interval': '10s' });
      mocks.listWorkflowRuns
        .mockResolvedValueOnce(pending())
        .mockResolvedValueOnce(respond(makeRun()));

      await run();

      expect(warnings()).toStrictEqual([]);
      expect(sleeps()).toStrictEqual([[10_000]]);
    });

    it('ECS-REQ-012: defaults poll-interval to 15s', async () => {
      setInputs({ ...DEFAULT_INPUTS, 'poll-interval': '' });
      mocks.listWorkflowRuns
        .mockResolvedValueOnce(pending())
        .mockResolvedValueOnce(respond(makeRun()));

      await run();

      expect(sleeps()).toStrictEqual([[15_000]]);
    });

    it('ECS-REQ-012: fails on invalid poll-interval values', async () => {
      setInputs({ ...DEFAULT_INPUTS, 'poll-interval': 'nonsense' });

      await run();

      expect(failures()).toStrictEqual([['Invalid duration format: nonsense']]);
      expect(outputs()).toStrictEqual([['final-status', 'error']]);
      expect(mocks.listWorkflowRuns).not.toHaveBeenCalled();
    });

    it('ECS-REQ-013: fails on invalid timeout values instead of silently substituting 1h', async () => {
      setInputs({ ...DEFAULT_INPUTS, timeout: 'invalid' });

      await run();

      expect(failures()).toStrictEqual([['Invalid duration format: invalid']]);
      expect(outputs()).toStrictEqual([['final-status', 'error']]);
      expect(mocks.listWorkflowRuns).not.toHaveBeenCalled();
    });

    it('ECS-REQ-013: rejects negative timeout values', async () => {
      setInputs({ ...DEFAULT_INPUTS, timeout: '-1h' });

      await run();

      expect(failures()).toStrictEqual([['Duration must be positive: -1h']]);
      expect(mocks.listWorkflowRuns).not.toHaveBeenCalled();
    });

    it('ECS-REQ-013: defaults timeout to 1h', async () => {
      setInputs({ ...DEFAULT_INPUTS, timeout: '' });
      mocks.listWorkflowRuns.mockResolvedValue(pending());

      await run();

      // 3600s / 15s = 240 full sleeps reach the boundary exactly; one more 1 ms sleep crosses it.
      expect(sleeps()).toHaveLength(241);
      expect(failures()).toStrictEqual([
        ['Timeout exceeded (1h) while waiting for test resolution.']
      ]);
    });
  });

  describe('ECS-REQ-020: Annotated Tag Resolution flow-through', () => {
    it('polls with the underlying commit SHA when the input is an annotated tag', async () => {
      const underlying = 'c'.repeat(40);
      mocks.getTag.mockResolvedValue({ data: { object: { sha: underlying, type: 'commit' } } });
      mocks.listWorkflowRuns.mockResolvedValue(respond(makeRun()));

      await run();

      expect(infos()).toStrictEqual([
        [`Resolved SHA for polling: ${underlying}`],
        ['Tests completed successfully.']
      ]);
      expect(mocks.listWorkflowRuns).toHaveBeenCalledWith(
        expect.objectContaining({ head_sha: underlying })
      );
    });

    it('resolves the tag only once across polls', async () => {
      mocks.listWorkflowRuns
        .mockResolvedValueOnce(pending())
        .mockResolvedValueOnce(respond(makeRun()));

      await run();

      expect(mocks.getTag).toHaveBeenCalledTimes(1);
      expect(mocks.listWorkflowRuns).toHaveBeenCalledTimes(2);
    });

    it('ECS-REQ-021: retries transient errors during tag resolution', async () => {
      mocks.getTag
        .mockRejectedValueOnce({ status: 502, message: 'Bad Gateway' })
        .mockRejectedValue({ status: 404 });
      mocks.listWorkflowRuns.mockResolvedValue(respond(makeRun()));

      await run();

      expect(warnings()).toStrictEqual([['API error encountered (502). Retrying next interval.']]);
      expect(mocks.getTag).toHaveBeenCalledTimes(2);
      expect(outputs()).toContainEqual(['final-status', 'success']);
      expect(failures()).toStrictEqual([]);
    });
  });

  describe('State Evaluation Matrix & Polling', () => {
    it('ECS-REQ-004, ECS-REQ-017: outputs PASS and queries the correct workflow and SHA', async () => {
      mocks.listWorkflowRuns.mockResolvedValue(respond(makeRun()));

      await run();

      expect(mocks.listWorkflowRuns).toHaveBeenCalledWith({
        owner: 'mock-owner',
        repo: 'mock-repo',
        workflow_id: 'tests.yml',
        head_sha: MOCK_SHA,
        per_page: 100
      });
      expect(outputs()).toStrictEqual([
        ['run-url', 'http://run.url'],
        ['final-status', 'success']
      ]);
      expect(infos()).toStrictEqual([
        [`Resolved SHA for polling: ${MOCK_SHA}`],
        ['Tests completed successfully.']
      ]);
      expect(failures()).toStrictEqual([]);
      expect(sleeps()).toStrictEqual([]);
    });

    it.each([
      'failure',
      'cancelled',
      'timed_out',
      'action_required',
      'skipped',
      'stale',
      'neutral',
      'startup_failure'
    ])('ECS-REQ-005, ECS-REQ-006: outputs FAIL for terminal conclusion %s', async conclusion => {
      mocks.listWorkflowRuns.mockResolvedValue(respond(makeRun({ conclusion })));

      await run();

      expect(outputs()).toStrictEqual([
        ['run-url', 'http://run.url'],
        ['final-status', 'failure']
      ]);
      expect(failures()).toStrictEqual([[`Tests failed with conclusion: ${conclusion}`]]);
      expect(sleeps()).toStrictEqual([]);
    });

    it('ECS-REQ-006: outputs FAIL for completed runs with a null conclusion', async () => {
      mocks.listWorkflowRuns.mockResolvedValue(respond(makeRun({ conclusion: null })));

      await run();

      expect(outputs()).toContainEqual(['final-status', 'failure']);
      expect(failures()).toStrictEqual([['Tests failed with conclusion: unknown']]);
    });

    it.each(['queued', 'in_progress', 'waiting', 'pending', 'requested'])(
      'ECS-REQ-007, ECS-REQ-019: suspends and re-polls while tests are %s',
      async status => {
        mocks.listWorkflowRuns
          .mockResolvedValueOnce(pending({ status }))
          .mockResolvedValueOnce(respond(makeRun()));

        await run();

        expect(mocks.listWorkflowRuns).toHaveBeenCalledTimes(2);
        expect(infos()).toContainEqual([
          `Tests currently in state: ${status}. Suspending and polling...`
        ]);
        expect(sleeps()).toStrictEqual([[15_000]]);
        expect(outputs()).toContainEqual(['final-status', 'success']);
      }
    );

    it('reports unknown for runs missing a status', async () => {
      mocks.listWorkflowRuns
        .mockResolvedValueOnce(pending({ status: null }))
        .mockResolvedValueOnce(respond(makeRun()));

      await run();

      expect(infos()).toContainEqual([
        'Tests currently in state: unknown. Suspending and polling...'
      ]);
      expect(outputs()).toContainEqual(['final-status', 'success']);
    });

    it('ECS-REQ-008: suspends when 0 runs exist, then resolves', async () => {
      mocks.listWorkflowRuns
        .mockResolvedValueOnce(respond())
        .mockResolvedValueOnce(respond(makeRun()));

      await run();

      expect(mocks.listWorkflowRuns).toHaveBeenCalledTimes(2);
      expect(infos()).toContainEqual([
        `No workflow runs found for SHA ${MOCK_SHA}. Suspending and polling...`
      ]);
      expect(sleeps()).toStrictEqual([[15_000]]);
      expect(outputs()).toContainEqual(['final-status', 'success']);
    });

    it('ECS-REQ-018: evaluates the most recent run by created_at, regardless of id', async () => {
      mocks.listWorkflowRuns.mockResolvedValue(
        respond(
          makeRun({ id: 10, created_at: '2026-07-01T00:00:00Z', html_url: 'http://old.url' }),
          makeRun({
            id: 2,
            created_at: '2026-07-02T00:00:00Z',
            conclusion: 'failure',
            html_url: 'http://new.url'
          }),
          makeRun({ id: 9, created_at: '2026-06-30T00:00:00Z', html_url: 'http://oldest.url' })
        )
      );

      await run();

      expect(mocks.listWorkflowRuns).toHaveBeenCalledTimes(1);
      expect(outputs()).toStrictEqual([
        ['run-url', 'http://new.url'],
        ['final-status', 'failure']
      ]);
    });

    it('ECS-REQ-018: prefers a run with a valid created_at over one without', async () => {
      mocks.listWorkflowRuns.mockResolvedValue(
        respond(
          makeRun({ id: 1, html_url: 'http://dated.url' }),
          makeRun({ id: 7, created_at: '', conclusion: 'failure', html_url: 'http://undated.url' })
        )
      );

      await run();

      expect(outputs()).toStrictEqual([
        ['run-url', 'http://dated.url'],
        ['final-status', 'success']
      ]);
    });

    it('ECS-REQ-018: breaks created_at ties by run id', async () => {
      mocks.listWorkflowRuns.mockResolvedValue(
        respond(
          makeRun({ id: 5, created_at: '', conclusion: 'failure', html_url: 'http://old.url' }),
          makeRun({ id: 9, created_at: '', html_url: 'http://new.url' }),
          makeRun({ id: 3, created_at: '', conclusion: 'failure', html_url: 'http://older.url' })
        )
      );

      await run();

      expect(outputs()).toStrictEqual([
        ['run-url', 'http://new.url'],
        ['final-status', 'success']
      ]);
    });

    it('ECS-REQ-018: keeps the first-listed run when created_at and id are identical', async () => {
      mocks.listWorkflowRuns.mockResolvedValue(
        respond(
          makeRun({ html_url: 'http://first.url' }),
          makeRun({ html_url: 'http://second.url' })
        )
      );

      await run();

      expect(outputs()).toContainEqual(['run-url', 'http://first.url']);
    });

    it('ECS-REQ-016, ECS-REQ-019: times out, reporting the last observed run URL', async () => {
      mocks.listWorkflowRuns.mockResolvedValue(pending({ html_url: 'http://pending.url' }));

      await run();

      expect(failures()).toStrictEqual([
        ['Timeout exceeded (1m) while waiting for test resolution.']
      ]);
      expect(outputs()).toStrictEqual([
        ['final-status', 'timeout'],
        ['run-url', 'http://pending.url']
      ]);
      // Four 15s polls reach the 60s boundary exactly; the capped 1 ms sleep crosses it.
      expect(sleeps()).toStrictEqual([[15_000], [15_000], [15_000], [15_000], [1]]);
      expect(mocks.listWorkflowRuns).toHaveBeenCalledTimes(5);
    });

    it('ECS-REQ-016: caps the last sleep at the remaining timeout budget', async () => {
      setInputs({ ...DEFAULT_INPUTS, 'poll-interval': '45s' });
      mocks.listWorkflowRuns.mockResolvedValue(pending());

      await run();

      expect(sleeps()).toStrictEqual([[45_000], [15_001]]);
      expect(mocks.listWorkflowRuns).toHaveBeenCalledTimes(2);
      expect(outputs()).toContainEqual(['final-status', 'timeout']);
    });

    it('ECS-REQ-016: omits run-url on timeout when no run was ever observed', async () => {
      mocks.listWorkflowRuns.mockResolvedValue(respond());

      await run();

      expect(outputs()).toStrictEqual([['final-status', 'timeout']]);
      expect(failures()).toStrictEqual([
        ['Timeout exceeded (1m) while waiting for test resolution.']
      ]);
    });
  });

  describe('ECS-REQ-021: API Resilience', () => {
    it('bypasses 5xx errors and retries', async () => {
      mocks.listWorkflowRuns
        .mockRejectedValueOnce({ status: 502, message: 'Bad Gateway' })
        .mockResolvedValueOnce(respond(makeRun()));

      await run();

      expect(mocks.listWorkflowRuns).toHaveBeenCalledTimes(2);
      expect(warnings()).toStrictEqual([['API error encountered (502). Retrying next interval.']]);
      expect(sleeps()).toStrictEqual([[15_000]]);
      expect(outputs()).toContainEqual(['final-status', 'success']);
    });

    it('bypasses 429 rate limits and retries', async () => {
      mocks.listWorkflowRuns
        .mockRejectedValueOnce({ status: 429, message: 'Too Many Requests' })
        .mockResolvedValueOnce(respond(makeRun()));

      await run();

      expect(mocks.listWorkflowRuns).toHaveBeenCalledTimes(2);
      expect(warnings()).toStrictEqual([['API error encountered (429). Retrying next interval.']]);
      expect(outputs()).toContainEqual(['final-status', 'success']);
    });

    it('honors retry-after headers longer than the poll interval', async () => {
      setInputs({ ...DEFAULT_INPUTS, timeout: '5m' });
      mocks.listWorkflowRuns
        .mockRejectedValueOnce({
          status: 429,
          message: 'Too Many Requests',
          response: { headers: { 'retry-after': '45' } }
        })
        .mockResolvedValueOnce(respond(makeRun()));

      await run();

      expect(sleeps()).toStrictEqual([[45_000]]);
      expect(outputs()).toContainEqual(['final-status', 'success']);
    });

    it('waits for the rate-limit reset on 403 responses with an exhausted quota', async () => {
      mocks.listWorkflowRuns
        .mockRejectedValueOnce({
          status: 403,
          message: 'rate limit exceeded',
          response: { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '130' } }
        })
        .mockResolvedValueOnce(respond(makeRun()));

      await run();

      expect(warnings()).toStrictEqual([['API error encountered (403). Retrying next interval.']]);
      expect(sleeps()).toStrictEqual([[30_000]]);
      expect(outputs()).toContainEqual(['final-status', 'success']);
    });

    it('caps retry delays at the remaining timeout budget', async () => {
      mocks.listWorkflowRuns.mockRejectedValue({
        status: 429,
        message: 'Too Many Requests',
        response: { headers: { 'retry-after': '3600' } }
      });

      await run();

      expect(sleeps()).toStrictEqual([[60_001]]);
      expect(outputs()).toStrictEqual([['final-status', 'timeout']]);
    });

    it('fails fast on 403 responses without rate-limit headers', async () => {
      mocks.listWorkflowRuns.mockRejectedValueOnce({
        status: 403,
        message: 'Resource not accessible by integration'
      });

      await run();

      expect(failures()).toStrictEqual([['Resource not accessible by integration']]);
      expect(outputs()).toStrictEqual([['final-status', 'error']]);
    });

    it('fails fast on non-retryable 4xx errors', async () => {
      mocks.listWorkflowRuns.mockRejectedValueOnce({ status: 401, message: 'Unauthorized' });

      await run();

      expect(failures()).toStrictEqual([['Unauthorized']]);
      expect(outputs()).toStrictEqual([['final-status', 'error']]);
      expect(mocks.listWorkflowRuns).toHaveBeenCalledTimes(1);
      expect(sleeps()).toStrictEqual([]);
    });

    it('reports a contextual error when the workflow does not exist (404)', async () => {
      mocks.listWorkflowRuns.mockRejectedValueOnce({ status: 404, message: 'Not Found' });

      await run();

      expect(failures()).toStrictEqual([
        [
          "Workflow 'tests.yml' not found in mock-owner/mock-repo (HTTP 404). " +
            "Check the workflow-id input and the token's actions:read permission."
        ]
      ]);
      expect(outputs()).toStrictEqual([['final-status', 'error']]);
      expect(core.debug).toHaveBeenCalledWith('Caused by: Not Found');
    });
  });

  describe('Error shape handling', () => {
    it('handles standard Error instances', async () => {
      mocks.listWorkflowRuns.mockRejectedValueOnce(new Error('Standard Error'));

      await run();

      expect(failures()).toStrictEqual([['Standard Error']]);
      expect(outputs()).toStrictEqual([['final-status', 'error']]);
      expect(core.debug).not.toHaveBeenCalled();
    });

    it('logs the cause of a wrapped Error at debug level', async () => {
      mocks.listWorkflowRuns.mockRejectedValueOnce(
        new Error('Wrapped', { cause: new Error('Root cause') })
      );

      await run();

      expect(failures()).toStrictEqual([['Wrapped']]);
      expect(core.debug).toHaveBeenCalledWith('Caused by: Root cause');
    });

    it('handles message-bearing non-Error objects', async () => {
      mocks.listWorkflowRuns.mockRejectedValueOnce({ status: 400, message: 'Bad Request' });

      await run();

      expect(failures()).toStrictEqual([['Bad Request']]);
    });

    it('stringifies non-string messages', async () => {
      mocks.listWorkflowRuns.mockRejectedValueOnce({ message: 42 });

      await run();

      expect(failures()).toStrictEqual([['42']]);
    });

    it.each([
      ['a string', 'Some string error'],
      ['null', null],
      ['an object without a message', { status: 400 }]
    ])('handles %s as an unexpected error', async (_description, error) => {
      mocks.listWorkflowRuns.mockRejectedValueOnce(error);

      await run();

      expect(failures()).toStrictEqual([['An unexpected error occurred.']]);
      expect(outputs()).toStrictEqual([['final-status', 'error']]);
    });
  });
});
