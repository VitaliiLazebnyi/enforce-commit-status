# Contributing

Thanks for your interest in improving `enforce-commit-status`!

## Development Setup

Requires Node.js 24 (matching the action's runtime).

```bash
npm ci
npm run lint        # ESLint
npm run format:check # Prettier
npm run typecheck   # tsc --noEmit
npm test            # Jest (100% coverage enforced)
npm run build       # ncc bundle into dist/
```

## The committed `dist/` bundle

This repository ships its compiled bundle: the code consumers execute is the **committed** `dist/index.js`, not `src/`. After changing anything under `src/` or the dependencies you must run:

```bash
npm run build
git add dist
```

CI rebuilds `dist/` from source and fails the PR if the committed bundle does not match (`Verify Clean Repository` step), and smoke-tests the packaged bundle to prove it executes. The build script cleans `dist/` first, so stale files are also detected.

The pre-commit hook (husky) runs lint, format check, typecheck, tests, and the build, and fails the commit if `dist/` is out of date — it intentionally does **not** auto-stage `dist/`; review and stage it yourself.

## Pull Requests

- Keep `REQUIREMENTS.md` in sync with behavior changes — it is the single source of truth (requirements are referenced as `ECS-REQ-###` in code comments and test names).
- Add or update tests for every behavior change; coverage thresholds are 100% across the board and include `src/main.ts`.
- Dependency changes must keep `package-lock.json` resolving exclusively to `https://registry.npmjs.org` (CI enforces this).

## Releases

Releases are cut by pushing a `v*` tag. The release workflow re-runs all quality gates, verifies the tagged `dist/` matches a clean rebuild, and then publishes a GitHub release. The floating `v1` major tag is advanced to the released commit.
