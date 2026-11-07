/**
 * @file The building blocks of the polling loop: duration parsing, API error classification and
 * retry delays, annotated-tag resolution and the bounded sleep.
 */
import ms from 'ms';

/**
 * The object an annotated tag points to.
 */
type TagTarget = {
  readonly sha: string;
  readonly type: string;
};

/**
 * The parameters of the Git Database API's "get a tag" request.
 */
type GetTagParameters = {
  readonly owner: string;
  readonly repo: string;
  readonly tag_sha: string;
};

/**
 * The part of the Octokit client that annotated-tag resolution uses.
 */
export type TagClient = {
  readonly rest: {
    readonly git: {
      readonly getTag: (
        parameters: GetTagParameters
      ) => Promise<{ readonly data: { readonly object: TagTarget } }>;
    };
  };
};

/**
 * The repository and the commit (or annotated tag) object to resolve.
 */
type TagReference = {
  readonly owner: string;
  readonly repository: string;
  readonly sha: string;
};

/**
 * Response headers the action reads from a failed API request.
 */
type RateLimitHeader = 'retry-after' | 'x-ratelimit-remaining' | 'x-ratelimit-reset';

/*
 * Node's setTimeout rejects delays above 2^31 - 1 ms (~24.8 days) and fires after 1 ms instead,
 * so durations must never exceed this bound.
 */
const MAX_DURATION_MS = 2_147_483_647;

// Safety cap for annotated tags pointing at other annotated tags.
const MAX_TAG_DEPTH = 10;
const ONE_LEVEL = 1;

/*
 * The grammar `ms` parses (ms@2.1.3, `parse()`, there written `-?(?:\d+)?\.?\d+`, which is the
 * same language without the backtracking): an optionally negative decimal number, optional spaces
 * and an optional unit. `ms` returns undefined for any other string and for strings longer than
 * 100 characters, which its type definitions do not express; validating the input first makes the
 * call well-typed and keeps the error message uniform.
 */
const DURATION_UNITS = [
  '[dhmswy]',
  'days?',
  'hours?',
  'hrs?',
  'milliseconds?',
  'mins?',
  'minutes?',
  'ms',
  'msecs?',
  'secs?',
  'seconds?',
  'weeks?',
  'years?',
  'yrs?'
];
const DURATION_PATTERN = new RegExp(
  String.raw`^-?(?:\d+(?:\.\d+)?|\.\d+) *(?:${DURATION_UNITS.join('|')})?$`,
  'iv'
);
const MAX_DURATION_LENGTH = 100;

const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
const MS_PER_SECOND = 1000;
const NO_DELAY_MS = 0;
// The value of `x-ratelimit-remaining` once the quota is used up.
const QUOTA_EXHAUSTED = '0';

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
  if (parsed <= NO_DELAY_MS) {
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
    status === HTTP_TOO_MANY_REQUESTS ||
    (status !== undefined && status >= HTTP_SERVER_ERROR) ||
    (status === HTTP_FORBIDDEN &&
      (getHeader(error, 'x-ratelimit-remaining') === QUOTA_EXHAUSTED ||
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
    return retryAfter * MS_PER_SECOND;
  }
  const reset =
    getHeader(error, 'x-ratelimit-remaining') === QUOTA_EXHAUSTED
      ? parseNumber(getHeader(error, 'x-ratelimit-reset'))
      : undefined;
  return reset === undefined
    ? NO_DELAY_MS
    : Math.max(reset * MS_PER_SECOND - Date.now(), NO_DELAY_MS);
}

/**
 * Fetches the object an annotated tag points to.
 * @param octokit - The authenticated client (only `rest.git.getTag` is used).
 * @param reference - The repository and the SHA of the object to look up.
 * @returns The tag's target, or undefined when the SHA is not a tag object (HTTP 404: a commit).
 * @rejects {Error} The API error of any other failed request.
 */
async function getTagTarget(
  octokit: TagClient,
  reference: TagReference
): Promise<TagTarget | undefined> {
  try {
    const { data } = await octokit.rest.git.getTag({
      owner: reference.owner,
      repo: reference.repository,
      tag_sha: reference.sha
    });
    return data.object;
  } catch (error: unknown) {
    if (getErrorStatus(error) === HTTP_NOT_FOUND) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Resolves a potential annotated tag to its underlying commit SHA
 * (ECS-REQ-020), peeling nested tag objects (tag -> tag -> commit).
 * @param octokit - The authenticated client (only `rest.git.getTag` is used).
 * @param reference - The repository and the commit or annotated tag object SHA.
 * @returns The SHA of the commit the reference resolves to.
 * @rejects {Error} When the tag does not resolve to a commit within MAX_TAG_DEPTH levels.
 */
async function resolveCommitSha(octokit: TagClient, reference: TagReference): Promise<string> {
  const { sha } = reference;
  let current = sha;
  for (let depth = 0; depth < MAX_TAG_DEPTH; depth += ONE_LEVEL) {
    // Each level names the object of the next one.
    const target = await getTagTarget(octokit, { ...reference, sha: current });
    if (target === undefined || target.type === 'commit') {
      return target?.sha ?? current;
    }
    if (target.type !== 'tag') {
      throw new Error(
        `Annotated tag ${sha} does not resolve to a commit (points to a '${target.type}' object).`
      );
    }
    current = target.sha;
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
  const delay = Math.min(Math.max(milliseconds, NO_DELAY_MS), MAX_DURATION_MS);
  // The promise settles with the delay it waited for.
  const { promise, resolve } = Promise.withResolvers<number>();
  setTimeout(() => {
    resolve(delay);
  }, delay);
  await promise;
}

export const utilities = {
  getErrorStatus,
  getRetryAfterMs,
  isRetryableApiError,
  parseDuration,
  resolveCommitSha,
  sleep
};
