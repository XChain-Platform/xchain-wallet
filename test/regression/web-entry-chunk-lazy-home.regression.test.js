// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: web entry chunk lazy routes.
//
//   [P1] 2026-10-13: Static route imports pull Home, Settings, and the
//        hardware-signer graph into the web entry chunk, exceeding its
//        1,000,000 byte budget.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(
    join(here, '..', '..', 'packages', 'web', 'src', 'App.jsx'),
    'utf8',
);
const appAst = parse(appSource, { sourceType: 'module', plugins: ['jsx'] });
const eagerImports = appAst.program.body
    .filter((statement) => statement.type === 'ImportDeclaration')
    .map((statement) => statement.source.value);

const lazyRoutes = [
    ['Home', '@xchain-wallet/core/shared/routes/Home.jsx'],
    ['Settings', '@xchain-wallet/core/shared/routes/Settings.jsx'],
    ['PairSignerForm', '@xchain-wallet/core/shared/routes/PairSignerForm.jsx'],
];

const lazySignerFactories = [
    ['pairTrezorSigner', 'trezor', './signers/trezorFactory.js'],
    ['pairLedgerSigner', 'ledger', './signers/ledgerFactory.js'],
];

describe('regression/web-entry-chunk-lazy-home', () => {
    it('[REGRESSION P1] keeps Home and Settings behind lazy route imports', () => {
        for (const [routeName, modulePath] of lazyRoutes.slice(0, 2)) {
            expect(eagerImports).not.toContain(modulePath);
            expect(appSource).toContain(
                `const ${routeName} = lazyRoute(() => import('${modulePath}'), '${routeName}');`,
            );
        }
    });

    it('[REGRESSION P1] keeps signer UI and hardware factories out of the entry chunk', () => {
        const [routeName, routePath] = lazyRoutes[2];
        expect(eagerImports).not.toContain(routePath);
        expect(appSource).toContain(
            `const ${routeName} = lazyRoute(() => import('${routePath}'), '${routeName}');`,
        );

        // Each factory is imported on first pairing through the tracker that
        // resets the loaded ones on lock, never from the entry chunk.
        for (const [factoryName, vendor, modulePath] of lazySignerFactories) {
            expect(eagerImports).not.toContain(modulePath);
            expect(appSource).toContain(`    ${vendor}: () => import('${modulePath}'),`);
            expect(appSource).toContain(
                `const ${factoryName} = (...args) => hardwareFactories.load('${vendor}')`,
            );
        }
    });
});
