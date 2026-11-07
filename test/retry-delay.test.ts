/**
 * @file The delay GitHub requests before a retry (ECS-REQ-021).
 */
import { describe, expect, it, vi } from 'vitest';
import { utilities } from '../src/utilities.ts';

const TEST_OPTIONS = { timeout: 1000 };
const SECOND = 1000;

/**
 * Builds a 403 error carrying the given response headers.
 * @param values - The response headers, by name.
 * @returns The error.
 */
function withHeaders(values: Readonly<Record<string, unknown>>): unknown {
  return { response: { headers: values }, status: 403 };
}

describe('ECS-REQ-021: retry-after', () => {
  it.each([
    ['seconds', '30', 30 * SECOND],
    ['a numeric value', 7, 7 * SECOND],
    ['a non-numeric value (ignored)', 'soon', 0]
  ])('converts retry-after %s to milliseconds', TEST_OPTIONS, (_description, value, expected) => {
    expect.hasAssertions();

    expect(utilities.getRetryAfterMs(withHeaders({ 'retry-after': value }))).toBe(expected);
  });

  it.each([
    ['prefers retry-after over x-ratelimit-reset', '5', 5 * SECOND],
    ['falls back from a non-numeric retry-after to x-ratelimit-reset', 'soon', 30 * SECOND]
  ])('%s', TEST_OPTIONS, (_description, retryAfter, expected) => {
    expect.hasAssertions();
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);

    expect(
      utilities.getRetryAfterMs(
        withHeaders({
          'retry-after': retryAfter,
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1030'
        })
      )
    ).toBe(expected);
  });
});

describe('ECS-REQ-021: x-ratelimit-reset', () => {
  it.each([
    {
      description: 'derives the delay from it once the quota is exhausted',
      expected: 30 * SECOND,
      now: 1_000_000,
      remaining: '0',
      reset: '1030'
    },
    {
      description: 'ignores it while quota remains',
      expected: 0,
      now: 1_000_000,
      remaining: '4999',
      reset: '4600'
    },
    {
      description: 'ignores it without x-ratelimit-remaining',
      expected: 0,
      now: 1_000_000,
      remaining: undefined,
      reset: '4600'
    },
    {
      description: 'floors past values at zero',
      expected: 0,
      now: 2_000_000,
      remaining: '0',
      reset: '1030'
    },
    {
      description: 'ignores a non-numeric value',
      expected: 0,
      now: 1_000_000,
      remaining: '0',
      reset: 'later'
    }
  ] as const)('$description', TEST_OPTIONS, ({ expected, now, remaining, reset }) => {
    expect.hasAssertions();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    expect(
      utilities.getRetryAfterMs(
        withHeaders({ 'x-ratelimit-remaining': remaining, 'x-ratelimit-reset': reset })
      )
    ).toBe(expected);
  });
});

describe('ECS-REQ-021: errors without rate-limit headers', () => {
  it.each([
    ['an error without a response', { status: 500 }],
    ['null', null],
    ['a string', 'boom']
  ] as const)('returns 0 for %s', TEST_OPTIONS, (_description, error) => {
    expect.hasAssertions();

    expect(utilities.getRetryAfterMs(error)).toBe(0);
  });
});
