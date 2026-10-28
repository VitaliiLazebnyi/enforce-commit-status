import { afterEach, describe, expect, it, vi } from 'vitest';
import { utils } from '../src/utils.js';

interface TagResponse {
  data: { object: { sha: string; type: string } };
}

const makeClient = (
  getTag: (parameters: { owner: string; repo: string; tag_sha: string }) => Promise<TagResponse>
): Parameters<typeof utils.resolveCommitSha>[0] => ({ rest: { git: { getTag } } });

const tagObject = (sha: string, type: string): TagResponse => ({ data: { object: { sha, type } } });

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const YEAR = 365.25 * DAY;

describe('utils', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('ECS-REQ-012, ECS-REQ-015: parseDuration', () => {
    it.each([
      ['500', 500],
      ['1.25s', 1250],
      ['.5s', 500],
      ['.25s', 250],
      ['5s', 5 * SECOND],
      ['15s', 15 * SECOND],
      ['5 m', 5 * MINUTE],
      ['5   m', 5 * MINUTE],
      ['2H', 2 * HOUR]
    ])('parses %s', (value, expected) => {
      expect(utils.parseDuration(value)).toBe(expected);
    });

    it.each([
      ['milliseconds', 1],
      ['millisecond', 1],
      ['msecs', 1],
      ['msec', 1],
      ['ms', 1],
      ['seconds', SECOND],
      ['second', SECOND],
      ['secs', SECOND],
      ['sec', SECOND],
      ['s', SECOND],
      ['minutes', MINUTE],
      ['minute', MINUTE],
      ['mins', MINUTE],
      ['min', MINUTE],
      ['m', MINUTE],
      ['hours', HOUR],
      ['hour', HOUR],
      ['hrs', HOUR],
      ['hr', HOUR],
      ['h', HOUR],
      ['days', DAY],
      ['day', DAY],
      ['d', DAY],
      ['weeks', WEEK],
      ['week', WEEK],
      ['w', WEEK]
    ])('accepts the unit %s', (unit, multiplier) => {
      expect(utils.parseDuration(`3${unit}`)).toBe(3 * multiplier);
    });

    it.each(['years', 'year', 'yrs', 'yr', 'y'])('accepts the unit %s', unit => {
      expect(utils.parseDuration(`0.001${unit}`)).toBe(0.001 * YEAR);
    });

    it('trims surrounding whitespace', () => {
      expect(utils.parseDuration(' 15s ')).toBe(15 * SECOND);
    });

    it('accepts durations of exactly 100 characters', () => {
      expect(utils.parseDuration(`${'0'.repeat(98)}1s`)).toBe(SECOND);
    });

    it.each([
      ['invalid', 'invalid'],
      ['empty', ''],
      ['blank', ' '.repeat(3)],
      ['unit-only', 's'],
      ['unknown unit', '5x'],
      ['trailing garbage', '5s later'],
      ['leading garbage', 'in 5s'],
      ['longer than 100 characters', `${'0'.repeat(99)}1s`]
    ])('throws a uniform error on %s input', (_description, value) => {
      expect(() => utils.parseDuration(value)).toThrow(`Invalid duration format: ${value}`);
    });

    it('rejects negative durations', () => {
      expect(() => utils.parseDuration('-5s')).toThrow('Duration must be positive: -5s');
    });

    it('rejects zero durations', () => {
      expect(() => utils.parseDuration('0s')).toThrow('Duration must be positive: 0s');
    });

    it('clamps durations above the setTimeout limit (~24.8 days)', () => {
      expect(utils.parseDuration('30d')).toBe(2_147_483_647);
    });
  });

  describe('getErrorStatus', () => {
    it('extracts a numeric status from octokit-style errors', () => {
      expect(utils.getErrorStatus({ status: 502 })).toBe(502);
    });

    it.each([
      ['a non-numeric status', { status: 'nope' }],
      ['an object without status', {}],
      ['null', null],
      ['undefined', undefined],
      ['a string', 'boom']
    ])('returns undefined for %s', (_description, error) => {
      expect(utils.getErrorStatus(error)).toBeUndefined();
    });
  });

  describe('ECS-REQ-021: isRetryableApiError', () => {
    it.each([500, 502, 599, 429])('retries HTTP %i responses', status => {
      expect(utils.isRetryableApiError({ status })).toBe(true);
    });

    it.each([
      ['an exhausted quota', { 'x-ratelimit-remaining': '0' }],
      ['an exhausted quota (numeric header)', { 'x-ratelimit-remaining': 0 }],
      ['a retry-after header', { 'retry-after': '60' }]
    ])('retries 403 responses carrying %s', (_description, headers) => {
      expect(utils.isRetryableApiError({ status: 403, response: { headers } })).toBe(true);
    });

    it.each([
      ['a plain 403', { status: 403 }],
      ['a 403 without rate-limit headers', { status: 403, response: { headers: {} } }],
      [
        'a 403 with quota left',
        { status: 403, response: { headers: { 'x-ratelimit-remaining': '10' } } }
      ],
      [
        'a 401 with rate-limit headers',
        { status: 401, response: { headers: { 'retry-after': '60' } } }
      ],
      ['a 499', { status: 499 }],
      ['a 404', { status: 404 }],
      ['an Error without status', new Error('boom')],
      ['null', null]
    ])('does not retry %s', (_description, error) => {
      expect(utils.isRetryableApiError(error)).toBe(false);
    });

    it.each([
      ['a null response', null],
      ['an undefined response', undefined],
      ['a response without headers', {}],
      ['null headers', { headers: null }],
      ['a non-scalar header value', { headers: { 'retry-after': { seconds: 60 } } }]
    ])('tolerates %s', (_description, response) => {
      expect(utils.isRetryableApiError({ status: 403, response })).toBe(false);
    });
  });

  describe('ECS-REQ-021: getRetryAfterMs', () => {
    const headers = (values: Record<string, unknown>): unknown => ({
      status: 403,
      response: { headers: values }
    });

    it('converts retry-after seconds to milliseconds', () => {
      expect(utils.getRetryAfterMs(headers({ 'retry-after': '30' }))).toBe(30 * SECOND);
    });

    it('accepts numeric retry-after values', () => {
      expect(utils.getRetryAfterMs(headers({ 'retry-after': 7 }))).toBe(7 * SECOND);
    });

    it('prefers retry-after over x-ratelimit-reset', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

      expect(
        utils.getRetryAfterMs(
          headers({ 'retry-after': '5', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1030' })
        )
      ).toBe(5 * SECOND);
    });

    it('ignores non-numeric retry-after values', () => {
      expect(utils.getRetryAfterMs(headers({ 'retry-after': 'soon' }))).toBe(0);
    });

    it('derives the delay from x-ratelimit-reset once the quota is exhausted', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

      expect(
        utils.getRetryAfterMs(
          headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1030' })
        )
      ).toBe(30 * SECOND);
    });

    it('falls back from a non-numeric retry-after to x-ratelimit-reset', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

      expect(
        utils.getRetryAfterMs(
          headers({
            'retry-after': 'soon',
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1030'
          })
        )
      ).toBe(30 * SECOND);
    });

    it('regression: ignores x-ratelimit-reset while quota remains', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

      expect(
        utils.getRetryAfterMs(
          headers({ 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '4600' })
        )
      ).toBe(0);
      expect(utils.getRetryAfterMs(headers({ 'x-ratelimit-reset': '4600' }))).toBe(0);
    });

    it('floors past x-ratelimit-reset values at zero', () => {
      vi.spyOn(Date, 'now').mockReturnValue(2_000_000);

      expect(
        utils.getRetryAfterMs(
          headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1030' })
        )
      ).toBe(0);
    });

    it('ignores a non-numeric x-ratelimit-reset', () => {
      expect(
        utils.getRetryAfterMs(
          headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': 'later' })
        )
      ).toBe(0);
    });

    it.each([
      ['an error without a response', { status: 500 }],
      ['null', null],
      ['a string', 'boom']
    ])('returns 0 for %s', (_description, error) => {
      expect(utils.getRetryAfterMs(error)).toBe(0);
    });
  });

  describe('ECS-REQ-020: resolveCommitSha', () => {
    it('resolves an annotated tag to its underlying commit SHA', async () => {
      const getTag = vi
        .fn<
          (parameters: { owner: string; repo: string; tag_sha: string }) => Promise<TagResponse>
        >()
        .mockResolvedValue(tagObject('underlying-commit-sha', 'commit'));

      await expect(utils.resolveCommitSha(makeClient(getTag), 'o', 'r', 'tag-sha')).resolves.toBe(
        'underlying-commit-sha'
      );
      expect(getTag).toHaveBeenCalledWith({ owner: 'o', repo: 'r', tag_sha: 'tag-sha' });
    });

    it('peels nested annotated tags (tag -> tag -> commit)', async () => {
      const getTag = vi
        .fn<
          (parameters: { owner: string; repo: string; tag_sha: string }) => Promise<TagResponse>
        >()
        .mockResolvedValueOnce(tagObject('inner-tag-sha', 'tag'))
        .mockResolvedValueOnce(tagObject('commit-sha', 'commit'));

      await expect(
        utils.resolveCommitSha(makeClient(getTag), 'o', 'r', 'outer-tag-sha')
      ).resolves.toBe('commit-sha');
      expect(getTag).toHaveBeenCalledTimes(2);
      expect(getTag).toHaveBeenLastCalledWith({ owner: 'o', repo: 'r', tag_sha: 'inner-tag-sha' });
    });

    it('proceeds with the current SHA once the git database API returns 404', async () => {
      const getTag = vi
        .fn<
          (parameters: { owner: string; repo: string; tag_sha: string }) => Promise<TagResponse>
        >()
        .mockResolvedValueOnce(tagObject('inner-sha', 'tag'))
        .mockRejectedValue({ status: 404 });

      await expect(
        utils.resolveCommitSha(makeClient(getTag), 'o', 'r', 'plain-commit-sha')
      ).resolves.toBe('inner-sha');
    });

    it('fails fast when a tag points at a non-commit object', async () => {
      const getTag = vi
        .fn<
          (parameters: { owner: string; repo: string; tag_sha: string }) => Promise<TagResponse>
        >()
        .mockResolvedValue(tagObject('tree-sha', 'tree'));

      await expect(utils.resolveCommitSha(makeClient(getTag), 'o', 'r', 'tag-sha')).rejects.toThrow(
        "Annotated tag tag-sha does not resolve to a commit (points to a 'tree' object)."
      );
    });

    it('peels up to 10 levels of nested tags', async () => {
      const getTag = vi
        .fn<
          (parameters: { owner: string; repo: string; tag_sha: string }) => Promise<TagResponse>
        >()
        .mockResolvedValue(tagObject('another-tag-sha', 'tag'))
        .mockResolvedValueOnce(tagObject('t1', 'tag'))
        .mockResolvedValueOnce(tagObject('t2', 'tag'))
        .mockResolvedValueOnce(tagObject('t3', 'tag'))
        .mockResolvedValueOnce(tagObject('t4', 'tag'))
        .mockResolvedValueOnce(tagObject('t5', 'tag'))
        .mockResolvedValueOnce(tagObject('t6', 'tag'))
        .mockResolvedValueOnce(tagObject('t7', 'tag'))
        .mockResolvedValueOnce(tagObject('t8', 'tag'))
        .mockResolvedValueOnce(tagObject('t9', 'tag'))
        .mockResolvedValueOnce(tagObject('deep-commit', 'commit'));

      await expect(utils.resolveCommitSha(makeClient(getTag), 'o', 'r', 'tag-sha')).resolves.toBe(
        'deep-commit'
      );
      expect(getTag).toHaveBeenCalledTimes(10);
    });

    it('fails fast on absurdly deep tag nesting', async () => {
      const getTag = vi
        .fn<
          (parameters: { owner: string; repo: string; tag_sha: string }) => Promise<TagResponse>
        >()
        .mockResolvedValue(tagObject('another-tag-sha', 'tag'));

      await expect(utils.resolveCommitSha(makeClient(getTag), 'o', 'r', 'tag-sha')).rejects.toThrow(
        'Annotated tag tag-sha exceeds the maximum nesting depth of 10.'
      );
      expect(getTag).toHaveBeenCalledTimes(10);
    });

    it('rethrows non-404 API errors for the caller to classify', async () => {
      const getTag = vi
        .fn<
          (parameters: { owner: string; repo: string; tag_sha: string }) => Promise<TagResponse>
        >()
        .mockRejectedValueOnce({ status: 500, message: 'Internal Server Error' });

      await expect(
        utils.resolveCommitSha(makeClient(getTag), 'o', 'r', 'tag-sha')
      ).rejects.toStrictEqual({ status: 500, message: 'Internal Server Error' });
    });
  });

  describe('ECS-REQ-019: sleep', () => {
    it('resolves only after the specified milliseconds', async () => {
      vi.useFakeTimers();
      const settled = vi.fn<() => void>();
      void utils.sleep(1000).then(settled);

      await vi.advanceTimersByTimeAsync(999);

      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);

      expect(settled).toHaveBeenCalledTimes(1);
    });

    it('clamps negative delays to zero', async () => {
      vi.useFakeTimers();
      const settled = vi.fn<() => void>();
      void utils.sleep(-100).then(settled);

      await vi.advanceTimersByTimeAsync(0);

      expect(settled).toHaveBeenCalledTimes(1);
    });

    it('clamps delays above the setTimeout limit', async () => {
      vi.useFakeTimers();
      const settled = vi.fn<() => void>();
      void utils.sleep(3_000_000_000).then(settled);

      await vi.advanceTimersByTimeAsync(2_147_483_646);

      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);

      expect(settled).toHaveBeenCalledTimes(1);
    });
  });
});
