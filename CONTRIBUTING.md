# Contributing

Thanks for your interest in improving `enforce-commit-status`!

## Development Setup

The repository develops on the exact Node.js release in `.node-version` (the newest Node.js 24, matching the action's `node24` runtime) and the npm release in the `packageManager` field of `package.json`. `script/check_node.sh` verifies both.

```bash
npm install --global "$(node -p "require('./package.json').packageManager")"
npm ci            # also installs the husky pre-commit hook
```

## Before opening a pull request

Run the verification suite. Every gate is enforced in CI and fails the build:

```bash
npm run check
```

That runs, in order:

| Script                 | Gate                                                                                                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`         | ESLint with `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, `eslint-plugin-n`, `-promise`, `-regexp`, `-unicorn` (unopinionated), `-jsdoc` (every function documented), `@vitest/eslint-plugin` and `eslint-comments`; `--max-warnings 0` |
| `npm run format:check` | Prettier                                                                                                                                                                                                                                                    |
| `npm run typecheck`    | `tsc` with `strict` and every additional strictness flag (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitOverride`, …), library declarations included (`skipLibCheck: false`)                   |
| `npm run suppressions` | no inline suppression anywhere (`script/forbidden_suppressions.sh`, see below)                                                                                                                                                                              |
| `npm run knip`         | no unused file, export or dependency, and no undeclared dependency                                                                                                                                                                                          |
| `npm run duplication`  | jscpd: no duplicated code in `src/`, `script/` and `__tests__/`                                                                                                                                                                                             |
| `npm test`             | Vitest; 100% line, branch, function **and** statement coverage of `src/`; any Node.js process warning or deprecation fails the run                                                                                                                          |
| `npm run audit`        | `npm audit`: no dependency with a known vulnerability, of any severity                                                                                                                                                                                      |

Not part of `npm run check`, but also enforced in CI:

```bash
npm run mutation    # Stryker: every mutant of src/ must be killed (break threshold 100)
npm run outdated    # every dependency at its newest release, except the documented holds
npm run build       # CI fails when the rebuilt dist/ differs from the committed one
```

CI additionally runs rumdl (the markdownlint rules, as a standalone binary: `rumdl check .`, install with `pip install rumdl` or `cargo install rumdl`), actionlint, ShellCheck, zizmor (pedantic), typos, gitleaks (full history), `npm audit signatures`, Dependency review, CodeQL and `npm run scorecard`: every package of the lock file must come from a repository with an OpenSSF Scorecard of at least 3, unless `script/scorecard.json` allows it with the reason it cannot be removed. The tests run on the Node.js of `.node-version` and on the newest Node.js release.

Mutation runs take a few minutes. While iterating, mutate one file at a time, e.g. `npx stryker run --mutate src/utils.ts`.

## Rules

- **No inline suppressions.** Nothing may silence a linter, scanner, type checker, warning or test in place: no `eslint-disable` (ESLint also runs with `noInlineConfig`), `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`, `any`, `as unknown as`, non-null assertions, `istanbul`/`c8`/`v8 ignore`, `Stryker disable`, `prettier-ignore`, `markdownlint-disable`/`rumdl-disable`, `jscpd:ignore`, `gitleaks:allow`, `nosec`, `--no-warnings`/`--no-deprecation`, `.skip`/`.only`/`.todo`, and so on. Fix the cause. A rule that cannot apply to a file is configured narrowly in the tool's configuration file, with the reason written next to it. `script/forbidden_suppressions.sh` enforces this in CI and in the pre-commit hook.
- **No warnings.** Tests fail on any Node.js process warning; npm scripts run with `--throw-deprecation`. Every workflow ends with a "Warning gate" job (`script/warning_gate.sh`) that fails the run when the log of any job contains a warning or a deprecation notice.
- **Behavior is specified.** Every behavioral fix needs a regression test, and every surviving mutant needs a test that kills it (or, when the mutation cannot change observable behavior, simpler code).
- **Dependencies are current.** Dependencies are pinned to exact versions. `npm run outdated` (`script/outdated.ts`) fails for any dependency, override, GitHub Action or CI tool that is not at its newest release, unless `script/outdated.json` lists it as a hold with the reason; a hold whose reason no longer applies fails too. GitHub Actions are pinned to the full commit SHA of their newest release tag.
- Keep `REQUIREMENTS.md` in sync with behavior changes — it is the single source of truth (requirements are referenced as `ECS-REQ-###` in code comments and test names).
- Dependency changes must keep `package-lock.json` resolving exclusively to `https://registry.npmjs.org` (CI enforces this).
- Update `CHANGELOG.md` for user-visible changes.

## The committed `dist/` bundle

This repository ships its compiled bundle: the code consumers execute is the **committed** `dist/index.js`, not `src/`. After changing anything under `src/` or the dependencies you must run:

```bash
npm run build
git add dist
```

CI rebuilds `dist/` from source and fails the PR if the committed bundle does not match, and smoke-tests the packaged bundle to prove it executes. The build script cleans `dist/` first, so stale files are also detected.

The pre-commit hook (husky) runs lint, format check, typecheck, the suppression check, tests and the build, and fails the commit if `dist/` is out of date — it intentionally does **not** auto-stage `dist/`; review and stage it yourself.

## Releases

Releases are cut by pushing a `v*` tag. The release workflow re-runs all quality gates (including mutation testing), verifies the tagged `dist/` matches a clean rebuild, and then publishes a GitHub release. The floating `v1` major tag is advanced to the released commit.

## Code of Conduct

Everyone interacting with this project is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
