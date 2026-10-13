// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(resolve(process.cwd(), 'packages/web/src/App.jsx'), 'utf8');

const deferredRoutes = [
    'Home',
    'Settings',
    'TokenDetail',
    'Send',
    'History',
    'DispenserDetail',
    'AirdropForm',
    'TokenAdminForm',
    'AddressList',
    'ManageToken',
    'PsbtSignForm',
    'MessagingInbox',
];

describe('web startup imports', () => {
    it.each(deferredRoutes)('loads %s only when its unlocked route renders', (routeName) => {
        expect(appSource).toContain(
            `const ${routeName} = lazyRoute(() => import('@xchain-wallet/core/shared/routes/${routeName}.jsx'), '${routeName}');`,
        );
        expect(appSource).not.toContain(
            `import { ${routeName} } from '@xchain-wallet/core/shared/routes/${routeName}.jsx';`,
        );
    });

    it.each(['CreateWallet', 'ImportWallet', 'PairPartnerWallet'])(
        'defers the secondary onboarding screen %s',
        (routeName) => {
            expect(appSource).toContain(
                `const ${routeName} = lazyRoute(() => import('@xchain-wallet/core/shared/routes/${routeName}.jsx'), '${routeName}');`,
            );
            expect(appSource).toMatch(
                new RegExp(`<Suspense fallback=\\{<Loading />\\}>[\\s\\S]*?<${routeName}\\b`),
            );
        },
    );

    it('keeps the first onboarding and lock screens synchronous', () => {
        for (const routeName of ['Onboarding', 'Locked']) {
            expect(appSource).toContain(
                `import { ${routeName} } from '@xchain-wallet/core/shared/routes/${routeName}.jsx';`,
            );
            expect(appSource).not.toContain(`const ${routeName} = lazyRoute(`);
        }
    });
});
