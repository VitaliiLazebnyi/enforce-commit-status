import { jest, describe, it, expect, afterEach } from '@jest/globals';
import { utils } from '../src/utils.js';
import type * as githubType from '@actions/github';

type Octokit = ReturnType<typeof githubType.getOctokit>;

const asOctokit = (mock: unknown): Octokit => mock as Octokit;

describe('utils', () => {
  describe('ECS-REQ-012, ECS-REQ-015: parseDuration', () => {
    it('parses valid duration strings into milliseconds', () => {
      expect(utils.parseDuration('15s')).toBe(15000);
      expect(utils.parseDuration('1m')).toBe(60000);
      expect(utils.parseDuration('45m')).toBe(2700000);
    });

    it('parses bare numeric strings as milliseconds', () => {
      expect(utils.parseDuration('500')).toBe(500);
    });

    it('trims surrounding whitespace', () => {
      expect(utils.parseDuration(' 15s ')).toBe(15000);
    });

    it('throws a uniform error on invalid duration strings', () => {
      expect(() => utils.parseDuration('invalid')).toThrow('Invalid duration format: invalid');
    });

    it('throws a uniform error on empty strings', () => {
      expect(() => utils.parseDuration('')).toThrow('Invalid duration format: ');
    });

    it('rejects negative durations', () => {
      expect(() => utils.parseDuration('-5s')).toThrow('Duration must be positive: -5s');
    });

    it('rejects zero durations', () => {
      expect(() => utils.parseDuration('0s')).toThrow('Duration must be positive: 0s');
    });

    it('clamps durations above the setTimeout limit (~24.8 days)', () => {
      expect(utils.parseDuration('30d')).toBe(2147483647);
    });
  });

  describe('getErrorStatus', () => {
    it('extracts a numeric status from octokit-style errors', () => {
      expect(utils.getErrorStatus({ status: 502 })).toBe(502);
    });

    it('returns undefined for non-numeric statuses and non-objects', () => {
      expect(utils.getErrorStatus({ status: 'nope' })).toBeUndefined();
      expect(utils.getErrorStatus({})).toBeUndefined();
      expect(utils.getErrorStatus(null)).toBeUndefined();
      expect(utils.getErrorStatus('boom')).toBeUndefined();
    });
  });

  describe('ECS-REQ-021: isRetryableApiError', () => {
    it('retries 5xx and 429 responses', () => {
      expect(utils.isRetryableApiError({ status: 500 })).toBe(true);
      expect(utils.isRetryableApiError({ status: 502 })).toBe(true);
      expect(utils.isRetryableApiError({ status: 429 })).toBe(true);
    });

    it('retries 403 responses carrying rate-limit headers', () => {
      expect(
        utils.isRetryableApiError({
          status: 403,
          response: { headers: { 'x-ratelimit-remaining': '0' } }
        })
      ).toBe(true);
      expect(
        utils.isRetryableApiError({
          status: 403,
          response: { headers: { 'retry-after': '60' } }
        })
      ).toBe(true);
    });

    it('does not retry plain 403 or other 4xx responses', () => {
      expect(utils.isRetryableApiError({ status: 403 })).toBe(false);
      expect(utils.isRetryableApiError({ status: 403, response: { headers: {} } })).toBe(false);
      expect(utils.isRetryableApiError({ status: 401 })).toBe(false);
      expect(utils.isRetryableApiError({ status: 404 })).toBe(false);
    });

    it('does not retry errors without a status', () => {
      expect(utils.isRetryableApiError(new Error('boom'))).toBe(false);
      expect(utils.isRetryableApiError(null)).toBe(false);
    });

    it('tolerates malformed response shapes', () => {
      expect(utils.isRetryableApiError({ status: 403, response: null })).toBe(false);
      expect(utils.isRetryableApiError({ status: 403, response: {} })).toBe(false);
      expect(utils.isRetryableApiError({ status: 403, response: { headers: null } })).toBe(false);
    });
  });

  describe('ECS-REQ-021: getRetryAfterMs', () => {
    it('converts retry-after seconds to milliseconds', () => {
      expect(
        utils.getRetryAfterMs({ status: 429, response: { headers: { 'retry-after': '30' } } })
      ).toBe(30000);
    });

    it('ignores non-numeric retry-after values', () => {
      expect(
        utils.getRetryAfterMs({ status: 429, response: { headers: { 'retry-after': 'soon' } } })
      ).toBeUndefined();
    });

    it('derives the delay from x-ratelimit-reset', () => {
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(1000000);
      expect(
        utils.getRetryAfterMs({
          status: 403,
          response: { headers: { 'x-ratelimit-reset': '1030' } }
        })
      ).toBe(30000);
      dateSpy.mockRestore();
    });

    it('floors past x-ratelimit-reset values at zero', () => {
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(2000000);
      expect(
        utils.getRetryAfterMs({
          status: 403,
          response: { headers: { 'x-ratelimit-reset': '1030' } }
        })
      ).toBe(0);
      dateSpy.mockRestore();
    });

    it('returns undefined when no rate-limit headers are present', () => {
      expect(utils.getRetryAfterMs({ status: 502 })).toBeUndefined();
      expect(utils.getRetryAfterMs({ status: 429, response: { headers: {} } })).toBeUndefined();
    });
  });

  describe('ECS-REQ-020: resolveCommitSha', () => {
    const makeOctokit = (getTag: jest.Mock<(...args: unknown[]) => Promise<unknown>>): Octokit =>
      asOctokit({ rest: { git: { getTag } } });

    it('resolves an annotated tag to its underlying commit SHA', async () => {
      const getTag = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ data: { object: { sha: 'underlying-commit-sha', type: 'commit' } } });

      const sha = await utils.resolveCommitSha(makeOctokit(getTag), 'o', 'r', 'tag-sha');
      expect(sha).toBe('underlying-commit-sha');
      expect(getTag).toHaveBeenCalledWith({ owner: 'o', repo: 'r', tag_sha: 'tag-sha' });
    });

    it('peels nested annotated tags (tag -> tag -> commit)', async () => {
      const getTag = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValueOnce({ data: { object: { sha: 'inner-tag-sha', type: 'tag' } } })
        .mockResolvedValueOnce({ data: { object: { sha: 'commit-sha', type: 'commit' } } });

      const sha = await utils.resolveCommitSha(makeOctokit(getTag), 'o', 'r', 'outer-tag-sha');
      expect(sha).toBe('commit-sha');
      expect(getTag).toHaveBeenCalledTimes(2);
      expect(getTag).toHaveBeenLastCalledWith({ owner: 'o', repo: 'r', tag_sha: 'inner-tag-sha' });
    });

    it('proceeds with the original SHA if the git database API returns 404', async () => {
      const getTag = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockRejectedValue({ status: 404 });

      const sha = await utils.resolveCommitSha(makeOctokit(getTag), 'o', 'r', 'plain-commit-sha');
      expect(sha).toBe('plain-commit-sha');
    });

    it('fails fast when a tag points at a non-commit object', async () => {
      const getTag = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ data: { object: { sha: 'tree-sha', type: 'tree' } } });

      await expect(
        utils.resolveCommitSha(makeOctokit(getTag), 'o', 'r', 'tag-sha')
      ).rejects.toThrow(
        "Annotated tag tag-sha does not resolve to a commit (points to a 'tree' object)."
      );
    });

    it('fails fast on absurdly deep tag nesting', async () => {
      const getTag = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ data: { object: { sha: 'another-tag-sha', type: 'tag' } } });

      await expect(
        utils.resolveCommitSha(makeOctokit(getTag), 'o', 'r', 'tag-sha')
      ).rejects.toThrow('Annotated tag tag-sha exceeds the maximum nesting depth of 10.');
    });

    it('rethrows non-404 API errors for the caller to classify', async () => {
      const getTag = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockRejectedValueOnce({ status: 500, message: 'Internal Server Error' });

      await expect(
        utils.resolveCommitSha(makeOctokit(getTag), 'o', 'r', 'tag-sha')
      ).rejects.toEqual({ status: 500, message: 'Internal Server Error' });
    });
  });

  describe('ECS-REQ-019: sleep', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('resolves only after the specified milliseconds', async () => {
      jest.useFakeTimers();
      let resolved = false;
      void utils.sleep(1000).then(() => {
        resolved = true;
      });

      await jest.advanceTimersByTimeAsync(999);
      expect(resolved).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(resolved).toBe(true);
    });

    it('clamps negative delays to zero', async () => {
      jest.useFakeTimers();
      let resolved = false;
      void utils.sleep(-100).then(() => {
        resolved = true;
      });

      await jest.advanceTimersByTimeAsync(0);
      expect(resolved).toBe(true);
    });

    it('clamps delays above the setTimeout limit', async () => {
      jest.useFakeTimers();
      let resolved = false;
      void utils.sleep(3000000000).then(() => {
        resolved = true;
      });

      await jest.advanceTimersByTimeAsync(2147483647);
      expect(resolved).toBe(true);
    });
  });
});
