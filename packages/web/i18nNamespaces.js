// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy loads by namespace: a module that renders `send.*` keys
// carries `import '.../i18n/locales/en/send.js'`, and that file registers
// itself when it runs. Rollup keeps the side effects of every module the
// entry reaches, even a module the entry reaches only through a barrel and
// tree-shakes to nothing, so a component that first paint never renders would
// still pull its namespace into the initial bundle. Wallet modules that import
// a namespace have no other top-level side effects
// (test/unit/i18n/namespaceImports.test.js holds that), so marking them
// side-effect free lets Rollup drop an unused module together with its
// namespace import, while a module that is used keeps both.

const NAMESPACE_IMPORT = /^import '[^']*i18n\/locales\/en\/[^']+\.js';$/m;

export const i18nNamespacePlugin = {
    name: 'xchain-i18n-namespace-side-effects',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
        const path = id.replace(/\\/g, '/');
        if (path.includes('/node_modules/') || path.includes('/i18n/locales/')) return null;
        if (!NAMESPACE_IMPORT.test(code)) return null;
        return { code, map: null, moduleSideEffects: false };
    },
};
