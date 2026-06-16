// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

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
