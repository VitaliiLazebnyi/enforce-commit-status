/**
 * @file ESLint configuration: every rule of ESLint, typescript-eslint and every plugin is an error.
 * The few rules that are off, or configured away from their defaults, say why next to them.
 */
import { everyRule, namingConvention } from './eslint/rules.ts';
import { defineConfig } from 'eslint/config';
import eslint from '@eslint/js';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import jsdoc from 'eslint-plugin-jsdoc';
import nodePlugin from 'eslint-plugin-n';
import prettierConfig from 'eslint-config-prettier';
import promise from 'eslint-plugin-promise';
import regexp from 'eslint-plugin-regexp';
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';
import vitest from '@vitest/eslint-plugin';

const testFiles = ['test/**/*.ts'];
const javaScriptFiles = ['**/*.js', '**/*.mjs'];
const typeScriptFiles = ['**/*.ts'];
const sourceFiles = ['src/**/*.ts'];

export default defineConfig(
  {
    // Generated output only: the bundle, coverage and mutation reports.
    ignores: ['dist/', 'coverage/', 'reports/', '.stryker-tmp/']
  },
  {
    linterOptions: {
      /*
       * Inline configuration comments are not honored anywhere: fix the cause or configure the
       * rule in this file with the reason next to it.
       */
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
      reportUnusedInlineConfigs: 'error'
    }
  },
  eslint.configs.all,
  /*
   * Every typescript-eslint rule; it also switches off the core rules it replaces with type-aware
   * versions (and the ones TypeScript itself checks, such as no-undef).
   */
  tseslint.configs.all,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      '@eslint-community/eslint-comments': eslintComments,
      jsdoc,
      node: nodePlugin,
      promise,
      regexp,
      unicorn
    },
    rules: {
      ...everyRule('@eslint-community/eslint-comments', eslintComments.rules),
      ...everyRule('jsdoc', jsdoc.rules),
      ...everyRule('node', nodePlugin.rules),
      ...everyRule('promise', promise.rules),
      ...everyRule('regexp', regexp.rules),
      ...everyRule('unicorn', unicorn.rules)
    },
    settings: {
      // The action runs on the node24 runtime of the GitHub Actions runner (see action.yml).
      node: { version: '>=24.0.0' }
    }
  },
  {
    files: testFiles,
    /*
     * The setup file is not a test: Vitest loads it before every test file to register a process
     * listener. vitest/require-hook would move that registration into a hook, which
     * vitest/no-hooks forbids.
     */
    ignores: ['test/setup/**'],
    plugins: { vitest },
    rules: everyRule('vitest', vitest.rules)
  },
  {
    rules: {
      // Configured: the options choose a style without loosening the rule.
      '@typescript-eslint/consistent-type-definitions': [
        'error',
        /*
         * Only type aliases are assignable to the index-signature parameter types of Octokit's
         * methods (an interface gets no implicit index signature), so object types are aliases.
         */
        'type'
      ],
      /*
       * TypeScript's noPropertyAccessFromIndexSignature (tsconfig.json) requires the bracket
       * notation for the properties of an index signature; the rule's own option agrees with it.
       */
      '@typescript-eslint/dot-notation': ['error', { allowIndexSignaturePropertyAccess: true }],
      '@typescript-eslint/naming-convention': namingConvention,
      '@typescript-eslint/prefer-readonly-parameter-types': [
        'error',
        /*
         * The built-in types that lib declares with methods, which the rule cannot see are only
         * read here: a promise is only subscribed to, the read-only collections have no mutating
         * method, a pattern is only matched (matchAll copies it), and a match is only read.
         */
        {
          allow: [
            {
              from: 'lib',
              name: ['Promise', 'ReadonlyMap', 'ReadonlySet', 'RegExp', 'RegExpExecArray']
            }
          ]
        }
      ],
      // A comment line that continues the previous one continues its sentence.
      'capitalized-comments': ['error', 'always', { ignoreConsecutiveComments: true }],
      'func-style': ['error', 'declaration'],
      // Jsdoc/require-rejects asks for the @rejects tag of async functions; it is not a standard
      // JSDoc tag, so jsdoc/check-tag-names has to be told about it.
      'jsdoc/check-tag-names': ['error', { definedTags: ['rejects'] }],
      // The JSDoc text is Markdown (`code`, links), so HTML is escaped, not Markdown.
      'jsdoc/text-escaping': ['error', { escapeHTML: true }],
      'one-var': ['error', 'never']
    }
  },
  {
    // Off: each of these forbids what another enabled rule requires, or cannot apply here.
    rules: {
      // Camelcase is superseded by @typescript-eslint/naming-convention, which knows types.
      camelcase: 'off',
      /*
       * Jsdoc/check-examples does not run on ESLint 8 or newer (it reports exactly that on every
       * file); with the examples unverifiable, jsdoc/require-example would only add examples that
       * can silently go stale. The tests are the executable examples of every function.
       */
      'jsdoc/check-examples': 'off',
      /*
       * These jsdoc rules enforce a project-defined pattern given in their options (a tag list, a
       * name pattern, a selector); with none to give, they only report their missing option.
       */
      'jsdoc/match-name': 'off',
      'jsdoc/no-missing-syntax': 'off',
      'jsdoc/no-restricted-syntax': 'off',
      'jsdoc/require-example': 'off',
      'jsdoc/require-tags': 'off',
      // No-ternary forbids the conditional expressions unicorn/prefer-ternary asks for.
      'no-ternary': 'off',
      /*
       * No-undefined forbids `undefined` and unicorn/no-null forbids `null`: with both, an absent
       * value cannot be written. TypeScript's optional values are `undefined`.
       */
      'no-undefined': 'off',
      /*
       * Node/no-top-level-await forbids the top-level await unicorn/prefer-top-level-await asks
       * for (the scripts and the entrypoint are ES modules).
       */
      'node/no-top-level-await': 'off',
      /*
       * Promise/no-native asks for a userland Promise library instead of the native Promise that
       * async/await is built on.
       */
      'promise/no-native': 'off',
      // JSDoc lines start with `*` (jsdoc/require-asterisk-prefix); unicorn forbids that prefix.
      'unicorn/no-asterisk-prefix-in-documentation-comments': 'off',
      /*
       * Comments are wrapped at the 100-character line limit (.editorconfig); this rule asks for
       * unwrapped comment paragraphs instead.
       */
      'unicorn/no-manually-wrapped-comments': 'off',
      // Temporal is not available on the node24 runtime the action runs on (action.yml).
      'unicorn/prefer-temporal': 'off'
    }
  },
  {
    /*
     * The polling loop is sequential by requirement (ECS-REQ-019: a deterministic loop, no
     * recursion): each request waits for the previous poll and the sleep that follows it, and each
     * nested tag is only known from the previous one.
     */
    files: sourceFiles,
    rules: { 'no-await-in-loop': 'off' }
  },
  {
    /*
     * TypeScript files carry their types in the signatures: JSDoc types are forbidden
     * (jsdoc/no-types), so the rules that require them are off.
     */
    files: typeScriptFiles,
    rules: {
      'jsdoc/require-next-type': 'off',
      'jsdoc/require-param-type': 'off',
      'jsdoc/require-property-type': 'off',
      'jsdoc/require-returns-type': 'off',
      'jsdoc/require-throws-type': 'off',
      'jsdoc/require-yields-type': 'off'
    }
  },
  {
    /*
     * JavaScript files are type-checked through their JSDoc types (tsconfig checkJs), so the
     * types are required there and jsdoc/no-types is off.
     */
    files: javaScriptFiles,
    rules: { 'jsdoc/no-types': 'off' }
  },
  {
    files: testFiles,
    rules: {
      /*
       * A test's literal inputs and expected values are its specification: naming each one would
       * hide the value under test behind a constant.
       */
      '@typescript-eslint/no-magic-numbers': 'off',
      // The tests feed the action the `null` values that the GitHub API and JavaScript produce (a
      // null conclusion or status, a thrown null).
      'unicorn/no-null': 'off'
    }
  },
  {
    files: testFiles,
    ignores: ['test/setup/**'],
    plugins: { vitest },
    rules: {
      // Contradicts vitest/prefer-importing-vitest-globals (enabled).
      'vitest/no-importing-vitest-globals': 'off',
      // Contradicts vitest/prefer-called-once (enabled).
      'vitest/prefer-called-times': 'off',
      // Requirement ids (ECS-REQ-###) are upper case; the rest of every title is lower case.
      'vitest/prefer-lowercase-title': ['error', { allowedPrefixes: ['ECS-REQ'] }],
      // Contradicts vitest/prefer-strict-boolean-matchers (enabled).
      'vitest/prefer-to-be-falsy': 'off',
      // Contradicts vitest/prefer-strict-boolean-matchers (enabled).
      'vitest/prefer-to-be-truthy': 'off'
    }
  },
  prettierConfig,
  {
    /*
     * Eslint-config-prettier switches these off as "special rules"; in these forms they never
     * conflict with Prettier.
     */
    rules: {
      curly: ['error', 'all'],
      'no-unexpected-multiline': 'error'
    }
  }
);
