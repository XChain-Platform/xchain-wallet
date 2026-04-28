// @xchain ESLint plugin — bundles the wallet's custom rules so a
// project-level `.eslintrc.cjs` can enable them with one entry under
// `plugins`. Today there's exactly one rule (no-jsx-literal-strings)
// from §54 / G172; the plugin can grow as more wallet-specific rules
// land.
//
// Wiring (in a project-level .eslintrc.cjs):
//
//   module.exports = {
//       plugins: ['@xchain'],
//       rules: { '@xchain/no-jsx-literal-strings': ['warn', { allow: ['…'] }] },
//   };
//
// The plugin is intentionally not enforced in CI today — per project
// memory the wallet has no CI workflow during the build phase. Drop
// the rule into a developer's local config or run
//   npx eslint --rule '{"@xchain/no-jsx-literal-strings": "warn"}' …
// to spot violations.

import noJsxLiteralStrings from './rules/no-jsx-literal-strings.js';

export default {
    rules: {
        'no-jsx-literal-strings': noJsxLiteralStrings,
    },
};
