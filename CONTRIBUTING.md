# Contributing

Thanks for your interest in improving `enforce-commit-status`!

## Development Setup

The repository develops on the exact Node.js release in `.node-version` (the newest Node.js 24,
matching the action's `node24` runtime) and the npm release in the `packageManager` field of
`package.json` (`npm@X.Y.Z+sha512.HEX`). `script/check_node.sh` verifies both;
`script/setup_npm.sh` installs that npm release (verified against the SHA-512 of the field) and
the locked dependencies, as CI does.

```bash
script/setup_npm.sh   # or: npm install --global npm@X.Y.Z && npm ci
```

`npm ci` also installs the husky pre-commit hook.

## Before Opening a Pull Request

Run every check:

```bash
script/check            # every check, in the order CI runs them
script/check eslint     # or only the named ones
```

CI runs each check through the same script, so a local run checks exactly what CI checks. The
standalone tools are pinned in `script/tools.json` (and yamllint, with hashes, in
`script/python/requirements.txt`); `script/install_tools.sh` installs them on Linux x86-64, and on
other platforms each tool's own release or package manager provides the same version.

The checks:

- `eslint`: ESLint with every rule of ESLint, `typescript-eslint` and every plugin (`n`,
  `promise`, `regexp`, `unicorn`, `jsdoc`, `@vitest/eslint-plugin`, `eslint-comments`) as an
  error, `--max-warnings 0`. The few rules that are off, or configured, say why in
  `eslint.config.ts`.
- `prettier`: Prettier.
- `typecheck`: `tsc` with `strict` and every additional strictness flag
  (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`,
  `noImplicitOverride`, ...), library declarations included (`skipLibCheck: false`).
- `suppressions`: no inline suppression anywhere (`script/forbidden_suppressions.sh`, see below).
- `knip`: no unused file, export or dependency, and no undeclared dependency; in production mode,
  every dependency of `src/` is a production dependency.
- `duplication`: jscpd, no duplicated code.
- `test`: Vitest; 100% line, branch, function **and** statement coverage of every file of `src/`;
  every test asserts; any Node.js process warning or deprecation fails the run.
- `dist`: the committed `dist/` is a byte-identical rebuild of `src/`, and the bundle runs.
- `mutation`: Stryker; every mutant of `src/` must be killed (break threshold 100).
- `outdated`: every dependency, Action and tool at its newest release, except the documented holds
  of `script/outdated.json`.
- `audit`: every package resolves to `https://registry.npmjs.org`, has no known vulnerability of
  any severity, and has valid registry signatures and provenance attestations.
- `scorecard`: every package of the lock file comes from a repository with an OpenSSF Scorecard of
  at least 3, unless `script/scorecard.json` allows it with the reason it cannot be removed.
- `typos`, `markdown` (rumdl: every markdownlint rule and rumdl's own, `.rumdl.toml`), `yaml`
  (yamllint `--strict`, `.yamllint.yaml`), `editorconfig` (editorconfig-checker).
- `actionlint` (with ShellCheck on every `run:` block), `shellcheck` (`--enable=all
--severity=style`), `shfmt`, `zizmor` (pedantic persona; online audits with `GH_TOKEN`).
- `gitleaks`: no secret in the whole history.

CI also runs Dependency review (any vulnerability of any severity, in any scope, fails it) and
CodeQL. The tests run on the Node.js of `.node-version` and on the newest Node.js release. Every
job blocks network egress except the endpoints it lists (`step-security/harden-runner`).

Mutation runs take a few minutes. While iterating, mutate one file at a time, e.g.
`npx stryker run --mutate src/utilities.ts`.

## Rules

- **No inline suppressions.** Nothing may silence a linter, scanner, type checker, warning or test
  in place: no `eslint-disable` (ESLint also runs with `noInlineConfig`),
  `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`, `any`, `as unknown as`, non-null assertions,
  `istanbul`/`c8`/`v8 ignore`, `Stryker disable`, `prettier-ignore`,
  `markdownlint-disable`/`rumdl-disable`, `yamllint disable`, `editorconfig-checker-disable`,
  `jscpd:ignore`, `gitleaks:allow`, `zizmor: ignore`, `nosec`, `--no-warnings`/`--no-deprecation`,
  `.skip`/`.only`/`.todo`, and so on. Fix the cause. A rule that cannot apply to a file is
  configured narrowly in the tool's configuration file, with the reason written next to it.
  `script/forbidden_suppressions.sh` enforces this in CI and in the pre-commit hook.
- **No warnings.** Tests fail on any Node.js process warning; npm scripts run with
  `--throw-deprecation`. Every workflow ends with a "Warning gate" job (`script/warning_gate.sh`)
  that fails the run when the log of any job contains a warning or a deprecation notice.
- **Behavior is specified.** Every behavioral fix needs a regression test, and every surviving
  mutant needs a test that kills it (or, when the mutation cannot change observable behavior,
  simpler code).
- **Dependencies are current.** Dependencies are pinned to exact versions. `npm run outdated`
  (`script/outdated.ts`) fails for any dependency, override, GitHub Action, tool or Python package
  that is not at its newest release, unless `script/outdated.json` lists it as a hold with the
  reason; a hold whose reason no longer applies fails too. GitHub Actions are pinned to the full
  commit SHA of their newest release tag.
- Keep `REQUIREMENTS.md` in sync with behavior changes: it is the single source of truth
  (requirements are referenced as `ECS-REQ-###` in code comments and test names).
- Update `CHANGELOG.md` for user-visible changes.

## The Committed `dist/` Bundle

This repository ships its compiled bundle: the code consumers execute is the **committed**
`dist/index.js`, not `src/`. After changing anything under `src/` or the dependencies you must run:

```bash
npm run build
git add dist
```

CI rebuilds `dist/` from source and fails the PR if the committed bundle does not match, and
smoke-tests the packaged bundle to prove it executes. The build script cleans `dist/` first, so
stale files are also detected.

The pre-commit hook (husky) runs the fast checks (`script/check eslint prettier typecheck
suppressions test dist`), and fails the commit if `dist/` is out of date: it intentionally does
**not** auto-stage `dist/`; review and stage it yourself.

## Releases

Releases are cut by pushing a `v*` tag. The release workflow runs every check (`script/check`,
including mutation testing and the rebuild of `dist/`) on the tagged commit, and then publishes a
GitHub release. The floating `v1` major tag is advanced to the released commit.

## Code of Conduct

Everyone interacting with this project is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
