/**
 * @file The pins of the GitHub Actions workflows and of script/tools.json: the Node.js versions of
 * the test matrix, every Action (pinned to the commit of its newest release tag) and every tool.
 */
import { type Version, isSameVersion, newest, parseVersion, requireVersion } from './versions.ts';
import {
  entriesOf,
  matchesOf,
  readJson,
  readText,
  recordProperty,
  root,
  stringProperty
} from './json.ts';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { releaseTagsOf } from './registries.ts';

/**
 * A workflow file and its content.
 */
type Workflow = { readonly file: string; readonly text: string };

/**
 * The Node.js releases, and the runtime version whose line the workflows may also pin.
 */
type NodeLines = { readonly releases: readonly string[]; readonly runtime: Version };

/**
 * An Action a workflow uses: `uses: &lt;action>@&lt;reference> # &lt;comment>`.
 */
type ActionPin = {
  readonly action: string;
  readonly comment: string;
  readonly file: string;
  readonly reference: string;
  readonly repository: string;
};

const NODE_PIN = /node-version: '?(?<version>\d+\.\d+\.\d+)'?/gv;
const ACTION_PIN =
  /uses: (?<repository>[^\s\/@]+\/[^\s\/@]+)(?<path>\/[^\s@]*)?@(?<reference>\S+)(?: # (?<comment>\S+))?/gv;
const COMMIT_SHA = /^[\da-f]{40}$/v;

/**
 * Reads every workflow.
 * @returns The workflow files (relative to .github) and their content.
 */
export async function readWorkflows(): Promise<readonly Workflow[]> {
  const files = await readdir(path.join(root, '.github', 'workflows'));
  return Promise.all(
    files
      .filter(file => file.endsWith('.yml'))
      .map(async file => {
        const relative = path.join('workflows', file);
        return { file: relative, text: await readText(path.join('.github', relative)) };
      })
  );
}

/**
 * Checks one Node.js version a workflow pins: the newest release of its line, and either the
 * runtime's line or the newest line.
 * @param pin - The workflow file and the version it pins.
 * @param lines - The Node.js releases and the runtime version.
 * @returns The problems found.
 */
function checkNodePin(pin: Workflow, lines: NodeLines): readonly string[] {
  const pinned = requireVersion(pin.text, `${pin.file} node-version`);
  const expected = newest(lines.releases, pinned.major);
  const problems = isSameVersion(pinned, expected)
    ? []
    : [`OUTDATED: ${pin.file} pins Node.js ${pinned.text}, newest of its line is ${expected.text}`];
  const isCheckedLine =
    pinned.major === lines.runtime.major || pinned.major === newest(lines.releases).major;
  return isCheckedLine
    ? problems
    : [...problems, `OUTDATED: ${pin.file} tests on Node.js ${pinned.text}, not a checked line`];
}

/**
 * Checks the Node.js versions the workflows pin.
 * @param workflows - Every workflow file and its content.
 * @param lines - The Node.js releases and the runtime version.
 * @returns The problems found.
 */
export function checkNodePins(workflows: readonly Workflow[], lines: NodeLines): readonly string[] {
  return workflows.flatMap(({ file, text }) => {
    const pins = matchesOf(text, NODE_PIN);
    return pins.flatMap(pin => checkNodePin({ file, text: pin['version'] ?? '' }, lines));
  });
}

/**
 * Checks one Action pin: the full commit SHA of the newest release tag, named in a comment.
 * @param pin - The Action, its reference and comment, and the workflow that pins it.
 * @param tags - The release tags of the Action's repository.
 * @returns The problems found.
 */
function checkActionPin(pin: ActionPin, tags: ReadonlyMap<string, string>): readonly string[] {
  const { action, comment, file, reference } = pin;
  const latest = newest(tags.keys().toArray());
  const latestTag = tags.keys().find(tag => parseVersion(tag)?.text === latest.text) ?? '';
  if (!COMMIT_SHA.test(reference)) {
    return [`UNPINNED: ${file} uses ${action}@${reference} (pin the commit SHA of ${latestTag})`];
  }
  const latestSha = tags.get(latestTag) ?? '?';
  return comment === latestTag && reference === latestSha
    ? []
    : [`OUTDATED: ${file} uses ${action}@${reference} # ${comment}, newest is ${latestTag}`];
}

/**
 * Checks every Action the workflows use.
 * @param workflows - Every workflow file and its content.
 * @returns The problems found.
 */
export async function checkActions(workflows: readonly Workflow[]): Promise<readonly string[]> {
  const pins = workflows.flatMap(({ file, text }) => {
    const matches = matchesOf(text, ACTION_PIN);
    return matches.map((match): ActionPin => {
      const { comment = '', path: actionPath = '', reference = '', repository = '' } = match;
      return { action: `${repository}${actionPath}`, comment, file, reference, repository };
    });
  });
  const tags = await releaseTagsOf(pins.map(({ repository }) => repository));
  return pins.flatMap(pin => checkActionPin(pin, tags.get(pin.repository) ?? new Map()));
}

/**
 * Checks every tool of script/tools.json against the newest release of its repository.
 * @returns The problems found.
 */
export async function checkTools(): Promise<readonly string[]> {
  /**
   * A tool of script/tools.json.
   */
  type Tool = { readonly name: string; readonly repository: string; readonly version: Version };
  const entries = entriesOf(recordProperty(await readJson('script/tools.json'), 'tools'));
  const tools = entries.map(([name, tool]): Tool => {
    const version = stringProperty(tool, 'version', `tools.${name}`);
    return {
      name,
      repository: stringProperty(tool, 'repository', `tools.${name}`),
      version: requireVersion(version, name)
    };
  });
  const tags = await releaseTagsOf(tools.map(({ repository }) => repository));
  return tools
    .map(({ name, repository, version }) => {
      const latest = newest((tags.get(repository) ?? new Map<string, string>()).keys().toArray());
      return isSameVersion(version, latest)
        ? ''
        : `OUTDATED: script/tools.json pins ${name} ${version.text}, newest is ${latest.text}`;
    })
    .filter(problem => problem !== '');
}
