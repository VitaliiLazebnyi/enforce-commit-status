#!/usr/bin/env bash
# Installs the npm release of the `packageManager` field of package.json (`npm@X.Y.Z+sha512.HEX`),
# verifies the Node.js and npm versions (script/check_node.sh) and installs the locked
# dependencies. The npm tarball is downloaded from the registry and verified against the SHA-512 of
# the `packageManager` field before it is installed. Run by every CI job that needs Node.js, right
# after actions/setup-node.
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

directory="$(mktemp -d)"
tarball="${directory}/npm-${version}.tgz"
curl --fail --silent --show-error --location --output "${tarball}" \
  "https://registry.npmjs.org/npm/-/npm-${version}.tgz"
echo "${sha512}  ${tarball}" | sha512sum --check --strict --quiet
npm install --global --no-audit --no-fund "${tarball}"
rm -rf "${directory}"

"${root}/script/check_node.sh" "$@"
npm ci
