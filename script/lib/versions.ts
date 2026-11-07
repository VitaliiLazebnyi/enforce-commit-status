/**
 * @file Stable `X.Y.Z` versions: parsing, ordering and the newest of a list.
 */

/**
 * A parsed stable version.
 */
export type Version = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly text: string;
};

const VERSION_PATTERN = /^v?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/v;

/**
 * Parses a stable `X.Y.Z` version (an optional leading `v` is ignored).
 * @param text - The version string.
 * @returns The version, or undefined for pre-releases and other strings.
 */
export function parseVersion(text: string): Version | undefined {
  const groups = VERSION_PATTERN.exec(text)?.groups;
  if (groups === undefined) {
    return undefined;
  }
  const { major = '', minor = '', patch = '' } = groups;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    text: `${major}.${minor}.${patch}`
  };
}

/**
 * Parses a version that must be stable.
 * @param text - The version string.
 * @param context - Where the version came from, for the error message.
 * @returns The parsed version.
 * @throws {Error} When the text is not an exact `X.Y.Z` version.
 */
export function requireVersion(text: string, context: string): Version {
  const version = parseVersion(text);
  if (version === undefined) {
    throw new Error(`${context}: '${text}' is not an exact X.Y.Z version`);
  }
  return version;
}

/**
 * Orders two versions from the newest to the oldest.
 * @param first - One version.
 * @param second - The other version.
 * @returns A negative number when the first version is newer, a positive one when it is older.
 */
function byNewest(first: Version, second: Version): number {
  return second.major - first.major || second.minor - first.minor || second.patch - first.patch;
}

/**
 * Tells whether two versions are the same.
 * @param first - One version.
 * @param second - The other version.
 * @returns Whether both name the same release.
 */
export function isSameVersion(first: Version, second: Version): boolean {
  return first.text === second.text;
}

/**
 * Selects the newest stable version.
 * @param texts - Version strings; pre-releases and non-versions are ignored.
 * @param major - When given, only versions of this major line are considered.
 * @returns The newest version.
 * @throws {Error} When there is no stable version (of the major line).
 */
export function newest(texts: readonly string[], major?: number): Version {
  const [latest] = texts
    .map(text => parseVersion(text))
    .filter((version): version is Version => version !== undefined)
    .filter(version => major === undefined || version.major === major)
    .toSorted(byNewest);
  if (latest === undefined) {
    throw new Error(
      `No stable release found${major === undefined ? '' : ` for major ${String(major)}`}`
    );
  }
  return latest;
}
