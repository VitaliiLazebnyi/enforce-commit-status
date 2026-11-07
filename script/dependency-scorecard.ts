/**
 * @file Fails when a package of package-lock.json comes from a repository whose OpenSSF Scorecard
 * is below the threshold of script/scorecard.json, unless that file allows the package with a
 * reason, or when an allowance no longer applies (the package is gone or now meets the threshold).
 *
 * This is the per-package form of Dependency review's Scorecard check (that action can only warn
 * on every package below one global threshold), applied to the whole dependency tree instead of
 * only to the packages a pull request changes.
 *
 * Usage: node script/dependency-scorecard.ts.
 */
import { entriesOf, fetchJson, isRecord, readJson, recordProperty } from './lib/json.ts';

/**
 * The repository of a package and its score.
 */
type Result = {
  readonly name: string;
  readonly repository: string | undefined;
  readonly score: number | undefined;
};

/**
 * A package of the lock file.
 */
type LockedPackage = { readonly name: string; readonly version: string };

// Registry and Scorecard requests in flight at a time.
const CONCURRENCY = 16;
const NODE_MODULES = 'node_modules/';
const FIRST = 0;
const FAILURE = 1;
const GITHUB_SHORTHAND = /^(?:github:)?(?<owner>[\w\-.]+)\/(?<name>[\w\-.]+)$/v;
const GITHUB_URL =
  /github\.com[\/:](?<owner>[\w\-.]+)\/(?<name>[\w\-.]+?)(?:\.git)?(?:[#\/?].*)?$/iv;

/**
 * Normalizes the `repository` field of a package manifest to `owner/name` on github.com.
 * @param repository - The field: a string or an object with a `url`.
 * @returns The GitHub repository, or undefined when the package is not hosted on GitHub.
 */
function githubRepository(repository: unknown): string | undefined {
  const url = isRecord(repository) ? repository['url'] : repository;
  if (typeof url !== 'string') {
    return undefined;
  }
  const text = url.trim();
  const groups = (GITHUB_SHORTHAND.exec(text) ?? GITHUB_URL.exec(text))?.groups;
  return groups === undefined
    ? undefined
    : `${groups['owner'] ?? ''}/${groups['name'] ?? ''}`.toLowerCase();
}

/**
 * Looks up the repository and its OpenSSF Scorecard for one package.
 * @param locked - The package name and its locked version.
 * @returns The result; score is undefined when Scorecard has not scored the repository.
 */
async function scorePackage(locked: LockedPackage): Promise<Result> {
  const { name, version } = locked;
  const manifest = await fetchJson(`https://registry.npmjs.org/${name}/${version}`);
  const repository = githubRepository(isRecord(manifest) ? manifest['repository'] : undefined);
  if (repository === undefined) {
    return { name, repository, score: undefined };
  }
  const scorecard = await fetchJson(`https://api.scorecard.dev/projects/github.com/${repository}`);
  const score = isRecord(scorecard) ? scorecard['score'] : undefined;
  return { name, repository, score: typeof score === 'number' ? score : undefined };
}

/**
 * Scores the packages, CONCURRENCY at a time.
 * @param packages - The packages still to score.
 * @returns The result of every package.
 */
async function scoreAll(packages: readonly LockedPackage[]): Promise<readonly Result[]> {
  const batch = packages.slice(FIRST, CONCURRENCY);
  if (batch.length < CONCURRENCY) {
    return Promise.all(batch.map(async locked => scorePackage(locked)));
  }
  const [scored, rest] = await Promise.all([
    Promise.all(batch.map(async locked => scorePackage(locked))),
    Promise.resolve(packages.slice(CONCURRENCY))
  ]);
  return [...scored, ...(await scoreAll(rest))];
}

/**
 * Reads the threshold and the allowances of script/scorecard.json.
 * @returns The threshold and the reason of every allowance, by package name.
 * @rejects {TypeError} When the threshold is missing or an allowance has no reason.
 */
async function readConfig(): Promise<{
  readonly allowances: ReadonlyMap<string, string>;
  readonly threshold: number;
}> {
  const config = await readJson('script/scorecard.json');
  const threshold = isRecord(config) ? config['threshold'] : undefined;
  if (typeof threshold !== 'number') {
    throw new TypeError('script/scorecard.json: threshold must be a number');
  }
  const allowances = entriesOf(recordProperty(config, 'allowances'));
  for (const [name, reason] of allowances) {
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new TypeError(`script/scorecard.json: allowance ${name} needs a reason`);
    }
  }
  return {
    allowances: new Map(allowances.map(([name, reason]) => [name, String(reason)])),
    threshold
  };
}

/**
 * Lists every package of the lock file, once per name: the repository, and so the score, does not
 * depend on which of several locked versions is looked up.
 * @returns The name and the locked version of every package.
 */
async function lockedPackages(): Promise<readonly LockedPackage[]> {
  const lock = await readJson('package-lock.json');
  const entries = entriesOf(recordProperty(lock, 'packages'));
  const packages = new Map(
    entries.flatMap(([location, entry]): [string, LockedPackage][] => {
      const version = isRecord(entry) ? entry['version'] : undefined;
      const name = location.slice(location.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);
      return location === '' || typeof version !== 'string' ? [] : [[name, { name, version }]];
    })
  );
  return packages.values().toArray();
}

const { allowances, threshold } = await readConfig();
const packages = await lockedPackages();
const scored = await scoreAll(packages);
const results = scored.toSorted((first, second) => first.name.localeCompare(second.name));
const problems: string[] = [];
for (const { name, repository = '?', score } of results) {
  const isBelow = score !== undefined && score < threshold;
  const isAllowed = allowances.has(name);
  const scoreText = score === undefined ? 'nothing' : String(score);
  if (isBelow && isAllowed) {
    process.stdout.write(`allowed: ${name} (github.com/${repository}) scores ${scoreText}\n`);
  } else if (isBelow) {
    problems.push(
      `BELOW THE THRESHOLD: ${name} (github.com/${repository}) scores ${scoreText} ` +
        `< ${String(threshold)}`
    );
  } else if (isAllowed) {
    problems.push(`STALE ALLOWANCE: ${name} scores ${scoreText}, which needs no allowance`);
  }
}
const names = new Set(packages.map(({ name }) => name));
for (const name of allowances.keys()) {
  if (!names.has(name)) {
    problems.push(`STALE ALLOWANCE: ${name} is no longer a dependency`);
  }
}
for (const problem of problems) {
  process.stderr.write(`${problem}\n`);
}
process.stdout.write(
  `${String(results.length)} packages checked against an OpenSSF Scorecard threshold of ` +
    `${String(threshold)}.\n`
);
const [firstProblem] = problems;
if (firstProblem !== undefined) {
  process.exitCode = FAILURE;
}
