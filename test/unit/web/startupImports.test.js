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
const paletteHostSource = readFileSync(
    resolve(process.cwd(), 'packages/web/src/CommandPaletteHost.jsx'),
    'utf8',
);
const nativeVaultSource = readFileSync(
    resolve(process.cwd(), 'packages/web/src/storage/nativeVault.js'),
    'utf8',
);
const messagingSource = readFileSync(
    resolve(process.cwd(), 'packages/web/src/messaging.js'),
    'utf8',
);
const dexSource = readFileSync(
    resolve(process.cwd(), 'packages/web/src/surfaces/dex.jsx'),
    'utf8',
);
const marketChartSource = readFileSync(
    resolve(process.cwd(), 'packages/core/src/shared/components/MarketChart.jsx'),
    'utf8',
);
const webMainSource = readFileSync(resolve(process.cwd(), 'packages/web/src/main.jsx'), 'utf8');
const styleGuideMainSource = readFileSync(
    resolve(process.cwd(), 'packages/web/src/style-guide/main.jsx'),
    'utf8',
);

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
    'AddAccountForm',
    'WalletPicker',
    'AccountPicker',
    'WalletDetails',
    'RenameWalletForm',
    'RenameAccountForm',
    'AlertsRoute',
    'ScanRoute',
    'ContractsList',
    'ContractDetail',
    'ContractStakeForm',
    'DeployContractForm',
    'ExecuteContractForm',
    'ContractFundsForm',
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

    it('does not load MenuRoute', () => {
        expect(appSource).not.toContain('MenuRoute');
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

    it('keeps charts, markets, and the style guide outside the initial web graph', () => {
        for (const routeName of ['MarketsList', 'MarketView', 'MarketActivity']) {
            expect(dexSource).toContain(
                `const ${routeName} = lazyRoute(() => import('@xchain-wallet/core/shared/routes/${routeName}.jsx'), '${routeName}');`,
            );
            expect(dexSource).not.toContain(
                `import { ${routeName} } from '@xchain-wallet/core/shared/routes/${routeName}.jsx';`,
            );
        }
        expect(marketChartSource).toContain("await import('lightweight-charts')");
        expect(marketChartSource).not.toMatch(/import .* from ['"]lightweight-charts['"]/);
        expect(webMainSource).not.toContain('StyleGuidePage');
        expect(styleGuideMainSource).toContain("import { StyleGuidePage } from './StyleGuidePage.jsx';");
    });

    it('loads the in-page background host through one cached dynamic import', () => {
        expect(messagingSource).toContain("import('./hostBridge.js')");
        expect(messagingSource).toContain('memoizeRetryablePromise');
        expect(messagingSource).not.toMatch(/from ['"]\.\/hostBridge\.js['"]/);
    });

    it('defers command-palette demo fixtures until balances are requested', () => {
        expect(appSource).toContain(
            "import { useDemoAutoWipe } from '@xchain-wallet/core/shared/hooks/useDemoAutoWipe.js';",
        );
        // demoMode.js has no imports and useDemoAutoWipe already loads it, so the
        // palette's demo check adds nothing to startup.
        expect(appSource).toContain("import { isDemoWallet } from '../../core/src/flows/demoMode.js';");
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

    it.each([
        'packages/core/src/shared/routes/Locked.jsx',
        'packages/core/src/shared/routes/Onboarding.jsx',
        'packages/core/src/shared/hooks/useCoinpayObligations.js',
        'packages/core/src/shared/hooks/useReachability.js',
        'packages/core/src/shared/hooks/useBtcAddressesPresent.js',
        'packages/core/src/shared/components/ReachabilityBanner.jsx',
        'packages/core/src/shared/components/QueuedBroadcastBanner.jsx',
        'packages/desktop/renderer/deepLinkRoute.js',
        'packages/web/src/storage/nativeKdfProvider.js',
    ])('keeps the first-paint module %s off the core and flows barrels', (path) => {
        // One barrel import from any first-paint module puts every flow, the
        // SDK clients and the demo fixtures back in the startup bundle.
        const source = readFileSync(resolve(process.cwd(), path), 'utf8');
        expect(source).not.toMatch(/from '@xchain-wallet\/core(\/flows)?'/);
        expect(source).not.toMatch(/from '(\.\.\/)+(flows\/)?index\.js'/);
    });

    it('loads the command palette, shortcut help and variant badge when first opened', () => {
        expect(appSource).toContain("const loadCommandPaletteHost = () => import('./CommandPaletteHost.jsx');");
        expect(appSource).toContain(
            "const ShortcutHelp = lazyRoute(() => import('@xchain-wallet/core/shared/keyboard/ShortcutHelp.jsx'), 'ShortcutHelp');",
        );
        expect(appSource).toContain(
            "const DevVariantBadge = lazyRoute(() => import('./DevVariantBadge.jsx'), 'DevVariantBadge');",
        );
        expect(appSource).not.toMatch(/from '@xchain-wallet\/core\/shared\/commandPalette\/(CommandPalette\.jsx|commandRegistry\.js)'/);
        expect(appSource).not.toMatch(/from '@xchain-wallet\/core\/shared\/keyboard\/ShortcutHelp\.jsx'/);
        expect(appSource).not.toMatch(/from '\.\/DevVariantBadge\.jsx'/);
    });

    it('wires the wallet menu through the deferred command palette host', () => {
        expect(paletteHostSource).toContain('menu={menu}');
        expect(appSource).toContain('onMenuToggle={palette.togglePalette}');
        expect(appSource).toContain('menuOpen={palette.open}');
        expect(appSource).toContain('hasDexSurface: DEX_SURFACE_ENABLED');
        expect(appSource).toContain('currentView: unlockedView');
        expect(appSource).toContain('onSelect: handleMenuSelect');
        expect(appSource).toContain('onOpenSettings: handleOpenSettings');
        expect(appSource).toContain('onLock: handleNavLock');
    });

    it('keeps web navigation state consistent across menu, sidebar and tab selections', () => {
        expect(appSource).toContain('networkFilter: globalNetworkFilter');
        expect(appSource).not.toContain('shouldResetNetworkFilter');
        expect(appSource).not.toContain('resetNetworkFilterWallets');

        expect(appSource.match(/onSelect=\{handleMenuSelect\}/g)).toHaveLength(2);
        expect(appSource).toContain("if (view === unlockedView) {");
        expect(appSource).toContain('if (main) main.scrollTop = 0;');
        expect(appSource).toContain("const returnView = ROUTE_NAV_SECTIONS[unlockedView] === view ? 'home' : unlockedView;");

        expect(appSource).toContain('setSendPrefill(null);');
        expect(appSource).toContain('setReceivePrefill(null);');
        expect(appSource).toContain("setHistoryInitialQuery('');");
        expect(appSource).toContain('setHistoryInitialFocus(null);');
        expect(appSource).toContain('setDispensersBackTo(returnView);');
        expect(appSource).toContain("if (view === 'contacts' || view === 'lists') {");
        expect(appSource).toContain('setDirectoryReturnView(returnView);');
        expect(appSource).not.toContain("if (view === 'contacts') setFormReturnView");
        expect(appSource).toContain('setAlertsReturnView(returnView);');
        expect(appSource).toContain('setUnlockedView(alertsReturnView);');
    });

    it('loads the action catalogue together with the Actions menu', () => {
        // Every action's label and description is copy only that menu shows.
        expect(appSource).not.toMatch(/from '@xchain-wallet\/core\/shared\/actionEntries\.js'/);
        expect(appSource).toContain("import('@xchain-wallet/core/shared/routes/ActionsMenu.jsx')");
        expect(appSource).toContain("import('@xchain-wallet/core/shared/actionEntries.js')");
        expect(appSource).toContain('const ActionsMenu = lazy(loadActionsMenu);');
        expect(appSource).toContain('entries={(buildActionEntries) => buildActionEntries({');
    });

    it('loads the signed chain-registry sync after first paint', () => {
        // The sync's Ed25519 verifier would otherwise ride the first screen,
        // both from main.jsx and through the registry module first-paint code reads.
        expect(webMainSource).toContain("import('../../core/src/registry/remote.js')");
        expect(webMainSource).not.toMatch(/from '\.\.\/\.\.\/core\/src\/registry\/remote\.js'/);
        const registryIndexSource = readFileSync(
            resolve(process.cwd(), 'packages/core/src/registry/index.js'),
            'utf8',
        );
        expect(registryIndexSource).not.toMatch(/from '\.\/remote\.js'/);
    });

    it('loads the demo fixtures only when a demo wallet is entered', () => {
        const onboardingSource = readFileSync(
            resolve(process.cwd(), 'packages/core/src/shared/routes/Onboarding.jsx'),
            'utf8',
        );
        expect(onboardingSource).toContain("await import('../../flows/demoFixtures.js')");
        expect(onboardingSource).not.toMatch(/from '\.\.\/\.\.\/flows\/demoFixtures\.js'/);
    });

    it('keeps the native boot check off the aggregate core barrel', () => {
        expect(nativeVaultSource).not.toContain("from '@xchain-wallet/core'");
        expect(nativeVaultSource).toContain("from '../../../core/src/storage/backend.js'");
        expect(nativeVaultSource).toContain("from '../../../core/src/crypto/kdf.js'");
    });
});
