import * as github from '@actions/github';
import ms from 'ms';

type Octokit = ReturnType<typeof github.getOctokit>;

/**
 * Parses a duration string into milliseconds.
 * Enforces a minimum interval of 10s (10000ms).
 */
function parseDuration(val: string): number {
  const parsed = ms(val as ms.StringValue);
  if (parsed === undefined || isNaN(parsed)) {
    throw new Error(`Invalid duration format: ${val}`);
  }
  return Math.max(parsed, 10000); // ECS-REQ-012: Minimum 10s
}

/**
 * Resolves a potential annotated tag to its underlying commit SHA.
 */
async function resolveCommitSha(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string
): Promise<string> {
  try {
    const response = await octokit.rest.git.getTag({
      owner,
      repo,
      tag_sha: sha
    });
    // ECS-REQ-020: Extract underlying object sha
    return response.data.object.sha;
  } catch (error: unknown) {
    // If 404, it's not a tag object (likely a direct commit SHA), proceed with original SHA
    const isApiError = error && typeof error === 'object' && 'status' in error;
    if (isApiError && (error as { status: number }).status === 404) {
      return sha;
    }
    throw error;
  }
}

/**
 * Halts execution for a specified duration.
 */
async function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export const utils = {
  parseDuration,
  resolveCommitSha,
  sleep
};
