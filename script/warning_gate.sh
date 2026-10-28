#!/usr/bin/env bash
# Fails when the log of any other job of the current workflow run contains a warning or a deprecation
# notice. Run by the "Warning gate" job of every workflow; the repository tolerates no warnings (see
# CONTRIBUTING.md).
#
# Needs GH_TOKEN (actions: read), GITHUB_REPOSITORY, GITHUB_RUN_ID and GATE_JOB_NAME (the name of the
# gate job itself, whose own log quotes the pattern).
set -euo pipefail

# Node.js process warnings (DeprecationWarning, ExperimentalWarning, ...), npm, Prettier, the runner's
# own annotations and deprecation notices of actions.
pattern='[Ww]arning:|WARNING:|DEPRECATION|DEPRECATED|##\[warning\]|::warning|npm warn|npm WARN|\[warn\]|is deprecated|will be deprecated|Node\.js [0-9]+ actions are deprecated'
# The one kind of matching line that is not a warning: CodeQL prints the JSON schema of its extractor
# options, whose "title" and "description" fields document a deprecated option ("DEPRECATED - Whether
# to use buildless ..."). Only such JSON documentation fields are skipped; the same words anywhere
# else still fail.
documentation='^[0-9TZ:.-]+ +"(title|description)" : "'

jobs=$(gh api --paginate "repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/jobs?per_page=100" \
  --jq ".jobs[] | select(.name != \"${GATE_JOB_NAME}\" and .conclusion != \"skipped\") | \"\(.id)\t\(.name)\"")

status=0
while IFS=$'\t' read -r id name; do
  [ -n "$id" ] || continue
  # Downloaded with curl: depending on its version, gh refuses to print a log that contains terminal
  # escape sequences (colored tool output), and older versions do not know the flag that allows them.
  log=$(curl --fail --silent --show-error --location \
    --header "Authorization: Bearer ${GH_TOKEN}" --header 'Accept: application/vnd.github+json' \
    "${GITHUB_API_URL:-https://api.github.com}/repos/${GITHUB_REPOSITORY}/actions/jobs/${id}/logs")
  hits=$(printf '%s\n' "$log" | grep -nE -e "$pattern" | grep -vE -e "^[0-9]+:${documentation#^}" || true)
  if [ -n "$hits" ]; then
    printf '::error::Warnings in the log of job "%s"\n%s\n\n' "$name" "$hits"
    status=1
  else
    printf 'No warnings in the log of job "%s"\n' "$name"
  fi
done <<< "$jobs"

exit "$status"
