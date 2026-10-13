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
const nativeVaultSource = readFileSync(
    resolve(process.cwd(), 'packages/web/src/storage/nativeVault.js'),
    'utf8',
);
const messagingSource = readFileSync(
    resolve(process.cwd(), 'packages/web/src/messaging.js'),
    'utf8',
);

const deferredRoutes = [
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
    'AddAccountForm',
    'WalletPicker',
    'AccountPicker',
    'WalletDetails',
    'RenameWalletForm',
    'RenameAccountForm',
    'MenuRoute',
    'AlertsRoute',
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

    it('keeps every cold-start route synchronous', () => {
        for (const routeName of ['Onboarding', 'Locked', 'Home']) {
            expect(appSource).toContain(
                `import { ${routeName} } from '@xchain-wallet/core/shared/routes/${routeName}.jsx';`,
            );
            expect(appSource).not.toContain(`const ${routeName} = lazyRoute(`);
        }
    });

    it('loads the QR encoder only when the private-key route renders it', () => {
        expect(appSource).toContain(
            "import { Skeleton } from '@xchain-wallet/core/ui/Skeleton.jsx';",
        );
        expect(appSource).not.toContain("from '@xchain-wallet/core/ui';");
        expect(appSource).toContain(
            "const KeyQR = lazyRoute(() => import('@xchain-wallet/core/shared/components/KeyQR.jsx'), 'KeyQR');",
        );
        expect(appSource).not.toContain(
            "import { KeyQR } from '@xchain-wallet/core/shared/components/KeyQR.jsx';",
        );
    });

    it('loads the in-page background host through one cached dynamic import', () => {
        expect(messagingSource).toContain("import('./hostBridge.js')");
        expect(messagingSource).toContain('hostBridgePromise ??=');
        expect(messagingSource).not.toMatch(/from ['"]\.\/hostBridge\.js['"]/);
    });

    it('defers command-palette demo fixtures until balances are requested', () => {
        expect(appSource).toContain(
            "import { isDemoWallet } from '../../core/src/flows/demoMode.js';",
        );
        expect(appSource).not.toContain("from '@xchain-wallet/core/flows'");
        expect(appSource).toContain(
            "import('@xchain-wallet/core/shared/utils/displayBalances.js')",
        );
        expect(appSource).toContain(
            "import('@xchain-wallet/core/shared/components/BalanceList.jsx')",
        );
        expect(appSource).not.toMatch(
            /import \{ loadDisplayBalances \} from '@xchain-wallet\/core\/shared\/utils\/displayBalances\.js'/,
        );
        expect(appSource).not.toMatch(
            /import \{ buildBalanceRows \} from '@xchain-wallet\/core\/shared\/components\/BalanceList\.jsx'/,
        );
    });

    it('keeps the native boot check off the aggregate core barrel', () => {
        expect(nativeVaultSource).not.toContain("from '@xchain-wallet/core'");
        expect(nativeVaultSource).toContain("from '../../../core/src/storage/backend.js'");
        expect(nativeVaultSource).toContain("from '../../../core/src/crypto/kdf.js'");
    });
});
