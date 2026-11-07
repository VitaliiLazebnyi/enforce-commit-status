/**
 * @file The newest releases, as the registries publish them: npm, Node.js, PyPI and the release
 * tags of GitHub repositories.
 */
import { fetchJson, parseJson, recordProperty, root, stringProperty } from './json.ts';
import { once } from 'node:events';
import { parseVersion } from './versions.ts';
import { spawn } from 'node:child_process';
import { text } from 'node:stream/consumers';

const SUCCESS = 0;
// One line of `git ls-remote --tags`: the object id and the tag (`^{}`: the peeled commit).
const TAG_LINE = /^(?<sha>[\da-f]{40})\trefs\/tags\/(?<name>[^\s^]+)(?<peeled>\^\{\})?$/v;

/**
 * Runs a command in the repository root.
 * @param command - The executable.
 * @param commandArguments - Its arguments.
 * @returns The standard output.
 * @rejects {Error} When the command exits with a non-zero status.
 */
async function runCommand(command: string, commandArguments: readonly string[]): Promise<string> {
  const child = spawn(command, commandArguments, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'inherit']
  });
  const closed = once(child, 'close');
  const output = await text(child.stdout);
  const closeArguments: readonly unknown[] = await closed;
  const [exitCode] = closeArguments;
  if (exitCode !== SUCCESS) {
    throw new Error(`${command} ${commandArguments.join(' ')} exited with ${String(exitCode)}`);
  }
  return output;
}

/**
 * Lists the published versions of an npm package.
 * @param name - The package name.
 * @returns Every published version.
 */
export async function npmVersions(name: string): Promise<readonly string[]> {
  const versions = parseJson(await runCommand('npm', ['view', name, 'versions', '--json']));
  return Array.isArray(versions)
    ? versions.filter((version): version is string => typeof version === 'string')
    : [];
}

/**
 * Lists the Node.js releases.
 * @returns The version of every release (`vX.Y.Z`).
 */
export async function nodeReleases(): Promise<readonly string[]> {
  const index = await fetchJson('https://nodejs.org/dist/index.json');
  return Array.isArray(index)
    ? index.map(release => stringProperty(release, 'version', 'nodejs.org/dist/index.json'))
    : [];
}

/**
 * Reads the newest release of a PyPI package.
 * @param name - The package name.
 * @returns The newest version, as PyPI reports it.
 */
export async function pypiVersion(name: string): Promise<string> {
  const project = await fetchJson(`https://pypi.org/pypi/${name}/json`);
  return stringProperty(recordProperty(project, 'info'), 'version', `PyPI ${name}`);
}

/**
 * Lists the stable release tags of a GitHub repository with the commit each one points to.
 * @param repository - The `owner/name` of the repository.
 * @returns The commit SHA of every release tag, keyed by the tag name.
 */
async function releaseTags(repository: string): Promise<ReadonlyMap<string, string>> {
  const output = await runCommand('git', [
    'ls-remote',
    '--tags',
    `https://github.com/${repository}`
  ]);
  const tags = new Map<string, string>();
  for (const line of output.split('\n')) {
    const { name = '', peeled, sha = '' } = TAG_LINE.exec(line)?.groups ?? {};
    // An annotated tag is listed twice; the peeled (`^{}`) line names the commit.
    if (parseVersion(name) !== undefined && (peeled !== undefined || !tags.has(name))) {
      tags.set(name, sha);
    }
  }
  return tags;
}

/**
 * Lists the release tags of several repositories, each looked up once.
 * @param repositories - The `owner/name` of each repository (duplicates allowed).
 * @returns The release tags of each repository, keyed by the repository.
 */
export async function releaseTagsOf(
  repositories: readonly string[]
): Promise<ReadonlyMap<string, ReadonlyMap<string, string>>> {
  const unique = [...new Set(repositories)];
  const tags = await Promise.all(unique.map(async repository => releaseTags(repository)));
  return new Map(unique.map((repository, index) => [repository, tags[index] ?? new Map()]));
}
