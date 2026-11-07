#!/usr/bin/env bash
# Installs the named tools of the checks (script/check) for Linux x86-64 into TOOLS_DIR (default
# ${RUNNER_TEMP}/tools) and, in GitHub Actions, adds that directory to the PATH of the later steps.
#
# The standalone binaries come from the GitHub release pinned in script/tools.json; every download
# is verified against its SHA-256 before it is unpacked. yamllint is installed into a virtual
# environment from script/python/requirements.txt, where every package is pinned with its hashes.
#
# Usage: script/install_tools.sh tool...
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tools_dir="${TOOLS_DIR:-${RUNNER_TEMP:?RUNNER_TEMP or TOOLS_DIR is required}/tools}"
mkdir -p "${tools_dir}"

install_python_tool() {
  local tool=$1 venv="${tools_dir}/python"
  if [[ ! -x "${venv}/bin/python" ]]; then
    python3 -m venv "${venv}"
  fi
  "${venv}/bin/python" -m pip install --quiet --disable-pip-version-check --no-deps \
    --require-hashes --only-binary=:all: --requirement "${root}/script/python/requirements.txt"
  ln -sf "${venv}/bin/${tool}" "${tools_dir}/${tool}"
}

install_release_tool() {
  local tool=$1 spec repository version asset sha256 member file unpacked
  spec=$(jq --exit-status --arg tool "${tool}" '.tools[$tool]' "${root}/script/tools.json") || {
    echo "Unknown tool '${tool}' (not in script/tools.json)" >&2
    return 1
  }
  repository=$(jq --raw-output '.repository' <<<"${spec}")
  version=$(jq --raw-output '.version' <<<"${spec}")
  asset=$(jq --raw-output '.asset' <<<"${spec}")
  sha256=$(jq --raw-output '.sha256' <<<"${spec}")
  member=$(jq --raw-output '.member // ""' <<<"${spec}")
  asset=${asset//\{version\}/${version}}
  member=${member//\{version\}/${version}}
  file="${tools_dir}/${asset}"

  curl --fail --silent --show-error --location --output "${file}" \
    "https://github.com/${repository}/releases/download/v${version}/${asset}"
  echo "${sha256}  ${file}" | sha256sum --check --strict --quiet

  if [[ -z ${member} ]]; then
    install -m 0755 "${file}" "${tools_dir}/${tool}"
  else
    unpacked="${tools_dir}/${tool}.unpacked"
    mkdir -p "${unpacked}"
    tar -xf "${file}" -C "${unpacked}" "${member}"
    install -m 0755 "${unpacked}/${member}" "${tools_dir}/${tool}"
    rm -rf "${unpacked}"
  fi
  rm -f "${file}"
}

for tool in "$@"; do
  case "${tool}" in
    yamllint) install_python_tool "${tool}" ;;
    *) install_release_tool "${tool}" ;;
  esac
  version_output=$("${tools_dir}/${tool}" --version 2>&1)
  echo "Installed ${tool}: ${version_output%%$'\n'*}"
done

if [[ -n ${GITHUB_PATH:-} ]]; then
  echo "${tools_dir}" >>"${GITHUB_PATH}"
fi
