// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// @xchain ESLint plugin: bundles the wallet's custom rules so a flat
// config can enable them by registering this module under one key.
// Today there's exactly one rule (no-jsx-literal-strings) from
// §54 / G172; the plugin can grow as more wallet-specific rules land.
//
// Wiring (a flat `eslint.config.js` at the repo root):
//
//   import xchain from './tools/eslint/plugin.js';
//
//   export default [
//       {
//           files: ['**/*.{js,jsx}'],
//           languageOptions: {
//               ecmaVersion: 2023,
//               sourceType: 'module',
//               parserOptions: { ecmaFeatures: { jsx: true } },
//           },
//           plugins: { '@xchain': xchain },
//           rules: {
//               '@xchain/no-jsx-literal-strings': ['warn', { allow: ['…'] }],
//           },
//       },
//   ];
//
// The plugin has to be REGISTERED as an object, and there is no CLI
// shortcut for it. An eslintrc `plugins: ['@xchain']` shortname resolves
// to an installed npm package `@xchain/eslint-plugin` and fails with
// "ESLint couldn't find the plugin", never to a repo-relative file; the
// same is true of `eslint --rule '{"@xchain/…": "warn"}'` with nothing
// registered ("Definition for rule … was not found"). An eslintrc could
// not `require()` this file either, since the package is
// `"type": "module"`. The `ecmaFeatures.jsx` option is load-bearing:
// without it every .jsx file fails to parse before the rule ever runs.
//
// No flat config is checked in and eslint is not a devDependency: the
// rule is intentionally unenforced, since the wallet has no CI workflow
// during the build phase. A developer who wants it writes the config
// above locally and points eslint at it.

import noJsxLiteralStrings from './rules/no-jsx-literal-strings.js';

export default {
    rules: {
        'no-jsx-literal-strings': noJsxLiteralStrings,
    },
};
