// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';
import webAppSource from '../../packages/web/src/App.jsx?raw';
import webDexSource from '../../packages/web/src/surfaces/dex.jsx?raw';
import webMessagingSource from '../../packages/web/src/messaging.js?raw';
import desktopAppSource from '../../packages/desktop/renderer/App.jsx?raw';
import desktopMessagingSource from '../../packages/desktop/renderer/messaging.js?raw';
import extensionAppSource from '../../packages/extension/src/popup/App.jsx?raw';
import extensionMessagingSource from '../../packages/extension/src/popup/messaging.js?raw';
import {
    defaultDexAssetForNetwork,
    syncDexAssetToNetwork,
} from '../../packages/core/src/shared/chainSelection.js';

const SHELLS = {
    web: {
        app: webAppSource,
        routeSources: [webAppSource, webDexSource],
        messaging: webMessagingSource,
    },
    desktop: {
        app: desktopAppSource,
        routeSources: [desktopAppSource],
        messaging: desktopMessagingSource,
    },
    extension: {
        app: extensionAppSource,
        routeSources: [extensionAppSource],
        messaging: extensionMessagingSource,
    },
};

const SHELL_ONLY = {
    routes: {
        menu: {
            shells: ['web'],
            reason: 'The compact web layout uses a full-screen overflow menu; desktop and popup expose its destinations directly.',
        },
        alerts: {
            shells: ['web'],
            reason: 'The alerts screen belongs to the compact web overflow menu; desktop and popup surface alerts on Home.',
        },
    },
    messaging: {
        reportAutoLock: {
            shells: ['desktop', 'extension'],
            reason: 'Desktop and extension keys outlive their renderers, while closing the plain web tab already clears its in-memory key.',
        },
    },
    props: {
        'CreateWallet.staleGuard': {
            shells: ['extension'],
            kind: 'intended',
            reason: 'Only the extension popup shares one vault across live windows, so only it can find that another window created the wallet.',
        },
        'AddressList.networkFilter': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell owns the address-list network filter in route state.',
        },
        'AddressList.tokenQuery': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell owns the address-list token query in route state.',
        },
        'AccountPicker.backLabel': {
            shells: ['web'],
            kind: 'known-gap',
            reason: 'Only the web shell labels the account picker back button when it was opened from Settings.',
        },
        'AdvancedActionsForm.hasDexSurface': {
            shells: ['web'],
            kind: 'intended',
            reason: 'Only the web shell currently exposes the DEX surface to advanced actions.',
        },
        'AppHeader.accountNonDefault': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell header presents account context that other shells place in their native layout.',
        },
        'AppHeader.activeAccount': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell header presents account context that other shells place in their native layout.',
        },
        'AppHeader.chainRegistry': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell header builds its network selector from the chain registry.',
        },
        'AppHeader.coinFamilies': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell header builds its network selector from coin-family metadata.',
        },
        'AppHeader.developerMode': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell header adapts its network selector for developer mode.',
        },
        'AppHeader.networkFilter': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell header owns its network filter.',
        },
        'AppHeader.onActiveNetworkChange': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell header owns its network selector.',
        },
        'AppHeader.onManageAddresses': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell header exposes compact-layout address management.',
        },
        'AppHeader.onMenuOpen': {
            shells: ['web'],
            kind: 'intended',
            reason: 'Only the compact web layout uses the overflow menu.',
        },
        'AppHeader.onNetworkFilterChange': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell header owns its network filter.',
        },
        'AppHeader.onOpenAccountPicker': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell header exposes the compact-layout account picker.',
        },
        'AppHeader.onOpenSettings': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell header exposes settings in its compact layout.',
        },
        'AppHeader.onOpenWalletPicker': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell header exposes the compact-layout wallet picker.',
        },
        'AppHeader.onScan': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell header exposes scanning in its compact layout.',
        },
        'AppHeader.onViewAddress': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell header exposes the active address in its compact layout.',
        },
        'AppHeader.platformCurrent': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell header marks the current platform network.',
        },
        'AppHeader.walletNonDefault': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell header presents wallet context that other shells place in their native layout.',
        },
        'BatchComposerForm.hasDexSurface': {
            shells: ['web'],
            kind: 'intended',
            reason: 'Only the web shell currently exposes the DEX surface to batch composition.',
        },
        'BottomTabBar.badges': {
            shells: ['desktop', 'web'],
            kind: 'intended',
            reason: 'The popup tab bar omits badges to fit its constrained layout.',
        },
        'ContactsList.onScanPrefillConsumed': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell owns scan-prefill lifecycle state for contacts.',
        },
        'ContactsList.scanPrefill': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell can route scanned contact data into the contacts screen.',
        },
        'FullLayoutWithNav.nav': {
            shells: ['desktop', 'web'],
            kind: 'intended',
            reason: 'The extension popup uses its compact tab bar instead of the full navigation layout.',
        },
        'Home.networkFilter': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web home route owns its asset network filter.',
        },
        'Home.onNetworkFilterChange': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web home route owns its asset network filter.',
        },
        'Home.onTokenQueryChange': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web home route owns its token search state.',
        },
        'Home.resumeKey': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web shell coordinates home remounts with browser route restoration.',
        },
        'Home.tokenQuery': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web home route owns its token search state.',
        },
        'ParallelComposer.hasDexSurface': {
            shells: ['web'],
            kind: 'intended',
            reason: 'Only the web shell currently exposes the DEX surface to parallel composition.',
        },
        'ReceivePicker.kindFilter': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web receive picker shares the compact-layout asset filters.',
        },
        'ReceivePicker.networkFilter': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web receive picker shares the compact-layout asset filters.',
        },
        'ReceivePicker.onKindFilterChange': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web receive picker shares the compact-layout asset filters.',
        },
        'ReceivePicker.onNetworkFilterChange': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web receive picker shares the compact-layout asset filters.',
        },
        'ScanRoute.embedded': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web scanner can render inside the compact shell route outlet.',
        },
        'ScanRoute.titleId': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The embedded web scanner supplies an accessible route title identifier.',
        },
        'SendPicker.hideOwnFilter': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web send picker can suppress its own filter when the shell provides one.',
        },
        'SendPicker.kindFilter': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web send picker shares the compact-layout asset filters.',
        },
        'SendPicker.networkFilter': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web send picker shares the compact-layout asset filters.',
        },
        'SendPicker.onKindFilterChange': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web send picker shares the compact-layout asset filters.',
        },
        'SendPicker.onNetworkFilterChange': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web send picker shares the compact-layout asset filters.',
        },
        'ShellRouteOutlet.fallback': {
            shells: ['web'],
            kind: 'intended',
            reason: 'The web route outlet supplies its compact-layout fallback directly.',
        },
        'Loading.onRetry': {
            shells: ['desktop'],
            kind: 'known-gap',
            reason: 'Web and extension loading screens do not yet expose the desktop recovery action.',
        },
        'VaultUnavailable.onRetry': {
            shells: ['desktop'],
            kind: 'known-gap',
            reason: 'Web and extension vault errors do not yet expose the desktop recovery action.',
        },
        'AppInner.canOpenInTab': {
            shells: ['extension'],
            kind: 'intended',
            reason: 'Only the extension popup can hand work off to a full browser tab.',
        },
        'AppInner.titleEnabled': {
            shells: ['extension'],
            kind: 'intended',
            reason: 'The extension popup controls whether its constrained layout shows the title.',
        },
        'BottomTabBar.currentView': {
            shells: ['extension'],
            kind: 'intended',
            reason: 'The extension popup tab bar performs its own route selection.',
        },
        'BottomTabBar.hasDexSurface': {
            shells: ['extension'],
            kind: 'intended',
            reason: 'The extension popup tailors its tab destinations to available surfaces.',
        },
        'BottomTabBar.hasVmAddress': {
            shells: ['extension'],
            kind: 'intended',
            reason: 'The extension popup tailors its tab destinations to the active address capabilities.',
        },
        'BottomTabBar.isSignerMode': {
            shells: ['extension'],
            kind: 'intended',
            reason: 'The extension popup tailors its tab destinations for signer mode.',
        },
        'BottomTabBar.onLock': {
            shells: ['extension'],
            kind: 'intended',
            reason: 'The extension popup puts its lock action in the compact tab bar.',
        },
        'BottomTabBar.onOpenSettings': {
            shells: ['extension'],
            kind: 'intended',
            reason: 'The extension popup puts settings in the compact tab bar.',
        },
        'BottomTabBar.onOpenWalletPicker': {
            shells: ['extension'],
            kind: 'intended',
            reason: 'The extension popup puts wallet selection in the compact tab bar.',
        },
        'BottomTabBar.onSelect': {
            shells: ['extension'],
            kind: 'intended',
            reason: 'The extension popup tab bar performs its own route selection.',
        },
        'Home.onCommandPalette': {
            shells: ['extension'],
            kind: 'intended',
            reason: 'The extension home screen exposes popup-specific command-palette navigation.',
        },
        'Home.onLockWallet': {
            shells: ['extension'],
            kind: 'intended',
            reason: 'The extension home screen exposes locking inside the popup layout.',
        },
        'Home.onOpenSettings': {
            shells: ['extension'],
            kind: 'intended',
            reason: 'The extension home screen exposes settings inside the popup layout.',
        },
        'ImportWallet.initialLane': {
            shells: ['extension'],
            kind: 'intended',
            reason: 'The extension popup can initialize import in its full-tab handoff lane.',
        },
        'ImportWallet.onOpenInTab': {
            shells: ['extension'],
            kind: 'intended',
            reason: 'Only the extension popup can move wallet import into a full browser tab.',
        },
        'PairSignerForm.onOpenInTab': {
            shells: ['extension'],
            kind: 'intended',
            reason: 'Only the extension popup can move signer pairing into a full browser tab.',
        },
        'Settings.onOpenBackupInTab': {
            shells: ['extension'],
            kind: 'intended',
            reason: 'Only the extension popup can move backup into a full browser tab.',
        },
    },
};

function routeViews(source) {
    return [...source.matchAll(/unlockedView\s*===\s*(['"])([^'"]+)\1/g)].map((match) => match[2]);
}

function messagingHelpers(source) {
    const helpers = new Set(
        [...source.matchAll(/^export (?:async )?function (\w+)\s*\(/gm)].map((match) => match[1]),
    );
    for (const match of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
        for (const part of match[1].split(',')) {
            const name = part.trim().split(/\s+as\s+/).pop();
            if (name) helpers.add(name);
        }
    }
    return [...helpers].sort();
}

function jsxPropsByComponent(source) {
    const props = new Map();
    const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });

    function visit(node) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'JSXOpeningElement'
            && node.name.type === 'JSXIdentifier'
            && /^[A-Z]/.test(node.name.name)) {
            const componentProps = props.get(node.name.name) ?? new Set();
            for (const attribute of node.attributes) {
                if (attribute.type === 'JSXAttribute' && attribute.name.type === 'JSXIdentifier') {
                    componentProps.add(attribute.name.name);
                }
            }
            props.set(node.name.name, componentProps);
        }
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) {
                for (const child of value) visit(child);
            } else if (value?.type) {
                visit(value);
            }
        }
    }

    visit(ast);
    return props;
}

function mergeComponentProps(sources) {
    const merged = new Map();
    for (const source of sources) {
        for (const [component, props] of jsxPropsByComponent(source)) {
            const componentProps = merged.get(component) ?? new Set();
            for (const prop of props) componentProps.add(prop);
            merged.set(component, componentProps);
        }
    }
    return merged;
}

function sharedComponentProps(sourcesByShell) {
    const propsByShell = Object.fromEntries(Object.entries(sourcesByShell).map(([name, sources]) => [
        name,
        mergeComponentProps(sources),
    ]));
    const shellNames = Object.keys(propsByShell);
    const sharedComponents = [...propsByShell[shellNames[0]].keys()]
        .filter((component) => shellNames.every((shell) => propsByShell[shell].has(component)))
        .sort();
    const flattened = Object.fromEntries(shellNames.map((shell) => [
        shell,
        sharedComponents.flatMap((component) => [...propsByShell[shell].get(component)]
            .map((prop) => `${component}.${prop}`)).sort(),
    ]));
    return { flattened, propsByShell, sharedComponents };
}

function parityFailures(byShell, allowlist) {
    const shellNames = Object.keys(byShell).sort();
    const allItems = new Set(Object.values(byShell).flat());
    const failures = [];

    for (const item of allItems) {
        const present = shellNames.filter((shell) => byShell[shell].includes(item));
        if (present.length === shellNames.length) continue;
        const allowed = allowlist[item];
        if (!allowed?.reason?.trim()) {
            failures.push(`${item}: present in ${present.join(', ')} without a reasoned allowlist entry`);
            continue;
        }
        if (allowed.shells.slice().sort().join(',') !== present.join(',')) {
            failures.push(`${item}: allowlist names ${allowed.shells.slice().sort().join(', ')}, present in ${present.join(', ')}`);
        }
    }

    for (const item of Object.keys(allowlist)) {
        if (!allItems.has(item)) failures.push(`${item}: stale allowlist entry`);
        const present = shellNames.filter((shell) => byShell[shell].includes(item));
        if (present.length === shellNames.length) failures.push(`${item}: stale allowlist entry for a shared item`);
        if (!allowlist[item].reason?.trim()) failures.push(`${item}: allowlist entry has no reason`);
    }
    return failures;
}

function componentProps(source, component) {
    const match = source.match(new RegExp(`<${component}\\n([\\s\\S]*?)\\n\\s*/>`));
    expect(match, `${component} call site exists`).toBeTruthy();
    return new Set(
        [...match[1].matchAll(/^\s+([A-Za-z_$][\w$]*)=/gm)].map((prop) => prop[1]),
    );
}

describe('shell route parity', () => {
    it.each([
        ['mainnet', 'bitcoin-mainnet'],
        ['testnet', 'bitcoin-testnet'],
        ['regtest', 'bitcoin-regtest'],
    ])('opens the DEX Bitcoin asset on %s', (network, chainId) => {
        expect(defaultDexAssetForNetwork(network)).toEqual({ chainId, tick: 'BTC', kind: 'native' });
    });

    it('keeps a selected asset on the active network and replaces one from another network', () => {
        const selected = { chainId: 'dogecoin-testnet', tick: 'DOGE', kind: 'native' };
        expect(syncDexAssetToNetwork(selected, 'testnet')).toBe(selected);
        expect(syncDexAssetToNetwork(selected, 'regtest')).toEqual({
            chainId: 'bitcoin-regtest',
            tick: 'BTC',
            kind: 'native',
        });
    });

    it('keeps every DEX shell subscribed to active-network changes', () => {
        for (const [shellName, shell] of Object.entries(SHELLS)) {
            expect(shell.app, `${shellName} sync`).toContain(
                'setMarketsAsset((current) => syncDexAssetToNetwork(current, settings?.activeNetwork));',
            );
            expect(shell.app, `${shellName} exchange`).toContain(
                'setMarketsAsset(defaultDexAssetForNetwork(settings?.activeNetwork));',
            );
            expect(shell.app, `${shellName} hard-coded mainnet`).not.toContain(
                "setMarketsAsset({ chainId: 'bitcoin-mainnet'",
            );
        }
    });

    it('keeps reachable unlocked views aligned or explicitly shell-only', () => {
        const routes = Object.fromEntries(Object.entries(SHELLS).map(([name, shell]) => [
            name,
            [...new Set(shell.routeSources.flatMap(routeViews))].sort(),
        ]));
        expect(routes.desktop.length).toBeGreaterThan(100);
        expect(parityFailures(routes, SHELL_ONLY.routes)).toEqual([]);
    });

    it('keeps messaging helpers aligned or explicitly shell-only', () => {
        const helpers = Object.fromEntries(Object.entries(SHELLS).map(([name, shell]) => [
            name,
            messagingHelpers(shell.messaging),
        ]));
        expect(helpers.web.length).toBeGreaterThan(300);
        expect(parityFailures(helpers, SHELL_ONLY.messaging)).toEqual([]);
    });

    it('collects named props from capitalized JSX components and ignores spreads', () => {
        const props = jsxPropsByComponent('const view = <Widget alpha {...shared} beta="value" />;');
        expect(props).toEqual(new Map([['Widget', new Set(['alpha', 'beta'])]]));
    });

    it('keeps shared component props aligned or explicitly shell-only', () => {
        const { flattened, sharedComponents } = sharedComponentProps(
            Object.fromEntries(Object.entries(SHELLS).map(([name, shell]) => [name, shell.routeSources])),
        );
        expect(sharedComponents.length).toBeGreaterThan(50);
        expect(Object.values(SHELL_ONLY.props).every(
            ({ kind }) => kind === 'intended' || kind === 'known-gap',
        )).toBe(true);
        expect(parityFailures(flattened, SHELL_ONLY.props)).toEqual([]);
    });

    it('reports a prop removed from one shell', () => {
        const mutatedDesktopSource = desktopAppSource.replace(/\n\s+onAddAccount=\{[^\n]*\n/, '\n');
        expect(mutatedDesktopSource).not.toBe(desktopAppSource);
        const { flattened } = sharedComponentProps({
            web: SHELLS.web.routeSources,
            desktop: [mutatedDesktopSource],
            extension: SHELLS.extension.routeSources,
        });
        expect(parityFailures(flattened, SHELL_ONLY.props)).toContain(
            'AccountPicker.onAddAccount: present in extension, web without a reasoned allowlist entry',
        );
    });

    it('rejects unallowlisted drift and exceptions without reasons', () => {
        expect(parityFailures({ web: ['shared', 'web-only'], desktop: ['shared'] }, {})).toEqual([
            'web-only: present in web without a reasoned allowlist entry',
        ]);
        expect(parityFailures(
            { web: ['web-only'], desktop: [] },
            { 'web-only': { shells: ['web'], reason: '' } },
        )).toEqual([
            'web-only: present in web without a reasoned allowlist entry',
            'web-only: allowlist entry has no reason',
        ]);
    });

    it.each([
        ['Home', ['onResumeConfirm']],
        ['History', ['onReceive', 'onSelectEntry']],
        ['ManageToken', ['onViewActivity']],
        ['ContactsList', ['onOpenBackup']],
        ['ExecuteContractForm', ['initialMethod', 'initialParamsText']],
        ['Settings', ['onNavigateToMint']],
        ['TokenDetail', ['onBuy']],
    ])('wires shared %s actions in every shell', (component, callbacks) => {
        for (const [shellName, shell] of Object.entries(SHELLS)) {
            const props = componentProps(shell.app, component);
            for (const callback of callbacks) {
                expect(props.has(callback), `${shellName} ${component}.${callback}`).toBe(true);
            }
        }
    });

    it('carries desktop execute deep-link fields into its shared form', () => {
        expect(desktopAppSource).toContain(
            'if (route.executePrefill) setExecutePrefill(route.executePrefill);',
        );
    });

    it('keeps web launch routes ahead of last-view restoration', () => {
        expect(webAppSource).toContain('launchRouteState.current.remember(route.view, statusStateRef.current);');
        expect(webAppSource).toContain('skip: launchRouteState.current.shouldSkipLastViewResume(),');
        expect(webAppSource).toContain('launchRouteState.current.walletActivated();');
    });

    it('resets desktop route context when a sibling window switches wallets', () => {
        expect(desktopAppSource).toMatch(
            /change\?\.kind !== 'active-wallet'[\s\S]*?setActiveAccountId\(null\);[\s\S]*?setActiveWalletId\(walletId\);[\s\S]*?setUnlockedView\('home'\);/,
        );
    });
});
