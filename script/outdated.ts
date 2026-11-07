// Fails when a dependency is not at its newest release and is not on the documented hold list of
// script/outdated.json, or when a listed hold no longer matches the upstream releases it documents.
//
// Checked: the Node.js runtime (.node-version and the Node.js versions pinned in the workflows), npm
// (`packageManager`), every direct npm dependency, every `overrides` entry, every GitHub Action
// (pinned to the commit of its newest release tag) and every tool version pinned in the workflows.
//
// Usage: node script/outdated.ts
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

interface Hold {
  allowedMajor: number;
  newestMajor: number;
  reason: string;
}

interface Version {
  major: number;
  minor: number;
  patch: number;
  text: string;
}

const root = path.resolve(import.meta.dirname, '..');
const problems: string[] = [];
const usedHolds = new Set<string>();

/**
 * Narrows an unknown value to an object whose properties can be read (as unknown).
 * @param value - Any value.
 * @returns Whether the value is a non-null object.
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/**
 * Reads a string property, failing loudly on unexpected input.
 * @param record - The object.
 * @param key - The property name.
 * @param context - Where the object came from, for the error message.
 * @returns The string value.
 */
function stringProperty(record: unknown, key: string, context: string): string {
  const value = isRecord(record) ? record[key] : undefined;
  if (typeof value !== 'string') {
    throw new TypeError(`${context}: expected a string "${key}"`);
  }
  return value;
}

/**
 * Parses a stable `X.Y.Z` version (an optional leading `v` is ignored).
 * @param text - The version string.
 * @returns The version, or undefined for pre-releases and other strings.
 */
function parseVersion(text: string): Version | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (match === null) {
    return undefined;
  }
  const [, major = '', minor = '', patch = ''] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    text: text.replace(/^v/, '')
  };
}

/**
 * Orders two versions.
 * @param a - The first version.
 * @param b - The second version.
 * @returns A negative number, zero or a positive number when a is older, equal or newer.
 */
function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * Selects the newest stable version.
 * @param texts - Version strings; pre-releases and non-versions are ignored.
 * @param major - When given, only versions of this major line are considered.
 * @returns The newest version.
 */
function newest(texts: readonly string[], major?: number): Version {
  const versions = texts
    .map(text => parseVersion(text))
    .filter((version): version is Version => version !== undefined)
    .filter(version => major === undefined || version.major === major)
    .toSorted(compareVersions);
  const last = versions.at(-1);
  if (last === undefined) {
    throw new Error(
      `No stable release found${major === undefined ? '' : ` for major ${String(major)}`}`
    );
  }
  return last;
}

/**
 * Runs a command and returns its standard output.
 * @param command - The executable.
 * @param arguments_ - Its arguments.
 * @returns The standard output.
 */
function run(command: string, arguments_: readonly string[]): string {
  return execFileSync(command, arguments_, { cwd: root, encoding: 'utf8' });
}

/**
 * Parses JSON into an unknown value.
 * @param text - The JSON text.
 * @returns The parsed value.
 */
function parseJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  return value;
}

/**
 * Reads a JSON file of the repository.
 * @param file - The path relative to the repository root.
 * @returns The parsed value.
 */
function readJson(file: string): unknown {
  return parseJson(readFileSync(path.join(root, file), 'utf8'));
}

/**
 * Lists the published versions of an npm package.
 * @param name - The package name.
 * @returns Every published version.
 */
function npmVersions(name: string): string[] {
  const versions = parseJson(run('npm', ['view', name, 'versions', '--json']));
  return Array.isArray(versions) ? versions.filter(value => typeof value === 'string') : [];
}

/**
 * Lists the stable release tags of a GitHub repository with the commit each one points to.
 * @param repository - The `owner/name` of the repository.
 * @returns The commit SHA of every release tag, keyed by the tag name.
 */
function releaseTags(repository: string): Map<string, string> {
  const output = run('git', ['ls-remote', '--tags', `https://github.com/${repository}`]);
  const tags = new Map<string, string>();
  for (const line of output.split('\n')) {
    const [sha = '', reference = ''] = line.split('\t', 2);
    const name = reference.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '');
    // An annotated tag is listed twice; the peeled (`^{}`) line names the commit.
    if (parseVersion(name) !== undefined && (reference.endsWith('^{}') || !tags.has(name))) {
      tags.set(name, sha);
    }
  }
  return tags;
}

/**
 * Checks a dependency against its newest release and the hold list.
 * @param name - The dependency name (the key in the hold list).
 * @param current - The version in use.
 * @param available - Every released version.
 * @param holds - The documented holds.
 */
function checkVersion(
  name: string,
  current: Version,
  available: readonly string[],
  holds: ReadonlyMap<string, Hold>
): void {
  const latest = newest(available);
  const hold = holds.get(name);
  if (hold !== undefined) {
    usedHolds.add(name);
    if (hold.allowedMajor !== current.major || hold.newestMajor !== latest.major) {
      problems.push(
        `STALE HOLD: ${name} is held at major ${String(hold.allowedMajor)} while major ` +
          `${String(hold.newestMajor)} is the newest, but ${current.text} is in use and ${latest.text} is the newest release`
      );
      return;
    }
    const newestAllowed = newest(available, hold.allowedMajor);
    process.stdout.write(`on hold: ${name} ${current.text} (newest ${latest.text})\n`);
    if (compareVersions(current, newestAllowed) !== 0) {
      problems.push(`OUTDATED WITHIN THE HOLD: ${name} ${current.text} -> ${newestAllowed.text}`);
    }
    return;
  }
  if (compareVersions(current, latest) !== 0) {
    problems.push(`NOT ON THE HOLD LIST: ${name} ${current.text} -> ${latest.text}`);
  }
}

/**
 * Parses a version that must be stable.
 * @param text - The version string.
 * @param context - Where the version came from, for the error message.
 * @returns The version.
 */
function requireVersion(text: string, context: string): Version {
  const version = parseVersion(text);
  if (version === undefined) {
    throw new Error(`${context}: '${text}' is not an exact X.Y.Z version`);
  }
  return version;
}

const config = readJson('script/outdated.json');
const holdEntries = isRecord(config) && isRecord(config['holds']) ? config['holds'] : {};
const holds = new Map<string, Hold>();
for (const [name, value] of Object.entries(holdEntries)) {
  const allowedMajor = isRecord(value) ? value['allowedMajor'] : undefined;
  const newestMajor = isRecord(value) ? value['newestMajor'] : undefined;
  const reason = stringProperty(value, 'reason', `hold ${name}`);
  if (typeof allowedMajor !== 'number' || typeof newestMajor !== 'number') {
    throw new TypeError(`hold ${name}: allowedMajor and newestMajor must be numbers`);
  }
  holds.set(name, { allowedMajor, newestMajor, reason });
}
const toolEntries = isRecord(config) && isRecord(config['tools']) ? config['tools'] : {};

// The workflows and the local composite actions they use.
const githubDirectory = path.join(root, '.github');
const workflows = [
  ...readdirSync(path.join(githubDirectory, 'workflows')).map(file => path.join('workflows', file)),
  ...readdirSync(path.join(githubDirectory, 'actions')).map(action =>
    path.join('actions', action, 'action.yml')
  )
]
  .filter(file => file.endsWith('.yml'))
  .map(file => ({ file, text: readFileSync(path.join(githubDirectory, file), 'utf8') }));

// Node.js: .node-version and every exact version pinned in the workflows.
const nodeIndex = parseJson(await (await fetch('https://nodejs.org/dist/index.json')).text());
const nodeReleases = Array.isArray(nodeIndex)
  ? nodeIndex.map(release => stringProperty(release, 'version', 'nodejs.org/dist/index.json'))
  : [];
const nodeVersion = requireVersion(
  readFileSync(path.join(root, '.node-version'), 'utf8').trim(),
  '.node-version'
);
checkVersion('node', nodeVersion, nodeReleases, holds);
for (const { file, text } of workflows) {
  for (const match of text.matchAll(/node-version: '([^']+)'/g)) {
    const pinned = requireVersion(match[1] ?? '', `${file} node-version`);
    const expected = newest(nodeReleases, pinned.major);
    if (compareVersions(pinned, expected) !== 0) {
      problems.push(
        `OUTDATED: ${file} pins Node.js ${pinned.text}, newest of its line is ${expected.text}`
      );
    }
    if (pinned.major !== nodeVersion.major && pinned.major !== newest(nodeReleases).major) {
      problems.push(
        `OUTDATED: ${file} tests on Node.js ${pinned.text}, neither the runtime nor the newest line`
      );
    }
  }
}

// npm itself, the direct dependencies and the overrides.
const manifest = readJson('package.json');
const packageManager = stringProperty(manifest, 'packageManager', 'package.json');
checkVersion(
  'npm',
  requireVersion(packageManager.replace(/^npm@/, ''), 'packageManager'),
  npmVersions('npm'),
  holds
);
const lock = readJson('package-lock.json');
const lockedPackages = isRecord(lock) && isRecord(lock['packages']) ? lock['packages'] : {};
const sections = ['dependencies', 'devDependencies', 'overrides'];
for (const section of sections) {
  const entries = isRecord(manifest) && isRecord(manifest[section]) ? manifest[section] : {};
  for (const name of Object.keys(entries)) {
    const installed = stringProperty(
      lockedPackages[`node_modules/${name}`],
      'version',
      `package-lock.json node_modules/${name}`
    );
    checkVersion(
      name,
      requireVersion(installed, `${name} in package-lock.json`),
      npmVersions(name),
      holds
    );
  }
}

// GitHub Actions: pinned to the full commit SHA of their newest release, with the tag in a comment.
const tagCache = new Map<string, Map<string, string>>();
const tagsOf = (repository: string): Map<string, string> => {
  const cached = tagCache.get(repository) ?? releaseTags(repository);
  tagCache.set(repository, cached);
  return cached;
};
for (const { file, text } of workflows) {
  for (const match of text.matchAll(/uses: ([^\s@]+)@(\S+)(?: # (\S+))?/g)) {
    const [, action = '', reference = '', comment = ''] = match;
    const repository = action.split('/').slice(0, 2).join('/');
    const tags = tagsOf(repository);
    const latest = newest([...tags.keys()]);
    const latestTag = tags.keys().find(tag => parseVersion(tag)?.text === latest.text) ?? '';
    if (!/^[\da-f]{40}$/.test(reference)) {
      problems.push(
        `UNPINNED: ${file} uses ${action}@${reference} (pin the commit SHA of ${latestTag})`
      );
    } else if (comment !== latestTag || reference !== tags.get(latestTag)) {
      problems.push(
        `OUTDATED: ${file} uses ${action}@${reference} # ${comment}, newest is ${latestTag} (${tags.get(latestTag) ?? '?'})`
      );
    }
  }
  for (const [variable, repository] of Object.entries(toolEntries)) {
    if (typeof repository !== 'string') {
      throw new TypeError(`tools.${variable}: expected a repository name`);
    }
    for (const match of text.matchAll(new RegExp(String.raw`${variable}: (\S+)`, 'g'))) {
      const pinned = requireVersion(match[1] ?? '', `${file} ${variable}`);
      const latest = newest([...tagsOf(repository).keys()]);
      if (compareVersions(pinned, latest) !== 0) {
        problems.push(
          `OUTDATED: ${file} pins ${variable} ${pinned.text}, newest is ${latest.text}`
        );
      }
    }
  }
}

for (const name of holds.keys()) {
  if (!usedHolds.has(name)) {
    problems.push(`STALE HOLD: ${name} is not a checked dependency`);
  }
}
for (const problem of problems) {
  process.stderr.write(`${problem}\n`);
}
process.stdout.write(
  problems.length === 0 ? 'Every dependency is current or on a documented hold.\n' : ''
);
process.exitCode = problems.length === 0 ? 0 : 1;
