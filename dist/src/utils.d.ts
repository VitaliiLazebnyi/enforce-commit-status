import * as github from '@actions/github';
type Octokit = ReturnType<typeof github.getOctokit>;
/**
 * Parses a duration string into milliseconds.
 * Enforces a minimum interval of 10s (10000ms).
 */
declare function parseDuration(val: string): number;
/**
 * Resolves a potential annotated tag to its underlying commit SHA.
 */
declare function resolveCommitSha(octokit: Octokit, owner: string, repo: string, sha: string): Promise<string>;
/**
 * Halts execution for a specified duration.
 */
declare function sleep(milliseconds: number): Promise<void>;
export declare const utils: {
    parseDuration: typeof parseDuration;
    resolveCommitSha: typeof resolveCommitSha;
    sleep: typeof sleep;
};
export {};
