// @ts-check
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import eslint from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import prettierConfig from 'eslint-config-prettier';
import jsdoc from 'eslint-plugin-jsdoc';
import nodePlugin from 'eslint-plugin-n';
import promise from 'eslint-plugin-promise';
import regexp from 'eslint-plugin-regexp';
import unicorn from 'eslint-plugin-unicorn';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    // Generated output only: the bundle, coverage and mutation reports.
    ignores: ['dist/', 'coverage/', 'reports/', '.stryker-tmp/']
  },
  {
    linterOptions: {
      // Inline configuration comments are not honored anywhere: fix the cause or
      // configure the rule in this file with the reason next to it.
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
      reportUnusedInlineConfigs: 'error'
    }
  },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  nodePlugin.configs['flat/recommended-module'],
  promise.configs['flat/recommended'],
  regexp.configs['flat/recommended'],
  // The opinionated half of unicorn (naming, null vs undefined, comment style) conflicts with the
  // GitHub API's own vocabulary (`repo`, `null` conclusions) and with JSDoc; every correctness rule
  // is in `unopinionated`.
  unicorn.configs.unopinionated,
  eslintComments.recommended,
  { files: ['**/*.ts'], ...jsdoc.configs['flat/recommended-typescript-error'] },
  { files: ['**/*.js', '**/*.mjs'], ...jsdoc.configs['flat/recommended-typescript-flavor-error'] },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    settings: {
      // The action runs on the node24 runtime of the GitHub Actions runner (see action.yml).
      node: { version: '>=24.0.0' }
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/no-unnecessary-qualifier': 'error',
      '@typescript-eslint/require-array-sort-compare': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/method-signature-style': 'error',
      eqeqeq: 'error',
      'no-console': 'error',
      curly: 'error',
      // Documentation coverage: every function, class and method carries a JSDoc block.
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: false,
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            ClassDeclaration: true,
            ArrowFunctionExpression: false,
            FunctionExpression: false
          }
        }
      ],
      // `n` resolves imports itself; TypeScript (moduleResolution nodenext) already reports
      // unresolvable imports with full knowledge of the `.js` -> `.ts` mapping.
      'n/no-missing-import': 'off',
      // `n` cannot see the devDependencies/dependencies split of type-only imports; knip checks
      // that every import is declared in the right section of package.json.
      'n/no-unpublished-import': 'off'
    }
  },
  {
    files: ['__tests__/**/*.ts'],
    ...vitest.configs.recommended,
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/consistent-test-it': ['error', { fn: 'it', withinDescribe: 'it' }],
      'vitest/no-conditional-expect': 'error',
      'vitest/no-conditional-in-test': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/no-duplicate-hooks': 'error',
      'vitest/no-focused-tests': 'error',
      'vitest/no-test-return-statement': 'error',
      'vitest/prefer-each': 'error',
      'vitest/prefer-hooks-on-top': 'error',
      'vitest/prefer-importing-vitest-globals': 'error',
      'vitest/prefer-spy-on': 'error',
      'vitest/prefer-strict-equal': 'error',
      'vitest/prefer-to-be': 'error',
      'vitest/require-top-level-describe': 'error',
      'vitest/valid-title': 'error'
    }
  },
  prettierConfig
);
