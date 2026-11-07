/**
 * @file Type definitions of eslint-plugin-promise, which ships none: the part eslint.config.js
 * uses.
 */
declare module 'eslint-plugin-promise' {
  import type { ESLint, Rule } from 'eslint';

  const plugin: ESLint.Plugin & { rules: Readonly<Record<string, Rule.RuleModule>> };
  export default plugin;
}
