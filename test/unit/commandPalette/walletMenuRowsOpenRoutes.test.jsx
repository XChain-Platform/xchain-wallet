// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The grouped full menu (operator ruling 2026-11-13, navigation option 2):
// every main page is one menu row, every common task is one tap, and every
// row opens its own route through the shell's one menu handler in all three
// shells (web, desktop, extension popup).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { CommandPalette } from '../../../packages/core/src/shared/commandPalette/CommandPalette.jsx';
import { ROUTE_REGISTRY } from '../../../packages/core/src/shared/routeRegistry.js';
import { WALLET_MENU_GROUPS, visibleWalletMenu } from '../../../packages/core/src/shared/walletMenu.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const FULL_GATES = {
    hasDexSurface: true,
    hasVmAddress: true,
    hasBtcAddress: true,
    hasGovernanceAddress: true,
};

const ROWS = WALLET_MENU_GROUPS.flatMap((group) => group.rows.map((row) => ({ group: group.id, id: row.id })));

// Common tasks are one tap from the menu, by a row named for the task or its
// obvious home page (operator list, 2026-11-13, plus the audit's main pages).
// [task, menu box, row id]
const COMMON_TASKS = [
    ['Home', 'wallet', 'home'],
    ['Create a token', 'assets', 'wizard'],
    ['Issue token', 'assets', 'wizard'],
    ['My tokens and Manage token', 'assets', 'my-tokens'],
    ['Addresses: add, change, view', 'wallet', 'addresses'],
    ['Contacts', 'people', 'contacts'],
    ['My dispensers', 'earn', 'dispensers-list'],
    ['Create dispenser', 'earn', 'dispenser'],
    ['Contracts list', 'earn', 'contracts-list'],
    ['Publish contract', 'earn', 'contract-deploy'],
    ['Run contract (from its contract)', 'earn', 'contracts-list'],
    ['DEX and markets', 'trade', 'markets'],
    ['My orders', 'trade', 'my-orders'],
    ['My swaps', 'trade', 'my-swaps'],
    ['Payments due', 'trade', 'obligations'],
    ['Prediction markets', 'trade', 'bet-markets'],
    ['Governance polls', 'governance', 'governance-polls'],
    ['My delegations', 'governance', 'governance-delegations'],
    ['Staking', 'earn', 'staking-dashboard'],
    ['Messaging', 'people', 'messaging'],
    ['Lists', 'assets', 'lists'],
    ['Create multisig', 'governance', 'multisig-create'],
    ['Multisig signing', 'governance', 'multisig-sign'],
    ['Agent accounts', 'governance', 'cosigner-accounts'],
    ['Sign message', 'people', 'sign-message'],
    ['Verify signature', 'people', 'verify-signature'],
    ['Broadcast', 'assets', 'broadcast'],
    ['History', 'wallet', 'history'],
    ['Send', 'wallet', 'send'],
    ['Receive', 'wallet', 'receive'],
    ['Scan', 'wallet', 'scan'],
    ['Notifications', 'people', 'alerts'],
    ['Publish file', 'assets', 'publish-file'],
    ['Browse dispensers', 'earn', 'dispenser-explorer'],
    ['Marketplace', 'trade', 'market-activity'],
    ['Swap tokens', 'actions', 'swap'],
    ['Create order', 'actions', 'create-order'],
    ['Cross-chain swap', 'actions', 'cross-chain-swap'],
    ['Cross-chain order', 'actions', 'cross-chain-order'],
    ['Batch', 'actions', 'batch-compose'],
    ['Link actions', 'assets', 'link-form'],
    ['Sign transaction', 'people', 'sign-psbt'],
    ['Pair hardware wallet', 'governance', 'pair-signer'],
    ['My wallets', 'wallets', 'wallet-picker'],
    ['My accounts', 'wallets', 'account-picker'],
    ['Add wallet', 'wallets', 'add-wallet'],
    ['Connected sites', 'wallets', 'connected-sites'],
    ['Action queue', 'wallets', 'parallel-compose'],
    ['Advanced action', 'wallets', 'advanced'],
    ['All actions', 'actions', 'actions'],
    ['Pay for a matched order', 'trade', 'coinpay'],
    ['My oracle (price a token for dispensers)', 'earn', 'oracle'],
    ['Move a token across chains', 'actions', 'bridge-move'],
    ['Add account', 'wallets', 'add-account'],
    // The seventh row of each short box (operator ruling 2026-11-14).
    ['Settings', 'wallet', 'settings'],
    ['Airdrop', 'assets', 'airdrop'],
    ['Create a poll', 'governance', 'governance-create-poll'],
    ['New message', 'people', 'compose-message'],
];

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');

// Each shell's menu handler: the name the CommandPalette menu calls, and the
// line that opens the row's view as a root page (G06).
const SHELLS = [
    {
        name: 'web',
        files: ['packages/web/src/App.jsx', 'packages/web/src/surfaces/dex.jsx'],
        handler: 'handleMenuSelect',
        opens: 'palette.navigate(view);',
    },
    {
        name: 'desktop',
        files: ['packages/desktop/renderer/App.jsx'],
        handler: 'handleShellSelect',
        opens: 'palette.navigate(view);',
    },
    {
        name: 'extension',
        files: ['packages/extension/src/popup/App.jsx'],
        handler: 'handleWalletMenuSelect',
        opens: 'palette.navigate(viewId);',
    },
];

/** The handler's own body: from its declaration to the close at its indent. */
function handlerSource(source, name) {
    const start = source.indexOf(`const ${name} = (`);
    if (start < 0) return '';
    const indent = source.slice(source.lastIndexOf('\n', start) + 1, start);
    const end = source.indexOf(`\n${indent}};`, start);
    return source.slice(start, end);
}

describe('grouped full menu', () => {
    it('shows every catalogue row to a full wallet, eight boxes', () => {
        const groups = visibleWalletMenu(FULL_GATES);
        expect(groups).toHaveLength(8);
        expect(groups.flatMap((group) => group.rows)).toHaveLength(ROWS.length);
    });

    it('gives every page that was only on All actions its own row', () => {
        // The audit's 18 (2026-11-13): reachable before only through All actions.
        const ids = new Set(ROWS.map((row) => row.id));
        for (const id of [
            'bridge-move', 'coinpay', 'cross-chain-swap', 'oracle', 'swap', 'batch-compose', 'broadcast',
            'cosigner-accounts', 'create-order', 'cross-chain-order', 'governance-polls', 'link-form',
            'multisig-sign', 'my-orders', 'my-swaps', 'pair-signer', 'sign-psbt', 'verify-signature',
            // and the pages that were only under Settings
            'wallet-picker', 'account-picker', 'connected-sites', 'parallel-compose', 'advanced',
        ]) expect(ids.has(id), id).toBe(true);
    });

    it.each(COMMON_TASKS)('%s is one tap: the %s box holds %s', (_task, box, id) => {
        const group = WALLET_MENU_GROUPS.find((candidate) => candidate.id === box);
        expect(group.rows.map((row) => row.id)).toContain(id);
    });

    it('lists every menu row in the common-task table', () => {
        const listed = new Set(COMMON_TASKS.map(([, , id]) => id));
        expect(ROWS.map((row) => row.id).filter((id) => !listed.has(id))).toEqual([]);
    });

    it.each(ROWS)('the $group row $id is a registered route and the menu opens it', ({ id }) => {
        expect(ROUTE_REGISTRY[id], `${id} is in routeRegistry.js`).toBeDefined();
        const onSelect = vi.fn();
        const onOpenSettings = vi.fn();
        const onClose = vi.fn();
        const { container } = render(
            <CommandPalette
                open
                onClose={onClose}
                commands={[]}
                menu={{
                    gates: FULL_GATES,
                    currentView: 'none',
                    onSelect,
                    onOpenSettings,
                    onLock: vi.fn(),
                }}
            />,
        );
        fireEvent.click(container.querySelector(`[data-wallet-menu-row="${id}"]`));
        expect(onClose).toHaveBeenCalledTimes(1);
        // Settings opens through the shell's settings handler, every other row through select.
        if (id === 'settings') {
            expect(onOpenSettings).toHaveBeenCalledTimes(1);
        } else {
            expect(onSelect).toHaveBeenCalledWith(id);
        }
    });

    for (const shell of SHELLS) {
        const sources = shell.files.map(read);
        const app = sources[0];
        const handler = handlerSource(app, shell.handler);

        it(`${shell.name}: the menu calls the shell's one menu handler, which opens the row's view`, () => {
            expect(app).toMatch(new RegExp(`onSelect: ${shell.handler},`));
            expect(handler).toContain(shell.opens);
            // The rows whose page needs a fresh state, set as their other entry points set it.
            expect(handler).toMatch(/'multisig-sign'[\s\S]*?setMultisigSessionId\(null\);\s*setMultisigInitialLink\(null\);/);
            expect(handler).toMatch(/'add-wallet'[\s\S]*?setOnboardingStep\('welcome'\);/);
            expect(handler).toMatch(/'coinpay'[\s\S]*?setResumeCoinpay\(null\);/);
            // A form opened from the menu is free-entry: the menu opens it through
            // openRootView, which clears the token prefill left over from Manage
            // token (rootNavigationClearsFormSource.test.jsx pins that helper).
            expect(handler).toContain('palette.navigate(');
            // The menu reaches every gated row: the governance gate is passed in.
            expect(app).toMatch(/gates: \{[^}]*hasGovernanceAddress,[^}]*\}/);
        });

        it.each(ROWS.map((row) => row.id).filter((id) => id !== 'home'))(`${shell.name}: mounts the %s route`, (id) => {
            const mounted = sources.some((source) => source.includes(`unlockedView === '${id}'`));
            expect(mounted, `${shell.name} renders ${id}`).toBe(true);
        });

        it(`${shell.name}: opens My delegations from the menu without a poll chain`, () => {
            expect(app).toContain("if (unlockedView === 'governance-delegations' && activeWalletId) {");
            expect(app).toContain('chainId={governanceRef?.chainId}');
        });
    }
});
