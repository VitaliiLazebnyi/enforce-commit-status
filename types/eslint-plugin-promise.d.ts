// eslint-plugin-promise ships no type definitions; this declares the part eslint.config.js uses.
declare module 'eslint-plugin-promise' {
  import type { ESLint, Linter } from 'eslint';

  const plugin: ESLint.Plugin & {
    configs: { 'flat/recommended': Linter.Config };
  };
  export default plugin;
}
