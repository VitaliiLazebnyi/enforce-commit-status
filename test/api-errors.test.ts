/**
 * @file The classification of API errors (ECS-REQ-021): their status and whether they are retried.
 */
import { describe, expect, it } from 'vitest';
import { utilities } from '../src/utilities.ts';

const TEST_OPTIONS = { timeout: 1000 };

describe('the status of an API error', () => {
  it('extracts a numeric status from octokit-style errors', TEST_OPTIONS, () => {
    expect.hasAssertions();

    expect(utilities.getErrorStatus({ status: 502 })).toBe(502);
  });

  it.each([
    ['a non-numeric status', { status: 'nope' }],
    ['an object without status', {}],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'boom']
  ] as const)('returns undefined for %s', TEST_OPTIONS, (_description, error) => {
    expect.hasAssertions();

    expect(utilities.getErrorStatus(error)).toBeUndefined();
  });
});

describe('ECS-REQ-021: retried errors', () => {
  it.each([500, 502, 599, 429])('retries HTTP %i responses', TEST_OPTIONS, status => {
    expect.hasAssertions();

    expect(utilities.isRetryableApiError({ status })).toBe(true);
  });

  it.each([
    ['an exhausted quota', { 'x-ratelimit-remaining': '0' }],
    ['an exhausted quota (numeric header)', { 'x-ratelimit-remaining': 0 }],
    ['a retry-after header', { 'retry-after': '60' }]
  ] as const)('retries 403 responses carrying %s', TEST_OPTIONS, (_description, headers) => {
    expect.hasAssertions();

    expect(utilities.isRetryableApiError({ response: { headers }, status: 403 })).toBe(true);
  });
});

describe('ECS-REQ-021: errors that are not retried', () => {
  it.each([
    ['a plain 403', { status: 403 }],
    ['a 403 without rate-limit headers', { response: { headers: {} }, status: 403 }],
    [
      'a 403 with quota left',
      { response: { headers: { 'x-ratelimit-remaining': '10' } }, status: 403 }
    ],
    [
      'a 401 with rate-limit headers',
      { response: { headers: { 'retry-after': '60' } }, status: 401 }
    ],
    ['a 499', { status: 499 }],
    ['a 404', { status: 404 }],
    ['an Error without status', new Error('boom')],
    ['null', null]
  ] as const)('does not retry %s', TEST_OPTIONS, (_description, error: unknown) => {
    expect.hasAssertions();

    expect(utilities.isRetryableApiError(error)).toBe(false);
  });

  it.each([
    ['a null response', null],
    ['an undefined response', undefined],
    ['a response without headers', {}],
    ['null headers', { headers: null }],
    ['a non-scalar header value', { headers: { 'retry-after': { seconds: 60 } } }]
  ] as const)('tolerates %s', TEST_OPTIONS, (_description, response) => {
    expect.hasAssertions();

    expect(utilities.isRetryableApiError({ response, status: 403 })).toBe(false);
  });
});
