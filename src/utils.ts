import * as github from '@actions/github';
import ms from 'ms';

type Octokit = ReturnType<typeof github.getOctokit>;

// Node's setTimeout rejects delays above 2^31 - 1 ms (~24.8 days) and fires
// after 1 ms instead, so durations must never exceed this bound.
const MAX_DURATION_MS = 2147483647;

// Safety cap for annotated tags pointing at other annotated tags.
const MAX_TAG_DEPTH = 10;

/**
 * Parses a duration string (e.g. '15s', '45m', '1h') into milliseconds.
 * Throws on unparseable or non-positive input; clamps to MAX_DURATION_MS.
 */
function parseDuration(val: string): number {
  let parsed: number | undefined;
  try {
    parsed = ms(val.trim() as ms.StringValue);
  } catch {
    parsed = undefined;
  }
  if (parsed === undefined) {
    throw new Error(`Invalid duration format: ${val}`);
  }
  if (parsed <= 0) {
    throw new Error(`Duration must be positive: ${val}`);
  }
  return Math.min(parsed, MAX_DURATION_MS);
}

/**
 * Extracts the numeric HTTP status from an Octokit-style error, if present.
 */
function getErrorStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
    return error.status;
  }
  return undefined;
}

function getResponseHeaders(error: unknown): Record<string, string | number | undefined> {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = error.response;
    if (response && typeof response === 'object' && 'headers' in response) {
      const headers = response.headers;
      if (headers && typeof headers === 'object') {
        return headers as Record<string, string | number | undefined>;
      }
    }
  }
  return {};
}

/**
 * ECS-REQ-021: transient server errors (5xx), 429 rate limits, and 403
 * responses carrying rate-limit headers are retryable; everything else is not.
 */
function isRetryableApiError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === undefined) {
    return false;
  }
  if (status >= 500 || status === 429) {
    return true;
  }
  if (status === 403) {
    const headers = getResponseHeaders(error);
    return String(headers['x-ratelimit-remaining']) === '0' || headers['retry-after'] !== undefined;
  }
  return false;
}

/**
 * Delay requested by GitHub via retry-after (seconds) or x-ratelimit-reset
 * (epoch seconds), or undefined when neither header is present.
 */
function getRetryAfterMs(error: unknown): number | undefined {
  const headers = getResponseHeaders(error);
  const retryAfter = Number(headers['retry-after']);
  if (headers['retry-after'] !== undefined && !isNaN(retryAfter)) {
    return retryAfter * 1000;
  }
  const reset = Number(headers['x-ratelimit-reset']);
  if (headers['x-ratelimit-reset'] !== undefined && !isNaN(reset)) {
    return Math.max(reset * 1000 - Date.now(), 0);
  }
  return undefined;
}

/**
 * Resolves a potential annotated tag to its underlying commit SHA
 * (ECS-REQ-020), peeling nested tag objects (tag -> tag -> commit).
 */
async function resolveCommitSha(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string
): Promise<string> {
  let current = sha;
  for (let depth = 0; depth < MAX_TAG_DEPTH; depth++) {
    let object: { sha: string; type: string };
    try {
      const response = await octokit.rest.git.getTag({
        owner,
        repo,
        tag_sha: current
      });
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
    if (object.type === 'tag') {
      current = object.sha;
      continue;
    }
    throw new Error(
      `Annotated tag ${sha} does not resolve to a commit (points to a '${object.type}' object).`
    );
  }
  throw new Error(`Annotated tag ${sha} exceeds the maximum nesting depth of ${MAX_TAG_DEPTH}.`);
}

/**
 * Halts execution for a specified duration (clamped to a safe setTimeout range).
 */
async function sleep(milliseconds: number): Promise<void> {
  const delay = Math.min(Math.max(milliseconds, 0), MAX_DURATION_MS);
  return new Promise(resolve => setTimeout(resolve, delay));
}

export const utils = {
  parseDuration,
  getErrorStatus,
  isRetryableApiError,
  getRetryAfterMs,
  resolveCommitSha,
  sleep
};
