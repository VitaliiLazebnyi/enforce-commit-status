#!/usr/bin/env bash
# Puts the npm release of the `packageManager` field of package.json (`npm@X.Y.Z+sha512.HEX`) first
# on the PATH, verifies the Node.js and npm versions (script/check_node.sh) and installs the locked
# dependencies. The npm tarball is downloaded from the registry and verified against the SHA-512 of
# the `packageManager` field. npm bundles its own dependencies, so the verified tarball is unpacked
# as it is instead of installed with `npm install --global` (an install outside any lockfile). Run
# by every CI job that needs Node.js, right after actions/setup-node; in a GitHub Actions job the
# later steps get the same npm (GITHUB_PATH). Prints the directory to put first on the PATH.
#
# Usage: script/setup_npm.sh [expected-node-version]   (see script/check_node.sh)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_manager="$(jq --raw-output '.packageManager' "${root}/package.json")"
if [[ ! ${package_manager} =~ ^npm@([0-9]+\.[0-9]+\.[0-9]+)\+sha512\.([0-9a-f]{128})$ ]]; then
  echo "package.json packageManager must read npm@X.Y.Z+sha512.HEX, got '${package_manager}'" >&2
  exit 1
fi
version="${BASH_REMATCH[1]}"
sha512="${BASH_REMATCH[2]}"

directory="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/npm-${version}"
rm -rf "${directory}"
mkdir -p "${directory}/package" "${directory}/bin"
tarball="${directory}/npm-${version}.tgz"
curl --fail --silent --show-error --location --output "${tarball}" \
  "https://registry.npmjs.org/npm/-/npm-${version}.tgz"
echo "${sha512}  ${tarball}" | sha512sum --check --strict --quiet
tar -xzf "${tarball}" -C "${directory}/package" --strip-components 1
rm "${tarball}"
# Wrappers that run the unpacked CLIs directly: the package's own bin/npm would hand over to the
# npm of the global prefix (the one actions/setup-node installed) whenever there is one.
for command in npm npx; do
  printf '#!/usr/bin/env bash\nexec node "%s/package/bin/%s-cli.js" "$@"\n' "${directory}" \
    "${command}" >"${directory}/bin/${command}"
  chmod 0755 "${directory}/bin/${command}"
done
PATH="${directory}/bin:${PATH}"
if [[ -n ${GITHUB_PATH:-} ]]; then
  echo "${directory}/bin" >>"${GITHUB_PATH}"
fi

"${root}/script/check_node.sh" "$@"
npm ci
echo "${directory}/bin"
