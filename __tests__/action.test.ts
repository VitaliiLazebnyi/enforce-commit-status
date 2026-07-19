import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

const CONTEXT_SHA = 'b'.repeat(40);

jest.unstable_mockModule('@actions/core', () => ({
  getInput: jest.fn(),
  setOutput: jest.fn(),
  setFailed: jest.fn(),
  setSecret: jest.fn(),
  info: jest.fn(),
  warning: jest.fn()
}));

jest.unstable_mockModule('@actions/github', () => ({
  getOctokit: jest.fn(),
  context: {
    repo: {
      owner: 'mock-owner',
      repo: 'mock-repo'
    },
    sha: CONTEXT_SHA
  }
}));

const core = await import('@actions/core');
const github = await import('@actions/github');
const { run } = await import('../src/action.js');
const { utils } = await import('../src/utils.js');

const MOCK_SHA = 'a'.repeat(40);

type GetInputMock = jest.Mock<typeof core.getInput>;

const setInputs = (inputs: Record<string, string>): void => {
  (core.getInput as GetInputMock).mockImplementation(
    (name: string, options?: { required?: boolean }) => {
      const value = inputs[name] ?? '';
      if (!value && options?.required) {
        throw new Error(`Input required and not supplied: ${name}`);
      }
      return value;
    }
  );
};

const completedRun = (
  conclusion: string | null,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: 1,
  created_at: '2026-07-01T00:00:00Z',
  status: 'completed',
  conclusion,
  html_url: 'http://run.url',
  ...overrides
});

describe('Enforce Commit Status Action', () => {
  const mockOctokit = {
    rest: {
      git: {
        getTag: jest.fn<(...args: unknown[]) => Promise<unknown>>()
      },
      actions: {
        listWorkflowRuns: jest.fn<(...args: unknown[]) => Promise<unknown>>()
      }
    }
  };

  let now = 100000;
  let dateSpy: jest.SpiedFunction<typeof Date.now>;
  let sleepSpy: jest.SpiedFunction<typeof utils.sleep>;

  beforeEach(() => {
    mockOctokit.rest.git.getTag.mockRejectedValue({ status: 404 });
    (github.getOctokit as jest.Mock).mockReturnValue(mockOctokit);
    setInputs({
      'workflow-id': 'tests.yml',
      'commit-sha': MOCK_SHA,
      'github-token': 'mock-token',
      'poll-interval': '15s',
      timeout: '1m'
    });

    now = 100000;
    dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    // Advancing the virtual clock inside the mocked sleep keeps iteration
    // counts deterministic regardless of how often Date.now() is consulted.
    sleepSpy = jest.spyOn(utils, 'sleep').mockImplementation(milliseconds => {
      now += milliseconds;
      return Promise.resolve();
    });
  });

  afterEach(() => {
    dateSpy.mockRestore();
    sleepSpy.mockRestore();
  });

  describe('Initialization (ECS-REQ-009..013)', () => {
    it('ECS-REQ-009: fails when the required workflow-id input is missing', async () => {
      setInputs({ 'github-token': 'mock-token' });

      await run();

      expect(core.setFailed).toHaveBeenCalledWith('Input required and not supplied: workflow-id');
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'error');
      expect(mockOctokit.rest.actions.listWorkflowRuns).not.toHaveBeenCalled();
    });

    it('ECS-REQ-010: falls back to the workflow context SHA when commit-sha is empty', async () => {
      setInputs({ 'workflow-id': 'tests.yml', 'github-token': 'mock-token' });
      mockOctokit.rest.actions.listWorkflowRuns.mockResolvedValue({
        data: { total_count: 1, workflow_runs: [completedRun('success')] }
      });

      await run();

      expect(mockOctokit.rest.git.getTag).toHaveBeenCalledWith({
        owner: 'mock-owner',
        repo: 'mock-repo',
        tag_sha: CONTEXT_SHA
      });
      expect(mockOctokit.rest.actions.listWorkflowRuns).toHaveBeenCalledWith(
        expect.objectContaining({ head_sha: CONTEXT_SHA })
      );
    });

    it('rejects commit-sha values that are not full commit SHAs', async () => {
      setInputs({
        'workflow-id': 'tests.yml',
        'github-token': 'mock-token',
        'commit-sha': 'abc123'
      });

      await run();

      expect(core.setFailed).toHaveBeenCalledWith(
        "Input 'commit-sha' must be a full commit SHA (40 or 64 hex characters), got 'abc123'."
      );
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'error');
      expect(mockOctokit.rest.actions.listWorkflowRuns).not.toHaveBeenCalled();
    });

    it('accepts 64-character SHA-256 commit ids', async () => {
      setInputs({
        'workflow-id': 'tests.yml',
        'github-token': 'mock-token',
        'commit-sha': 'f'.repeat(64)
      });
      mockOctokit.rest.actions.listWorkflowRuns.mockResolvedValue({
        data: { total_count: 1, workflow_runs: [completedRun('success')] }
      });

      await run();

      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it('ECS-REQ-011: fails fast with an actionable message when github-token is empty', async () => {
      setInputs({ 'workflow-id': 'tests.yml' });

      await run();

      expect(core.setFailed).toHaveBeenCalledWith(
        "Input 'github-token' is required; pass ${{ github.token }} or a PAT with actions:read."
      );
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'error');
    });

    it('ECS-REQ-011: registers the token as a secret and passes it to getOctokit', async () => {
      mockOctokit.rest.actions.listWorkflowRuns.mockResolvedValue({
        data: { total_count: 1, workflow_runs: [completedRun('success')] }
      });

      await run();

      expect(core.setSecret).toHaveBeenCalledWith('mock-token');
      expect(github.getOctokit).toHaveBeenCalledWith('mock-token');
    });

    it('ECS-REQ-012: warns and clamps poll-interval values below the 10s minimum', async () => {
      setInputs({
        'workflow-id': 'tests.yml',
        'github-token': 'mock-token',
        'commit-sha': MOCK_SHA,
        'poll-interval': '5s',
        timeout: '1m'
      });
      mockOctokit.rest.actions.listWorkflowRuns
        .mockResolvedValueOnce({
          data: { total_count: 1, workflow_runs: [completedRun(null, { status: 'queued' })] }
        })
        .mockResolvedValueOnce({
          data: { total_count: 1, workflow_runs: [completedRun('success')] }
        });

      await run();

      expect(core.warning).toHaveBeenCalledWith(
        "poll-interval '5s' is below the 10s minimum; using 10s."
      );
      expect(sleepSpy).toHaveBeenCalledWith(10000);
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'success');
    });

    it('ECS-REQ-012: fails on invalid poll-interval values', async () => {
      setInputs({
        'workflow-id': 'tests.yml',
        'github-token': 'mock-token',
        'commit-sha': MOCK_SHA,
        'poll-interval': 'nonsense'
      });

      await run();

      expect(core.setFailed).toHaveBeenCalledWith('Invalid duration format: nonsense');
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'error');
      expect(mockOctokit.rest.actions.listWorkflowRuns).not.toHaveBeenCalled();
    });

    it('ECS-REQ-013: fails on invalid timeout values instead of silently substituting 1h', async () => {
      setInputs({
        'workflow-id': 'tests.yml',
        'github-token': 'mock-token',
        'commit-sha': MOCK_SHA,
        timeout: 'invalid'
      });

      await run();

      expect(core.setFailed).toHaveBeenCalledWith('Invalid duration format: invalid');
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'error');
      expect(mockOctokit.rest.actions.listWorkflowRuns).not.toHaveBeenCalled();
    });

    it('ECS-REQ-013: rejects negative timeout values', async () => {
      setInputs({
        'workflow-id': 'tests.yml',
        'github-token': 'mock-token',
        'commit-sha': MOCK_SHA,
        timeout: '-1h'
      });

      await run();

      expect(core.setFailed).toHaveBeenCalledWith('Duration must be positive: -1h');
      expect(mockOctokit.rest.actions.listWorkflowRuns).not.toHaveBeenCalled();
    });
  });

  describe('ECS-REQ-020: Annotated Tag Resolution flow-through', () => {
    it('polls with the underlying commit SHA when the input is an annotated tag', async () => {
      const underlying = 'c'.repeat(40);
      mockOctokit.rest.git.getTag.mockResolvedValue({
        data: { object: { sha: underlying, type: 'commit' } }
      });
      mockOctokit.rest.actions.listWorkflowRuns.mockResolvedValue({
        data: { total_count: 1, workflow_runs: [completedRun('success')] }
      });

      await run();

      expect(core.info).toHaveBeenCalledWith(`Resolved SHA for polling: ${underlying}`);
      expect(mockOctokit.rest.actions.listWorkflowRuns).toHaveBeenCalledWith(
        expect.objectContaining({ head_sha: underlying })
      );
    });

    it('ECS-REQ-021: retries transient errors during tag resolution', async () => {
      mockOctokit.rest.git.getTag
        .mockRejectedValueOnce({ status: 502, message: 'Bad Gateway' })
        .mockRejectedValue({ status: 404 });
      mockOctokit.rest.actions.listWorkflowRuns.mockResolvedValue({
        data: { total_count: 1, workflow_runs: [completedRun('success')] }
      });

      await run();

      expect(core.warning).toHaveBeenCalledWith(
        'API error encountered (502). Retrying next interval.'
      );
      expect(mockOctokit.rest.git.getTag).toHaveBeenCalledTimes(2);
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'success');
      expect(core.setFailed).not.toHaveBeenCalled();
    });
  });

  describe('State Evaluation Matrix & Polling', () => {
    it('ECS-REQ-004, ECS-REQ-017: outputs PASS and queries the correct workflow and SHA', async () => {
      mockOctokit.rest.actions.listWorkflowRuns.mockResolvedValue({
        data: { total_count: 1, workflow_runs: [completedRun('success')] }
      });

      await run();

      expect(mockOctokit.rest.actions.listWorkflowRuns).toHaveBeenCalledWith({
        owner: 'mock-owner',
        repo: 'mock-repo',
        workflow_id: 'tests.yml',
        head_sha: MOCK_SHA,
        per_page: 100
      });
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'success');
      expect(core.setOutput).toHaveBeenCalledWith('run-url', 'http://run.url');
      expect(core.info).toHaveBeenCalledWith('Tests completed successfully.');
      expect(core.setFailed).not.toHaveBeenCalled();
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
      mockOctokit.rest.actions.listWorkflowRuns.mockResolvedValue({
        data: { total_count: 1, workflow_runs: [completedRun(conclusion)] }
      });

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'failure');
      expect(core.setOutput).toHaveBeenCalledWith('run-url', 'http://run.url');
      expect(core.setFailed).toHaveBeenCalledWith(`Tests failed with conclusion: ${conclusion}`);
    });

    it('ECS-REQ-006: outputs FAIL for completed runs with a null conclusion', async () => {
      mockOctokit.rest.actions.listWorkflowRuns.mockResolvedValue({
        data: { total_count: 1, workflow_runs: [completedRun(null)] }
      });

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'failure');
      expect(core.setFailed).toHaveBeenCalledWith('Tests failed with conclusion: unknown');
    });

    it.each(['queued', 'in_progress', 'waiting', 'pending', 'requested'])(
      'ECS-REQ-007, ECS-REQ-019: suspends and re-polls while tests are %s',
      async status => {
        mockOctokit.rest.actions.listWorkflowRuns
          .mockResolvedValueOnce({
            data: { total_count: 1, workflow_runs: [completedRun(null, { status })] }
          })
          .mockResolvedValueOnce({
            data: { total_count: 1, workflow_runs: [completedRun('success')] }
          });

        await run();

        expect(mockOctokit.rest.actions.listWorkflowRuns).toHaveBeenCalledTimes(2);
        expect(core.info).toHaveBeenCalledWith(
          `Tests currently in state: ${status}. Suspending and polling...`
        );
        expect(sleepSpy).toHaveBeenCalledWith(15000);
        expect(core.setOutput).toHaveBeenCalledWith('final-status', 'success');
      }
    );

    it('reports unknown for runs missing a status', async () => {
      mockOctokit.rest.actions.listWorkflowRuns
        .mockResolvedValueOnce({
          data: { total_count: 1, workflow_runs: [completedRun(null, { status: null })] }
        })
        .mockResolvedValueOnce({
          data: { total_count: 1, workflow_runs: [completedRun('success')] }
        });

      await run();

      expect(core.info).toHaveBeenCalledWith(
        'Tests currently in state: unknown. Suspending and polling...'
      );
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'success');
    });

    it('ECS-REQ-008: suspends when 0 runs exist, then resolves', async () => {
      mockOctokit.rest.actions.listWorkflowRuns
        .mockResolvedValueOnce({ data: { total_count: 0, workflow_runs: [] } })
        .mockResolvedValueOnce({
          data: { total_count: 1, workflow_runs: [completedRun('success')] }
        });

      await run();

      expect(mockOctokit.rest.actions.listWorkflowRuns).toHaveBeenCalledTimes(2);
      expect(core.info).toHaveBeenCalledWith(
        `No workflow runs found for SHA ${MOCK_SHA}. Suspending and polling...`
      );
      expect(sleepSpy).toHaveBeenCalledWith(15000);
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'success');
    });

    it('ECS-REQ-018: evaluates the most recent run by created_at', async () => {
      mockOctokit.rest.actions.listWorkflowRuns.mockResolvedValue({
        data: {
          total_count: 3,
          workflow_runs: [
            completedRun('success', {
              id: 10,
              created_at: '2026-07-01T00:00:00Z',
              html_url: 'http://old.url'
            }),
            completedRun('failure', {
              id: 11,
              created_at: '2026-07-02T00:00:00Z',
              html_url: 'http://new.url'
            }),
            completedRun('success', {
              id: 9,
              created_at: '2026-06-30T00:00:00Z',
              html_url: 'http://oldest.url'
            })
          ]
        }
      });

      await run();

      expect(mockOctokit.rest.actions.listWorkflowRuns).toHaveBeenCalledTimes(1);
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'failure');
      expect(core.setOutput).toHaveBeenCalledWith('run-url', 'http://new.url');
    });

    it('ECS-REQ-018: breaks created_at ties by run id', async () => {
      mockOctokit.rest.actions.listWorkflowRuns.mockResolvedValue({
        data: {
          total_count: 3,
          workflow_runs: [
            completedRun('failure', { id: 5, created_at: '', html_url: 'http://old.url' }),
            completedRun('success', { id: 9, created_at: '', html_url: 'http://new.url' }),
            completedRun('failure', { id: 3, created_at: '', html_url: 'http://older.url' })
          ]
        }
      });

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'success');
      expect(core.setOutput).toHaveBeenCalledWith('run-url', 'http://new.url');
    });

    it('ECS-REQ-016, ECS-REQ-019: times out, reporting the last observed run URL', async () => {
      mockOctokit.rest.actions.listWorkflowRuns.mockResolvedValue({
        data: {
          total_count: 1,
          workflow_runs: [
            completedRun(null, { status: 'in_progress', html_url: 'http://pending.url' })
          ]
        }
      });

      await run();

      expect(core.setFailed).toHaveBeenCalledWith(
        'Timeout exceeded (1m) while waiting for test resolution.'
      );
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'timeout');
      expect(core.setOutput).toHaveBeenCalledWith('run-url', 'http://pending.url');
      expect(sleepSpy).toHaveBeenCalledWith(15000);
    });

    it('ECS-REQ-016: omits run-url on timeout when no run was ever observed', async () => {
      mockOctokit.rest.actions.listWorkflowRuns.mockResolvedValue({
        data: { total_count: 0, workflow_runs: [] }
      });

      await run();

      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'timeout');
      expect(core.setOutput).not.toHaveBeenCalledWith('run-url', expect.anything());
      expect(core.setFailed).toHaveBeenCalledWith(
        'Timeout exceeded (1m) while waiting for test resolution.'
      );
    });
  });

  describe('ECS-REQ-021: API Resilience', () => {
    it('bypasses 5xx errors and retries', async () => {
      mockOctokit.rest.actions.listWorkflowRuns
        .mockRejectedValueOnce({ status: 502, message: 'Bad Gateway' })
        .mockResolvedValueOnce({
          data: { total_count: 1, workflow_runs: [completedRun('success')] }
        });

      await run();

      expect(mockOctokit.rest.actions.listWorkflowRuns).toHaveBeenCalledTimes(2);
      expect(core.warning).toHaveBeenCalledWith(
        'API error encountered (502). Retrying next interval.'
      );
      expect(sleepSpy).toHaveBeenCalledWith(15000);
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'success');
    });

    it('bypasses 429 rate limits and retries', async () => {
      mockOctokit.rest.actions.listWorkflowRuns
        .mockRejectedValueOnce({ status: 429, message: 'Too Many Requests' })
        .mockResolvedValueOnce({
          data: { total_count: 1, workflow_runs: [completedRun('success')] }
        });

      await run();

      expect(mockOctokit.rest.actions.listWorkflowRuns).toHaveBeenCalledTimes(2);
      expect(core.warning).toHaveBeenCalledWith(
        'API error encountered (429). Retrying next interval.'
      );
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'success');
    });

    it('honors retry-after headers when rate limited', async () => {
      mockOctokit.rest.actions.listWorkflowRuns
        .mockRejectedValueOnce({
          status: 429,
          message: 'Too Many Requests',
          response: { headers: { 'retry-after': '45' } }
        })
        .mockResolvedValueOnce({
          data: { total_count: 1, workflow_runs: [completedRun('success')] }
        });

      await run();

      expect(sleepSpy).toHaveBeenCalledWith(45000);
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'success');
    });

    it('retries 403 responses that carry rate-limit headers', async () => {
      mockOctokit.rest.actions.listWorkflowRuns
        .mockRejectedValueOnce({
          status: 403,
          message: 'rate limit exceeded',
          response: { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '130' } }
        })
        .mockResolvedValueOnce({
          data: { total_count: 1, workflow_runs: [completedRun('success')] }
        });

      await run();

      expect(core.warning).toHaveBeenCalledWith(
        'API error encountered (403). Retrying next interval.'
      );
      expect(sleepSpy).toHaveBeenCalledWith(30000);
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'success');
    });

    it('fails fast on 403 responses without rate-limit headers', async () => {
      mockOctokit.rest.actions.listWorkflowRuns.mockRejectedValueOnce({
        status: 403,
        message: 'Resource not accessible by integration'
      });

      await run();

      expect(core.setFailed).toHaveBeenCalledWith('Resource not accessible by integration');
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'error');
    });

    it('fails fast on non-retryable 4xx errors', async () => {
      mockOctokit.rest.actions.listWorkflowRuns.mockRejectedValueOnce({
        status: 401,
        message: 'Unauthorized'
      });

      await run();

      expect(core.setFailed).toHaveBeenCalledWith('Unauthorized');
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'error');
      expect(mockOctokit.rest.actions.listWorkflowRuns).toHaveBeenCalledTimes(1);
    });

    it('reports a contextual error when the workflow does not exist (404)', async () => {
      mockOctokit.rest.actions.listWorkflowRuns.mockRejectedValueOnce({
        status: 404,
        message: 'Not Found'
      });

      await run();

      expect(core.setFailed).toHaveBeenCalledWith(
        "Workflow 'tests.yml' not found in mock-owner/mock-repo (HTTP 404). " +
          "Check the workflow-id input and the token's actions:read permission."
      );
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'error');
    });
  });

  describe('Error shape handling', () => {
    it('handles standard Error instances', async () => {
      mockOctokit.rest.actions.listWorkflowRuns.mockRejectedValueOnce(new Error('Standard Error'));

      await run();

      expect(core.setFailed).toHaveBeenCalledWith('Standard Error');
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'error');
    });

    it('handles message-bearing non-Error objects', async () => {
      mockOctokit.rest.actions.listWorkflowRuns.mockRejectedValueOnce({
        status: 400,
        message: 'Bad Request'
      });

      await run();

      expect(core.setFailed).toHaveBeenCalledWith('Bad Request');
    });

    it('handles unexpected error formats', async () => {
      mockOctokit.rest.actions.listWorkflowRuns.mockRejectedValueOnce('Some string error');

      await run();

      expect(core.setFailed).toHaveBeenCalledWith('An unexpected error occurred.');
      expect(core.setOutput).toHaveBeenCalledWith('final-status', 'error');
    });
  });
});
