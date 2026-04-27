import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

jest.unstable_mockModule('@actions/core', () => ({
  getInput: jest.fn<any>(),
  setOutput: jest.fn<any>(),
  setFailed: jest.fn<any>(),
  info: jest.fn<any>(),
  warning: jest.fn<any>()
}));

jest.unstable_mockModule('@actions/github', () => ({
  getOctokit: jest.fn<any>(),
  context: {
    repo: {
      owner: 'mock-owner',
      repo: 'mock-repo'
    },
    sha: 'mock-context-sha'
  }
}));

const core = await import('@actions/core');
const github = await import('@actions/github');
const { run } = await import('../src/action.js');
const { utils } = await import('../src/utils.js');

describe('Enforce Commit Status Action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Utility Functions', () => {
    describe('ECS-REQ-012, ECS-REQ-015: Duration Parsing', () => {
      it('parses valid duration strings into milliseconds', () => {
        expect(utils.parseDuration('15s')).toBe(15000);
        expect(utils.parseDuration('1m')).toBe(60000);
      });

      it('enforces a minimum of 10s for poll interval', () => {
        expect(utils.parseDuration('5s')).toBe(10000);
      });

      it('throws on invalid duration strings', () => {
        expect(() => utils.parseDuration('invalid')).toThrow();
      });
    });

    describe('Sleep Function', () => {
      it('resolves after specified milliseconds', async () => {
        jest.useFakeTimers();
        const promise = utils.sleep(1000);
        jest.advanceTimersByTime(1000);
        await expect(promise).resolves.toBeUndefined();
        jest.useRealTimers();
      });
    });
  });

  describe('Core Action Logic', () => {
    const mockOctokit = {
      rest: {
        git: {
          getTag: jest.fn<(...args: unknown[]) => Promise<unknown>>()
        },
        actions: {
          getWorkflowRun: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
          listWorkflowRuns: jest.fn<(...args: unknown[]) => Promise<unknown>>()
        }
      }
    };

    beforeEach(() => {
      mockOctokit.rest.git.getTag.mockRejectedValue({ status: 404 });
      (github.getOctokit as jest.Mock).mockReturnValue(mockOctokit);
      (core.getInput as jest.Mock<typeof core.getInput>).mockImplementation((name: string) => {
        const inputs: Record<string, string> = {
          'workflow-id': 'tests.yml',
          'commit-sha': 'mock-sha',
          'github-token': 'mock-token',
          'poll-interval': '15s',
          timeout: '1m'
        };
        return inputs[name] || '';
      });
    });

    describe('ECS-REQ-020: Annotated Tag Resolution', () => {
      it('resolves an annotated tag to its underlying commit SHA', async () => {
        mockOctokit.rest.git.getTag.mockResolvedValue({
          status: 200,
          data: { object: { sha: 'underlying-commit-sha' } }
        });
        
        const sha = await utils.resolveCommitSha(mockOctokit as unknown as ReturnType<typeof github.getOctokit>, 'mock-owner', 'mock-repo', 'tag-sha');
        expect(sha).toBe('underlying-commit-sha');
        expect(mockOctokit.rest.git.getTag).toHaveBeenCalledWith({
          owner: 'mock-owner',
          repo: 'mock-repo',
          tag_sha: 'tag-sha'
        });
      });

      it('proceeds with original SHA if git database API returns 404', async () => {
        mockOctokit.rest.git.getTag.mockRejectedValue({ status: 404 });
        
        const sha = await utils.resolveCommitSha(mockOctokit as unknown as ReturnType<typeof github.getOctokit>, 'mock-owner', 'mock-repo', 'tag-sha');
        expect(sha).toBe('tag-sha');
      });

      it('throws on non-404 API errors', async () => {
        mockOctokit.rest.git.getTag.mockRejectedValueOnce({ status: 500, message: 'Internal Server Error' });
        
        await expect(utils.resolveCommitSha(mockOctokit as unknown as ReturnType<typeof github.getOctokit>, 'mock-owner', 'mock-repo', 'tag-sha'))
          .rejects.toEqual({ status: 500, message: 'Internal Server Error' });
      });
    });

    describe('State Evaluation Matrix & Polling', () => {
      let now = 100000;
      let dateSpy: ReturnType<typeof jest.spyOn>;
      let sleepSpy: ReturnType<typeof jest.spyOn>;

      beforeEach(() => {
        now = 100000;
        dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => {
          return now;
        });
        sleepSpy = jest.spyOn(utils, 'sleep').mockResolvedValue(undefined);
      });

      afterEach(() => {
        dateSpy.mockRestore();
        sleepSpy.mockRestore();
      });

      it('ECS-REQ-004: Outputs PASS and exits 0 when tests succeed', async () => {
        mockOctokit.rest.actions.listWorkflowRuns.mockResolvedValue({
          data: {
            total_count: 1,
            workflow_runs: [
              { run_attempt: 1, status: 'completed', conclusion: 'success', html_url: 'http://run.url' }
            ]
          }
        });

        await run();

        expect(core.setOutput).toHaveBeenCalledWith('final-status', 'success');
        expect(core.setOutput).toHaveBeenCalledWith('run-url', 'http://run.url');
        expect(core.setFailed).not.toHaveBeenCalled();
      });

      it('ECS-REQ-005, ECS-REQ-006: Outputs FAIL and exits 1 when tests fail or timeout', async () => {
        mockOctokit.rest.actions.listWorkflowRuns.mockResolvedValue({
          data: {
            total_count: 1,
            workflow_runs: [
              { run_attempt: 1, status: 'completed', conclusion: 'failure', html_url: 'http://run.url' }
            ]
          }
        });

        await run();

        expect(core.setOutput).toHaveBeenCalledWith('final-status', 'failure');
        expect(core.setOutput).toHaveBeenCalledWith('run-url', 'http://run.url');
        expect(core.setFailed).toHaveBeenCalledWith('Tests failed with conclusion: failure');
      });

      it('ECS-REQ-016, ECS-REQ-019: Times out after exceeding timeout boundary', async () => {
        mockOctokit.rest.actions.listWorkflowRuns.mockResolvedValue({
          data: {
            total_count: 1,
            workflow_runs: [
              { run_attempt: 1, status: 'in_progress', conclusion: null }
            ]
          }
        });

        dateSpy.mockImplementation(() => {
          now += 15000;
          return now;
        });

        await run();

        expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Timeout exceeded'));
        expect(core.setOutput).toHaveBeenCalledWith('final-status', 'timeout');
      });

      it('ECS-REQ-018: Evaluates exclusively the most recent run_attempt', async () => {
        mockOctokit.rest.actions.listWorkflowRuns.mockResolvedValue({
          data: {
            total_count: 2,
            workflow_runs: [
              { run_attempt: 1, status: 'completed', conclusion: 'failure', html_url: 'http://fail.url' },
              { run_attempt: 2, status: 'completed', conclusion: 'success', html_url: 'http://success.url' }
            ]
          }
        });

        await run();

        expect(core.setOutput).toHaveBeenCalledWith('final-status', 'success');
        expect(core.setOutput).toHaveBeenCalledWith('run-url', 'http://success.url');
      });
      
      it('ECS-REQ-008: Suspends when 0 runs exist', async () => {
        mockOctokit.rest.actions.listWorkflowRuns
          .mockResolvedValueOnce({
            data: { total_count: 0, workflow_runs: [] }
          })
          .mockResolvedValueOnce({
            data: {
              total_count: 1,
              workflow_runs: [
                { run_attempt: 1, status: 'completed', conclusion: 'success', html_url: 'http://run.url' }
              ]
            }
          });

        await run();

        expect(mockOctokit.rest.actions.listWorkflowRuns).toHaveBeenCalledTimes(2);
        expect(core.setOutput).toHaveBeenCalledWith('final-status', 'success');
      });

      it('ECS-REQ-021: Bypasses 5xx errors and retries', async () => {
        mockOctokit.rest.actions.listWorkflowRuns
          .mockRejectedValueOnce({ status: 502, message: 'Bad Gateway' })
          .mockResolvedValueOnce({
            data: {
              total_count: 1,
              workflow_runs: [
                { run_attempt: 1, status: 'completed', conclusion: 'success', html_url: 'http://run.url' }
              ]
            }
          });

        await run();

        expect(mockOctokit.rest.actions.listWorkflowRuns).toHaveBeenCalledTimes(2);
        expect(core.setOutput).toHaveBeenCalledWith('final-status', 'success');
      });

      it('throws immediately on 4xx errors other than 404 in tag lookup or 429', async () => {
        mockOctokit.rest.actions.listWorkflowRuns.mockRejectedValueOnce({ status: 401, message: 'Unauthorized' });

        await run();

        expect(core.setFailed).toHaveBeenCalledWith('Unauthorized');
      });

      it('handles unexpected error formats correctly', async () => {
        mockOctokit.rest.actions.listWorkflowRuns.mockRejectedValueOnce('Some string error');
        await run();
        expect(core.setFailed).toHaveBeenCalledWith('An unexpected error occurred.');
      });

      it('handles standard Error instances correctly', async () => {
        mockOctokit.rest.actions.listWorkflowRuns.mockRejectedValueOnce(new Error('Standard Error'));
        await run();
        expect(core.setFailed).toHaveBeenCalledWith('Standard Error');
      });

      it('handles missing workflow properties gracefully (branch coverage)', async () => {
        mockOctokit.rest.actions.listWorkflowRuns
          .mockResolvedValueOnce({
            data: { total_count: 2, workflow_runs: [{ run_attempt: undefined, status: null, conclusion: null }, { run_attempt: null, status: null, conclusion: null }] }
          })
          .mockResolvedValueOnce({
            data: { total_count: 1, workflow_runs: [{ run_attempt: null, status: 'completed', conclusion: null, html_url: 'http://run.url' }] }
          });

        await run(); 
        
        expect(core.info).toHaveBeenCalledWith('Tests currently in state: unknown. Suspending and polling...');
        expect(core.setFailed).toHaveBeenCalledWith('Tests failed with conclusion: unknown');
      });

      it('falls back to default timeout if invalid', async () => {
        (core.getInput as jest.Mock<typeof core.getInput>).mockImplementation((name: string) => {
          if (name === 'timeout') return 'invalid';
          if (name === 'workflow-id') return 'tests.yml';
          return '';
        });

        mockOctokit.rest.actions.listWorkflowRuns.mockResolvedValue({
          data: { total_count: 1, workflow_runs: [{ run_attempt: 1, status: 'in_progress', conclusion: null }] }
        });

        dateSpy.mockImplementation(() => {
          now += 3700000;
          return now;
        });

        await run();

        expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Timeout exceeded'));
      });

      it('falls back to 1h timeout if empty', async () => {
        (core.getInput as jest.Mock<typeof core.getInput>).mockImplementation((name: string) => {
          if (name === 'timeout') return '';
          if (name === 'poll-interval') return '';
          if (name === 'workflow-id') return 'tests.yml';
          return '';
        });

        mockOctokit.rest.actions.listWorkflowRuns.mockResolvedValue({
          data: { total_count: 1, workflow_runs: [{ run_attempt: 1, status: 'in_progress', conclusion: null }] }
        });

        dateSpy.mockImplementation(() => {
          now += 3700000;
          return now;
        });

        await run();

        expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Timeout exceeded (1h)'));
      });
    });
  });
});
