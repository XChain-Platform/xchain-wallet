// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import webAppSource from '../../packages/web/src/App.jsx?raw';
import webDexSource from '../../packages/web/src/surfaces/dex.jsx?raw';
import webMessagingSource from '../../packages/web/src/messaging.js?raw';
import desktopAppSource from '../../packages/desktop/renderer/App.jsx?raw';
import desktopMessagingSource from '../../packages/desktop/renderer/messaging.js?raw';
import extensionAppSource from '../../packages/extension/src/popup/App.jsx?raw';
import extensionMessagingSource from '../../packages/extension/src/popup/messaging.js?raw';

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
        expect(webAppSource).toContain('launchRouteState.current.remember(route.view, status.state);');
        expect(webAppSource).toContain('skip: launchRouteState.current.shouldSkipLastViewResume(),');
        expect(webAppSource).toContain('launchRouteState.current.walletActivated();');
    });

    it('resets desktop route context when a sibling window switches wallets', () => {
        expect(desktopAppSource).toMatch(
            /change\?\.kind !== 'active-wallet'[\s\S]*?setActiveAccountId\(null\);[\s\S]*?setActiveWalletId\(walletId\);[\s\S]*?setUnlockedView\('home'\);/,
        );
    });
});
