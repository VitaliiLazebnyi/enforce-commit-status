/**
 * @file Fails when a dependency is not at its newest release and is not on the documented hold
 * list of script/outdated.json, or when a listed hold no longer matches the upstream releases it
 * documents.
 *
 * Checked: the Node.js runtime (.node-version and the Node.js versions pinned in the workflows),
 * npm (`packageManager`), every direct npm dependency, every `overrides` entry, every GitHub Action
 * (pinned to the commit of its newest release tag), every tool of script/tools.json and every
 * Python package of script/python/requirements.txt.
 *
 * Usage: node script/outdated.ts.
 */
import { type Holds, checkDependency, parseHolds } from './lib/holds.ts';
import { checkActions, checkNodePins, checkTools, readWorkflows } from './lib/workflows.ts';
import { matchesOf, readJson, readText, recordProperty, stringProperty } from './lib/json.ts';
import { nodeReleases, npmVersions, pypiVersion } from './lib/registries.ts';
import { requireVersion } from './lib/versions.ts';

/**
 * The problems one check found, and the held dependencies it checked.
 */
type Report = { readonly checked: readonly string[]; readonly problems: readonly string[] };

const REQUIREMENT = /^(?<name>[\w\-.]+)==(?<version>\S+)/gmv;
const PACKAGE_MANAGER = /^npm@(?<version>\d+\.\d+\.\d+)\+/v;
const FAILURE = 1;

/**
 * Checks Node.js: the runtime of .node-version and the versions the workflows pin.
 * @param holds - The documented holds.
 * @returns The problems found.
 */
async function checkNode(holds: Holds): Promise<Report> {
  const [releases, nodeVersion, workflows] = await Promise.all([
    nodeReleases(),
    readText('.node-version'),
    readWorkflows()
  ]);
  const runtime = requireVersion(nodeVersion.trim(), '.node-version');
  return {
    checked: ['node'],
    problems: [
      ...checkDependency({ available: releases, current: runtime, name: 'node' }, holds),
      ...checkNodePins(workflows, { releases, runtime })
    ]
  };
}

/**
 * Lists npm itself (`packageManager`), every direct dependency and every override, with the
 * version in use.
 * @returns The name and version of each.
 */
async function packagesInUse(): Promise<
  readonly { readonly name: string; readonly version: string }[]
> {
  const [manifest, lock] = await Promise.all([
    readJson('package.json'),
    readJson('package-lock.json')
  ]);
  const packageManager = stringProperty(manifest, 'packageManager', 'package.json');
  const locked = recordProperty(lock, 'packages');
  const sections = ['dependencies', 'devDependencies', 'overrides'];
  const names = sections.flatMap(section => Object.keys(recordProperty(manifest, section)));
  return [
    { name: 'npm', version: PACKAGE_MANAGER.exec(packageManager)?.groups?.['version'] ?? '' },
    ...names.map(name => {
      const version = stringProperty(locked[`node_modules/${name}`], 'version', `lock ${name}`);
      return { name, version };
    })
  ];
}

/**
 * Checks npm itself, every direct dependency and every override.
 * @param holds - The documented holds.
 * @returns The problems found.
 */
async function checkPackages(holds: Holds): Promise<Report> {
  const packages = await packagesInUse();
  const problems = await Promise.all(
    packages.map(async ({ name, version }) => {
      const available = await npmVersions(name);
      return checkDependency({ available, current: requireVersion(version, name), name }, holds);
    })
  );
  return { checked: packages.map(({ name }) => name), problems: problems.flat() };
}

/**
 * Checks the Python packages of script/python/requirements.txt against PyPI.
 * @returns The problems found.
 */
async function checkPython(): Promise<Report> {
  const requirements = matchesOf(await readText('script/python/requirements.txt'), REQUIREMENT);
  const problems = await Promise.all(
    requirements.map(async ({ name = '', version = '' }) => {
      const latest = await pypiVersion(name);
      return latest === version
        ? []
        : [`OUTDATED: script/python/requirements.txt pins ${name} ${version}, newest is ${latest}`];
    })
  );
  return { checked: [], problems: problems.flat() };
}

/**
 * Checks the Actions and the tools the workflows pin.
 * @returns The problems found.
 */
async function checkPins(): Promise<Report> {
  const workflows = await readWorkflows();
  const [actions, tools] = await Promise.all([checkActions(workflows), checkTools()]);
  return { checked: [], problems: [...actions, ...tools] };
}

const holds = parseHolds(recordProperty(await readJson('script/outdated.json'), 'holds'));
const reports = await Promise.all([
  checkNode(holds),
  checkPackages(holds),
  checkPython(),
  checkPins()
]);
const checked = new Set(reports.flatMap(report => report.checked));
const problems = [
  ...reports.flatMap(report => report.problems),
  ...Object.keys(holds)
    .filter(name => !checked.has(name))
    .map(name => `STALE HOLD: ${name} is not a checked dependency`)
];
for (const problem of problems) {
  process.stderr.write(`${problem}\n`);
}
const [firstProblem] = problems;
if (firstProblem === undefined) {
  process.stdout.write('Every dependency is current or on a documented hold.\n');
} else {
  process.exitCode = FAILURE;
}
