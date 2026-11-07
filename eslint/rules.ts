/**
 * @file Building blocks of the ESLint configuration (eslint.config.ts): the selection of every
 * rule of a plugin, and the naming convention of the code base.
 */
import type { Linter } from 'eslint';

/**
 * The part of a rule's metadata that decides whether the rule is enabled.
 */
type RuleLike = {
  readonly meta?:
    | { readonly deprecated?: unknown; readonly languages?: readonly string[] | undefined }
    | undefined;
};

/**
 * Tells whether a rule is current and applies to JavaScript.
 * @param rule - A rule module of a plugin.
 * @returns Whether the rule is not deprecated and lints JavaScript (or any language).
 */
function isApplicable(rule: RuleLike): boolean {
  const languages = rule.meta?.languages ?? ['*'];
  return (
    rule.meta?.deprecated === undefined && (languages.includes('*') || languages.includes('js/js'))
  );
}

/**
 * Every rule of a plugin that is not deprecated and applies to JavaScript, as an error.
 * @param prefix - The plugin's rule prefix.
 * @param rules - The plugin's rules, by name (a plugin may have none).
 * @returns The rules configuration.
 */
export function everyRule(
  prefix: string,
  rules: Readonly<Record<string, RuleLike>> | undefined
): Linter.RulesRecord {
  const entries: readonly (readonly [string, RuleLike])[] = Object.entries(rules ?? {});
  return Object.fromEntries(
    entries
      .filter(([, rule]) => isApplicable(rule))
      .map(([name]): [string, Linter.RuleEntry] => [`${prefix}/${name}`, 'error'])
  );
}

/*
 * The GitHub REST API's own field and parameter names, which the code reads and sends as they are
 * (snake_case).
 */
const githubApiNames = [
  'created_at',
  'head_sha',
  'html_url',
  'per_page',
  'tag_sha',
  'total_count',
  'workflow_id',
  'workflow_runs'
];

/**
 * The options of `@typescript-eslint/naming-convention`: camelCase, PascalCase types, UPPER_CASE
 * module constants, and the names of the outside world as they are.
 */
export const namingConvention: Linter.RuleEntry = [
  'error',
  {
    format: ['camelCase'],
    leadingUnderscore: 'forbid',
    selector: 'default',
    trailingUnderscore: 'forbid'
  },
  { format: ['camelCase', 'PascalCase'], selector: 'import' },
  // Module-level constants.
  {
    format: ['camelCase', 'UPPER_CASE'],
    modifiers: ['const', 'global'],
    selector: 'variable'
  },
  { format: ['PascalCase'], selector: 'typeLike' },
  // TypeScript's noUnusedParameters accepts an unused parameter only with a leading underscore.
  {
    format: ['camelCase'],
    leadingUnderscore: 'require',
    modifiers: ['unused'],
    selector: 'parameter'
  },
  // The environment variables of GitHub Actions.
  {
    filter: { match: true, regex: '^GITHUB_[A-Z]+$' },
    format: ['UPPER_CASE'],
    selector: 'objectLiteralProperty'
  },
  // The GitHub REST API's names (see githubApiNames).
  {
    filter: { match: true, regex: `^(?:${githubApiNames.join('|')})$` },
    format: ['snake_case'],
    selector: ['objectLiteralProperty', 'typeProperty']
  },
  /*
   * Names that are not identifiers (HTTP headers, action inputs, rule ids) are quoted. An empty
   * format list checks no format.
   */
  {
    format: [],
    modifiers: ['requiresQuotes'],
    selector: ['objectLiteralProperty', 'typeProperty']
  }
];
