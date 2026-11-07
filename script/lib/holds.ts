/**
 * @file The documented holds of script/outdated.json and the check of one dependency against its
 * newest release.
 */
import { type Version, isSameVersion, newest } from './versions.ts';
import { entriesOf, isRecord, stringProperty } from './json.ts';

/**
 * A dependency deliberately held below its newest major release, with the reason.
 */
type Hold = {
  readonly allowedMajor: number;
  readonly newestMajor: number;
  readonly reason: string;
};

/**
 * The holds, by dependency name.
 */
export type Holds = Readonly<Record<string, Hold>>;

/**
 * A dependency in use and its released versions.
 */
export type Dependency = {
  readonly available: readonly string[];
  readonly current: Version;
  readonly name: string;
};

/**
 * Parses the holds of script/outdated.json.
 * @param entries - The `holds` object.
 * @returns The holds, by dependency name.
 * @throws {TypeError} When a hold lacks its majors or its reason.
 */
export function parseHolds(entries: Readonly<Record<string, unknown>>): Holds {
  return Object.fromEntries(
    entriesOf(entries).map(([name, value]): [string, Hold] => {
      const allowedMajor = isRecord(value) ? value['allowedMajor'] : undefined;
      const newestMajor = isRecord(value) ? value['newestMajor'] : undefined;
      const reason = stringProperty(value, 'reason', `hold ${name}`);
      if (typeof allowedMajor !== 'number' || typeof newestMajor !== 'number') {
        throw new TypeError(`hold ${name}: allowedMajor and newestMajor must be numbers`);
      }
      return [name, { allowedMajor, newestMajor, reason }];
    })
  );
}

/**
 * Checks a held dependency: the hold must still describe the releases, and the dependency must be
 * at the newest release of its allowed major line.
 * @param dependency - A dependency in use and its released versions.
 * @param hold - Its hold.
 * @returns The problems found.
 */
function checkHeld(dependency: Dependency, hold: Hold): readonly string[] {
  const { available, current, name } = dependency;
  const latest = newest(available);
  if (hold.allowedMajor !== current.major || hold.newestMajor !== latest.major) {
    return [
      `STALE HOLD: ${name} is held at major ${String(hold.allowedMajor)} while major ` +
        `${String(hold.newestMajor)} is the newest, but ${current.text} is in use and ` +
        `${latest.text} is the newest release`
    ];
  }
  process.stdout.write(`on hold: ${name} ${current.text} (newest ${latest.text})\n`);
  const newestAllowed = newest(available, hold.allowedMajor);
  return isSameVersion(current, newestAllowed)
    ? []
    : [`OUTDATED WITHIN THE HOLD: ${name} ${current.text} -> ${newestAllowed.text}`];
}

/**
 * Checks a dependency against its newest release and the hold list.
 * @param dependency - A dependency in use and its released versions.
 * @param holds - The documented holds.
 * @returns The problems found.
 */
export function checkDependency(dependency: Dependency, holds: Holds): readonly string[] {
  const hold = holds[dependency.name];
  if (hold !== undefined) {
    return checkHeld(dependency, hold);
  }
  const latest = newest(dependency.available);
  return isSameVersion(dependency.current, latest)
    ? []
    : [`NOT ON THE HOLD LIST: ${dependency.name} ${dependency.current.text} -> ${latest.text}`];
}
