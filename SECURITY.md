# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | ✅        |

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, use [GitHub's private vulnerability reporting](https://github.com/VitaliiLazebnyi/enforce-commit-status/security/advisories/new) to report the issue confidentially. You should receive an acknowledgement within a few days.

This action runs inside third-party CI pipelines with a repository token, so reports about token handling, the committed `dist/` bundle, or dependency compromise are especially appreciated.

## Hardening Recommendations for Consumers

- Pin the action to a full commit SHA rather than a mutable tag.
- Grant the job only `actions: read` and `contents: read` permissions.
