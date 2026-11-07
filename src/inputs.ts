/**
 * @file Reads and validates the action inputs (ECS-REQ-009..013, ECS-REQ-015).
 */
import * as core from '@actions/core';
import * as github from '@actions/github';
import { utilities } from './utilities.ts';

/**
 * The validated inputs (ECS-REQ-009..013, ECS-REQ-015).
 */
export type Inputs = {
  readonly commitSha: string;
  readonly pollIntervalMs: number;
  readonly timeoutMs: number;
  readonly timeoutRaw: string;
  readonly token: string;
  readonly workflowId: string;
};

// ECS-REQ-012: strict minimum polling frequency.
const MIN_POLL_INTERVAL_MS = 10_000;
const DEFAULT_POLL_INTERVAL = '15s';
const DEFAULT_TIMEOUT = '1h';

// Full SHA-1 (40 hex chars) or SHA-256 (64 hex chars) object id.
const COMMIT_SHA_PATTERN = /^[\da-f]{40}(?:[\da-f]{24})?$/iv;

/**
 * Reads the token input (ECS-REQ-011) and masks it in the log.
 * @returns The GitHub token the API requests authenticate with.
 * @throws {Error} When the token is empty.
 */
function readToken(): string {
  const token = core.getInput('github-token');
  if (token === '') {
    throw new Error(
      `Input 'github-token' is required; pass \${{ github.token }} or a PAT with actions:read.`
    );
  }
  core.setSecret(token);
  return token;
}

/**
 * Reads the commit SHA input (ECS-REQ-010), defaulting to the SHA of the triggering event.
 * @returns The lower-case SHA, the form the API reports (and filters `head_sha` by).
 * @throws {Error} When the value is not a full commit SHA.
 */
function readCommitSha(): string {
  const commitSha = (core.getInput('commit-sha') || github.context.sha).trim();
  if (!COMMIT_SHA_PATTERN.test(commitSha)) {
    throw new Error(
      `Input 'commit-sha' must be a full commit SHA (40 or 64 hex characters), got '${commitSha}'.`
    );
  }
  return commitSha.toLowerCase();
}

/**
 * Reads the poll interval input (ECS-REQ-012), raising values below the minimum to it.
 * @returns The poll interval in milliseconds.
 * @throws {Error} When the value is not a positive duration.
 */
function readPollInterval(): number {
  const pollIntervalRaw = core.getInput('poll-interval') || DEFAULT_POLL_INTERVAL;
  const pollIntervalMs = utilities.parseDuration(pollIntervalRaw);
  if (pollIntervalMs >= MIN_POLL_INTERVAL_MS) {
    return pollIntervalMs;
  }
  core.warning(`poll-interval '${pollIntervalRaw}' is below the 10s minimum; using 10s.`);
  return MIN_POLL_INTERVAL_MS;
}

/**
 * Reads and validates the action inputs (ECS-REQ-009..013, ECS-REQ-015).
 * @returns The validated inputs.
 * @throws {Error} When an input is missing or invalid.
 */
export function readInputs(): Inputs {
  const workflowId = core.getInput('workflow-id', { required: true });
  const token = readToken();
  const commitSha = readCommitSha();
  const pollIntervalMs = readPollInterval();
  const timeoutRaw = core.getInput('timeout') || DEFAULT_TIMEOUT;
  return {
    commitSha,
    pollIntervalMs,
    timeoutMs: utilities.parseDuration(timeoutRaw),
    timeoutRaw,
    token,
    workflowId
  };
}
