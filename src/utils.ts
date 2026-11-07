import ms from 'ms';

/** The part of the Octokit client that annotated-tag resolution uses. */
interface TagClient {
  rest: {
    git: {
      getTag: (parameters: {
        owner: string;
        repo: string;
        tag_sha: string;
      }) => Promise<{ data: { object: { sha: string; type: string } } }>;
    };
  };
}

/** Response headers the action reads from a failed API request. */
type RateLimitHeader = 'retry-after' | 'x-ratelimit-remaining' | 'x-ratelimit-reset';

// Node's setTimeout rejects delays above 2^31 - 1 ms (~24.8 days) and fires
// after 1 ms instead, so durations must never exceed this bound.
const MAX_DURATION_MS = 2_147_483_647;

// Safety cap for annotated tags pointing at other annotated tags.
const MAX_TAG_DEPTH = 10;

// The grammar `ms` parses (ms@2.1.3, `parse()`, there written `-?(?:\d+)?\.?\d+`, which is the same
// language without the backtracking): an optionally negative decimal number, optional
// spaces and an optional unit. `ms` returns undefined for any other string and for strings longer
// than 100 characters, which its type definitions do not express; validating the input first makes
// the call well-typed and keeps the error message uniform.
const DURATION_PATTERN =
  /^-?(?:\d+(?:\.\d+)?|\.\d+) *(?:milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i;
const MAX_DURATION_LENGTH = 100;

/**
 * Checks that a string is a duration `ms` can parse.
 * @param value - The trimmed duration string.
 * @returns Whether `ms(value)` returns a number.
 */
function isDuration(value: string): value is ms.StringValue {
  return value.length <= MAX_DURATION_LENGTH && DURATION_PATTERN.test(value);
}

/**
 * Parses a duration string (e.g. '15s', '45m', '1h') into milliseconds.
 * @param value - The duration input; surrounding whitespace is ignored.
 * @returns The duration in milliseconds, capped at MAX_DURATION_MS.
 * @throws {Error} When the value is not a duration or is not positive.
 */
function parseDuration(value: string): number {
  const trimmed = value.trim();
  if (!isDuration(trimmed)) {
    throw new Error(`Invalid duration format: ${value}`);
  }
  const parsed = ms(trimmed);
  if (parsed <= 0) {
    throw new Error(`Duration must be positive: ${value}`);
  }
  return Math.min(parsed, MAX_DURATION_MS);
}

/**
 * Narrows an unknown value to an object whose properties can be read (as unknown).
 * @param value - Any value.
 * @returns Whether the value is a non-null object.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/**
 * Extracts the numeric HTTP status from an Octokit-style error.
 * @param error - The caught error.
 * @returns The HTTP status, or undefined when the error carries none.
 */
function getErrorStatus(error: unknown): number | undefined {
  const status = isRecord(error) ? error['status'] : undefined;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Reads one response header of an Octokit-style error.
 * @param error - The caught error.
 * @param name - The (lower-case) header name.
 * @returns The header value as a string, or undefined when it is absent.
 */
function getHeader(error: unknown, name: RateLimitHeader): string | undefined {
  const response = isRecord(error) ? error['response'] : undefined;
  const headers = isRecord(response) ? response['headers'] : undefined;
  const value = isRecord(headers) ? headers[name] : undefined;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

/**
 * Parses a numeric header value.
 * @param value - The header value.
 * @returns The number, or undefined when the header is absent or not numeric.
 */
function parseNumber(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * ECS-REQ-021: transient server errors (5xx), 429 rate limits, and 403
 * responses carrying rate-limit headers are retryable; everything else is not.
 * @param error - The caught error.
 * @returns Whether the request should be retried on the next interval.
 */
function isRetryableApiError(error: unknown): boolean {
  const status = getErrorStatus(error);
  return (
    status === 429 ||
    (status !== undefined && status >= 500) ||
    (status === 403 &&
      (getHeader(error, 'x-ratelimit-remaining') === '0' ||
        getHeader(error, 'retry-after') !== undefined))
  );
}

/**
 * Delay requested by GitHub before the next request: `retry-after` (seconds) or, once the rate
 * limit is exhausted (`x-ratelimit-remaining: 0`), the time until `x-ratelimit-reset` (epoch
 * seconds). GitHub sends `x-ratelimit-reset` on every response, so it only applies when the quota
 * is actually used up.
 * @param error - The caught error.
 * @returns The delay in milliseconds, 0 when GitHub requested none.
 */
function getRetryAfterMs(error: unknown): number {
  const retryAfter = parseNumber(getHeader(error, 'retry-after'));
  if (retryAfter !== undefined) {
    return retryAfter * 1000;
  }
  const reset =
    getHeader(error, 'x-ratelimit-remaining') === '0'
      ? parseNumber(getHeader(error, 'x-ratelimit-reset'))
      : undefined;
  return reset === undefined ? 0 : Math.max(reset * 1000 - Date.now(), 0);
}

/**
 * Resolves a potential annotated tag to its underlying commit SHA
 * (ECS-REQ-020), peeling nested tag objects (tag -> tag -> commit).
 * @param octokit - The authenticated client (only `rest.git.getTag` is used).
 * @param owner - The repository owner.
 * @param repo - The repository name.
 * @param sha - A commit or annotated tag object SHA.
 * @returns The commit SHA.
 * @throws {Error} When the tag does not resolve to a commit within MAX_TAG_DEPTH levels.
 */
async function resolveCommitSha(
  octokit: TagClient,
  owner: string,
  repo: string,
  sha: string
): Promise<string> {
  let current = sha;
  for (let depth = 0; depth < MAX_TAG_DEPTH; depth++) {
    let object: { sha: string; type: string };
    try {
      const response = await octokit.rest.git.getTag({ owner, repo, tag_sha: current });
      object = response.data.object;
    } catch (error: unknown) {
      // 404 means the SHA is not a tag object (a direct commit SHA).
      if (getErrorStatus(error) === 404) {
        return current;
      }
      throw error;
    }
    if (object.type === 'commit') {
      return object.sha;
    }
    if (object.type !== 'tag') {
      throw new Error(
        `Annotated tag ${sha} does not resolve to a commit (points to a '${object.type}' object).`
      );
    }
    current = object.sha;
  }
  throw new Error(
    `Annotated tag ${sha} exceeds the maximum nesting depth of ${String(MAX_TAG_DEPTH)}.`
  );
}

/**
 * Halts execution for a specified duration (clamped to a safe setTimeout range).
 * @param milliseconds - The requested delay.
 * @returns A promise that resolves after the delay.
 */
async function sleep(milliseconds: number): Promise<void> {
  const delay = Math.min(Math.max(milliseconds, 0), MAX_DURATION_MS);
  await new Promise<void>(resolve => {
    setTimeout(resolve, delay);
  });
}

export const utils = {
  parseDuration,
  getErrorStatus,
  isRetryableApiError,
  getRetryAfterMs,
  resolveCommitSha,
  sleep
};
