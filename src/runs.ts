/**
 * @file The workflow runs the action reads, and the selection of the most recent one
 * (ECS-REQ-018).
 */

/**
 * The fields of a workflow run the action reads.
 */
export type WorkflowRun = {
  readonly conclusion: string | null;
  readonly created_at: string;
  readonly html_url: string;
  readonly id: number;
  readonly status: string | null;
};

// The time of a run whose creation time cannot be parsed: older than any other run.
const UNKNOWN_TIME_MS = 0;

/**
 * The creation time of a run.
 * @param run - A workflow run.
 * @returns Its creation time in epoch milliseconds, UNKNOWN_TIME_MS when it cannot be parsed.
 */
function createdAt(run: WorkflowRun): number {
  const time = Date.parse(run.created_at);
  return Number.isNaN(time) ? UNKNOWN_TIME_MS : time;
}

/**
 * Orders runs from the most recent to the oldest: by creation time, then by id.
 * @param first - One run.
 * @param second - The other run.
 * @returns A negative number when the first run is more recent, a positive one when it is older.
 */
function byRecency(first: WorkflowRun, second: WorkflowRun): number {
  return createdAt(second) - createdAt(first) || second.id - first.id;
}

/**
 * ECS-REQ-018: the list endpoint returns one entry per run, each already
 * reflecting only its latest attempt, so the most recent run is selected
 * (by created_at, tie-broken by id) rather than sorting by run_attempt.
 * @param runs - The runs of the workflow for the commit.
 * @returns The most recent run, or undefined when there is none.
 */
export function selectMostRecentRun(runs: readonly WorkflowRun[]): WorkflowRun | undefined {
  const [mostRecent] = runs.toSorted(byRecency);
  return mostRecent;
}
