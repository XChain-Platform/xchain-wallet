// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the Phase-2 shared-routes refactor (§40 batch 1 piece 1).
//
// Asserts that:
//   1. @xchain-wallet/core/shared/{MessagingProvider,useMessaging,routes/*}
//      resolve from the package's exports map.
//   2. Each shared route calls its messaging helper via
//      `messaging.<name>` (not a direct import) — the signal that the
//      route is shell-agnostic.
//   3. Each route drives `Screen`'s variant from `screenVariantFor(shell)`
//      so popup + web render under the correct layout.
//   4. Both popup + web App.jsx wrap the router in <MessagingProvider>
//      with the right shell value.
//   5. The popup-local + web-local routes + their old component siblings
//      (MnemonicGrid, ChainBalanceCard, useAutoLock) are gone — regressing
//      to per-shell duplication would break the smoke.

import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');

// --- 1. Core package exports map ------------------------------------

const corePkg = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8'));
assert.equal(corePkg.exports['./shared'], './src/shared/index.js',
    'core exports "./shared"');
assert.equal(corePkg.exports['./shared/*'], './src/shared/*',
    'core exports "./shared/*"');

// --- 2. Shared surface files exist ---------------------------------

for (const rel of [
    'src/shared/MessagingContext.js',
    'src/shared/MessagingProvider.jsx',
    'src/shared/useMessaging.js',
    'src/shared/index.js',
    'src/shared/hooks/useAutoLock.js',
    'src/shared/components/MnemonicGrid.jsx',
    'src/shared/components/MnemonicGrid.module.css',
    'src/shared/components/ChainBalanceCard.jsx',
    'src/shared/components/ChainBalanceCard.module.css',
    'src/shared/routes/Loading.jsx',
    'src/shared/routes/Loading.module.css',
    'src/shared/routes/Onboarding.jsx',
    'src/shared/routes/Onboarding.module.css',
    'src/shared/routes/CreateWallet.jsx',
    'src/shared/routes/CreateWallet.module.css',
    'src/shared/routes/ImportWallet.jsx',
    'src/shared/routes/ImportWallet.module.css',
    'src/shared/routes/Locked.jsx',
    'src/shared/routes/Locked.module.css',
    'src/shared/routes/Home.jsx',
    'src/shared/routes/Home.module.css',
    'src/shared/routes/Send.jsx',
    'src/shared/routes/Send.module.css',
    'src/shared/routes/Receive.jsx',
    'src/shared/routes/Receive.module.css',
    'src/shared/routes/TokenWizard.jsx',
    'src/shared/routes/TokenWizard.module.css',
]) {
    assert.ok(existsSync(join(core, rel)), `shared file exists: ${rel}`);
}

// --- 3. MessagingProvider + useMessaging ----------------------------

const providerSrc = readFileSync(
    join(core, 'src', 'shared', 'MessagingProvider.jsx'), 'utf8',
);
assert.ok(
    providerSrc.includes('MessagingContext.Provider'),
    'MessagingProvider renders MessagingContext.Provider',
);
assert.ok(
    /shell,\s*messaging/.test(providerSrc),
    'MessagingProvider passes { shell, messaging } as the value',
);

const hookSrc = readFileSync(
    join(core, 'src', 'shared', 'useMessaging.js'), 'utf8',
);
assert.ok(
    /useMessaging must be used inside <MessagingProvider>/.test(hookSrc),
    'useMessaging throws when consumed outside a provider',
);
assert.ok(
    /export function screenVariantFor/.test(hookSrc),
    'useMessaging.js exports screenVariantFor helper',
);

// --- 4. Every shared route routes through the context --------------

const sharedRoutes = join(core, 'src', 'shared', 'routes');
const routeMessagingCalls = {
    Loading: [],
    Onboarding: [],
    Locked: ['messaging.unlockWallet'],
    CreateWallet: ['messaging.importMnemonic'],
    ImportWallet: ['messaging.importMnemonic'],
    Home: [
        'messaging.listWallets',
        'messaging.getWalletBalances',
        'messaging.lockWallet',
    ],
    Send: [
        'messaging.sendToken',
        'messaging.getAddressesByChain',
    ],
    Receive: [
        'messaging.getAddressesByChain',
        'messaging.getNewestAddress',
        'messaging.generateReceiveAddress',
    ],
    TokenWizard: [
        'messaging.getAddressesByChain',
        'messaging.issueToken',
    ],
};
for (const [route, calls] of Object.entries(routeMessagingCalls)) {
    const src = readFileSync(join(sharedRoutes, `${route}.jsx`), 'utf8');
    assert.ok(
        src.includes('useMessaging'),
        `shared ${route}.jsx reads context via useMessaging`,
    );
    // Loading + Onboarding don't call any messaging helpers — skip
    // the per-call assertions for those.
    for (const call of calls) {
        assert.ok(
            src.includes(call),
            `shared ${route}.jsx invokes ${call}`,
        );
    }
    assert.ok(
        /screenVariantFor/.test(src),
        `shared ${route}.jsx derives Screen variant from shell`,
    );
}

// --- 5. Both shells wrap in <MessagingProvider> --------------------

const popupApp = readFileSync(join(ext, 'src', 'popup', 'App.jsx'), 'utf8');
assert.ok(
    popupApp.includes('MessagingProvider') && popupApp.includes('shell="popup"'),
    'popup App.jsx wraps in <MessagingProvider shell="popup">',
);
assert.ok(
    /import\s+\*\s+as\s+messaging/.test(popupApp),
    'popup App.jsx imports the messaging module namespace',
);
for (const route of [
    'Loading', 'Onboarding', 'CreateWallet', 'ImportWallet',
    'Locked', 'Home', 'Receive', 'Send', 'TokenWizard',
]) {
    assert.ok(
        popupApp.includes(
            `@xchain-wallet/core/shared/routes/${route}.jsx`,
        ),
        `popup App.jsx imports shared ${route}`,
    );
}

const webApp = readFileSync(join(web, 'src', 'App.jsx'), 'utf8');
assert.ok(
    webApp.includes('MessagingProvider') && webApp.includes('shell="web"'),
    'web App.jsx wraps in <MessagingProvider shell="web">',
);
assert.ok(
    /import\s+\*\s+as\s+messaging/.test(webApp),
    'web App.jsx imports the messaging module namespace',
);
for (const route of [
    'Loading', 'Onboarding', 'CreateWallet', 'ImportWallet',
    'Locked', 'Home', 'Receive', 'Send', 'TokenWizard',
]) {
    assert.ok(
        webApp.includes(
            `@xchain-wallet/core/shared/routes/${route}.jsx`,
        ),
        `web App.jsx imports shared ${route}`,
    );
}
assert.ok(
    webApp.includes('<ExtensionBanner'),
    'web App.jsx keeps ExtensionBanner at the App wrapper level',
);

// --- 6. Old per-shell route files are gone -------------------------

for (const gone of [
    'packages/extension/src/popup/routes/Locked.jsx',
    'packages/extension/src/popup/routes/Home.jsx',
    'packages/extension/src/popup/routes/Receive.jsx',
    'packages/extension/src/popup/routes/CreateWallet.jsx',
    'packages/extension/src/popup/routes/ImportWallet.jsx',
    'packages/extension/src/popup/routes/Onboarding.jsx',
    'packages/extension/src/popup/routes/Loading.jsx',
    'packages/extension/src/popup/components/MnemonicGrid.jsx',
    'packages/extension/src/popup/components/ChainBalanceCard.jsx',
    'packages/extension/src/popup/hooks/useAutoLock.js',
    'packages/web/src/routes/Locked.jsx',
    'packages/web/src/routes/Home.jsx',
    'packages/web/src/routes/Send.jsx',
    'packages/web/src/routes/CreateWallet.jsx',
    'packages/web/src/routes/ImportWallet.jsx',
    'packages/web/src/routes/Onboarding.jsx',
    'packages/web/src/routes/Loading.jsx',
    'packages/web/src/components/MnemonicGrid.jsx',
]) {
    assert.ok(
        !existsSync(join(wsRoot, gone)),
        `${gone} must be deleted (hoisted to shared)`,
    );
}

// --- 7. Messaging modules expose the full shared surface -----------

const popupMsg = readFileSync(join(ext, 'src', 'popup', 'messaging.js'), 'utf8');
const webMsg = readFileSync(join(web, 'src', 'messaging.js'), 'utf8');
const requiredExports = [
    'unlockWallet',
    'lockWallet',
    'listWallets',
    'getWalletBalances',
    'getAddressesByChain',
    'getNewestAddress',
    'generateReceiveAddress',
    'createWallet',
    'importMnemonic',
    'sendToken',
];
for (const fn of requiredExports) {
    assert.ok(
        new RegExp(`export function ${fn}\\b`).test(popupMsg),
        `popup messaging.js exports ${fn}`,
    );
    assert.ok(
        new RegExp(`export function ${fn}\\b`).test(webMsg),
        `web messaging.js exports ${fn}`,
    );
}

console.log(
    'OK — shared-routes smoke (provider + hook + 8 routes + both shells wired + legacy files removed)',
);
