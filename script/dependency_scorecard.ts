// Fails when a package of package-lock.json comes from a repository whose OpenSSF Scorecard is below
// the threshold of script/scorecard.json, unless that file allows the package with a reason, or when
// an allowance no longer applies (the package is gone or now meets the threshold).
//
// This is the per-package form of Dependency review's Scorecard check (that action can only warn on
// every package below one global threshold), applied to the whole dependency tree instead of only
// to the packages a pull request changes.
//
// Usage: node script/dependency_scorecard.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';

interface Result {
  name: string;
  repository: string | undefined;
  score: number | undefined;
}

const root = path.resolve(import.meta.dirname, '..');

/**
 * Narrows an unknown value to an object whose properties can be read (as unknown).
 * @param value - Any value.
 * @returns Whether the value is a non-null object.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/**
 * Reads a JSON file of the repository.
 * @param file - The path relative to the repository root.
 * @returns The parsed value.
 */
function readJson(file: string): unknown {
  const value: unknown = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
  return value;
}

/**
 * Fetches a JSON document.
 * @param url - The URL.
 * @returns The parsed body, or undefined for a 404.
 * @throws {Error} For any other unsuccessful response.
 */
async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new Error(`GET ${url}: HTTP ${String(response.status)}`);
  }
  const value: unknown = await response.json();
  return value;
}

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
  const match =
    /^(?:github:)?([\w.-]+)\/([\w.-]+)$/.exec(text) ??
    /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[#/?].*)?$/i.exec(text);
  if (match === null) {
    return undefined;
  }
  const [, owner = '', name = ''] = match;
  return `${owner}/${name}`.toLowerCase();
}

/**
 * Looks up the repository and its OpenSSF Scorecard for one package.
 * @param name - The package name.
 * @param version - The locked version.
 * @returns The result; score is undefined when Scorecard has not scored the repository.
 */
async function scorePackage(name: string, version: string): Promise<Result> {
  const manifest = await fetchJson(`https://registry.npmjs.org/${name}/${version}`);
  const repository = githubRepository(isRecord(manifest) ? manifest['repository'] : undefined);
  if (repository === undefined) {
    return { name, repository, score: undefined };
  }
  const scorecard = await fetchJson(`https://api.scorecard.dev/projects/github.com/${repository}`);
  const score = isRecord(scorecard) ? scorecard['score'] : undefined;
  return { name, repository, score: typeof score === 'number' ? score : undefined };
}

const config = readJson('script/scorecard.json');
const threshold = isRecord(config) ? config['threshold'] : undefined;
if (typeof threshold !== 'number') {
  throw new TypeError('script/scorecard.json: threshold must be a number');
}
const allowanceEntries =
  isRecord(config) && isRecord(config['allowances']) ? config['allowances'] : {};
const allowances = new Map<string, string>();
for (const [name, reason] of Object.entries(allowanceEntries)) {
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw new TypeError(`script/scorecard.json: allowance ${name} needs a reason`);
  }
  allowances.set(name, reason);
}

// Every package of the lock file, once per name: the repository, and so the score, does not depend
// on which of several locked versions is looked up.
const lock = readJson('package-lock.json');
const lockedPackages = isRecord(lock) && isRecord(lock['packages']) ? lock['packages'] : {};
const versions = new Map<string, string>();
for (const [location, entry] of Object.entries(lockedPackages)) {
  const version = isRecord(entry) ? entry['version'] : undefined;
  if (location !== '' && typeof version === 'string') {
    versions.set(
      location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length),
      version
    );
  }
}

// Registry and Scorecard requests in flight at a time.
const CONCURRENCY = 16;
const queue = [...versions];
const results: Result[] = [];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      results.push(await scorePackage(...next));
    }
  })
);

const problems: string[] = [];
for (const { name, repository = '?', score } of results.toSorted((a, b) =>
  a.name.localeCompare(b.name)
)) {
  const below = score !== undefined && score < threshold;
  const allowed = allowances.has(name);
  if (below && allowed) {
    process.stdout.write(`allowed: ${name} (github.com/${repository}) scores ${String(score)}\n`);
  } else if (below) {
    problems.push(
      `BELOW THE THRESHOLD: ${name} (github.com/${repository}) scores ${String(score)} < ${String(threshold)}`
    );
  } else if (allowed) {
    problems.push(
      `STALE ALLOWANCE: ${name} scores ${score === undefined ? 'nothing' : String(score)}, which needs no allowance`
    );
  }
}
for (const name of allowances.keys()) {
  if (!versions.has(name)) {
    problems.push(`STALE ALLOWANCE: ${name} is no longer a dependency`);
  }
}
for (const problem of problems) {
  process.stderr.write(`${problem}\n`);
}
process.stdout.write(
  `${String(results.length)} packages checked against an OpenSSF Scorecard threshold of ${String(threshold)}.\n`
);
process.exitCode = problems.length === 0 ? 0 : 1;
