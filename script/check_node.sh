#!/usr/bin/env bash
# Prints the active Node.js and npm and fails unless they are exactly the expected versions.
# Usage: script/check_node.sh [expected-node-version]   (defaults to the contents of .node-version;
# npm must match the `packageManager` field of package.json)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
expected_node="${1:-$(tr -d '[:space:]' < "$root/.node-version")}"
expected_npm="$(node -p "require('$root/package.json').packageManager.replace(/^npm@/, '')")"
actual_node="$(node -p 'process.versions.node')"
actual_npm="$(npm --version)"
echo "node ${actual_node}, npm ${actual_npm}"
if [ "$actual_node" != "$expected_node" ]; then
  echo "Expected Node.js ${expected_node} but running ${actual_node}" >&2
  exit 1
fi
if [ "$actual_npm" != "$expected_npm" ]; then
  echo "Expected npm ${expected_npm} but running ${actual_npm}" >&2
  exit 1
fi
