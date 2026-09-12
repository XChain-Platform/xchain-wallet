// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// P11: the two XBRIDGE surfaces are reachable in all three shells.
//
// `BridgeMoveForm` and `TokenAdminForm`'s `bridge-settings` mode were built and
// tested, but every route in this wallet is a `unlockedView === '<view>'` branch
// inside a shell App, and no shell had one. A form nothing navigates to is a
// form no user can open, which is a shipped feature that does not exist.
//
// Two halves have to hold, and either one alone leaves the lane dead:
//   1. the route: the view renders the form (checked per shell, in source,
//      because no unit venue mounts a whole shell App);
//   2. the way in: an actions-catalogue entry whose onSelect navigates to
//      exactly that view name. A typo'd target is the failure mode these
//      pin, so the entry's target is checked AGAINST the set of views the
//      shell's own route branches handle, not against a literal.
// Plus the catalogue behaviour itself: ActionsMenu renders a host-appended
// entry and fires its onSelect, driven in the DOM below.

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ActionsMenu } from '../../../packages/core/src/shared/routes/ActionsMenu.jsx';
import { ManageToken } from '../../../packages/core/src/shared/routes/ManageToken.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    ACTION_ENTRY_DEFS,
    buildActionEntries,
} from '../../../packages/core/src/shared/actionEntries.js';
import { buildCommands } from '../../../packages/core/src/shared/commandPalette/commandRegistry.js';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

// Same cwd probe the other cross-shell suites use, so this runs from either the
// wallet repo root or the platform root.
const WORKSPACE_ROOT = existsSync(resolve(process.cwd(), 'packages/core/src/flows/tokenInfo.js'))
    ? process.cwd()
    : resolve(process.cwd(), 'xchain-wallet');

const SHELLS = {
    'extension popup': 'packages/extension/src/popup/App.jsx',
    web: 'packages/web/src/App.jsx',
    desktop: 'packages/desktop/renderer/App.jsx',
};

// Prose describes the wiring in comments; the scan must only see code, or a
// comment mentioning a route would read as the route existing. Line comments
// go FIRST: the popup's header prose contains "routes/*", and stripping block
// comments ahead of it swallows every import below as one giant comment.
function codeOf(rel) {
    return readFileSync(join(WORKSPACE_ROOT, rel), 'utf8')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        .replace(/\/\*[\s\S]*?\*\//g, '');
}

// Every view name this shell's route table actually handles.
function routedViews(code) {
    return new Set(Array.from(code.matchAll(/unlockedView === '([^']+)'/g), (m) => m[1]));
}

// The handler block this shell passes to buildActionEntries: from the call to
// the menu's own Back handler. An entry is armed here or it is not armed.
function actionsCatalogue(code) {
    const start = code.indexOf('buildActionEntries({');
    if (start < 0) return null;
    const end = code.indexOf("onBack={() => setUnlockedView('home')}", start);
    return end < 0 ? null : code.slice(start, end);
}

describe('P11: the bridge routes exist in every shell', () => {
    for (const [label, rel] of Object.entries(SHELLS)) {
        describe(label, () => {
            const code = codeOf(rel);

            it('imports BridgeMoveForm from core', () => {
                expect(
                    /import \{ BridgeMoveForm \} from '@xchain-wallet\/core\/shared\/routes\/BridgeMoveForm\.jsx'/.test(code),
                    'BridgeMoveForm is not imported',
                ).toBe(true);
            });

            it("the 'bridge-move' view renders BridgeMoveForm with a wallet and a way back", () => {
                expect(routedViews(code).has('bridge-move'), 'no bridge-move route branch').toBe(true);
                const branch = code.slice(code.indexOf("unlockedView === 'bridge-move'"));
                const mount = branch.slice(0, branch.indexOf('/>') + 2);
                expect(mount).toContain('<BridgeMoveForm');
                expect(mount).toContain('walletId={activeWalletId}');
                expect(mount).toContain('onBack={formBack}');
            });

            it("the 'bridge-settings' view reaches TokenAdminForm's bridge mode", () => {
                expect(routedViews(code).has('bridge-settings'), 'no bridge-settings route branch').toBe(true);
                // The mode is the view name itself (mode={unlockedView}), so the
                // gate admitting the view is what selects ISSUE v7's panel.
                const gate = code.slice(
                    code.indexOf("unlockedView === 'lock'"),
                    code.indexOf('<TokenAdminForm'),
                );
                expect(gate).toContain("unlockedView === 'bridge-settings'");
                expect(code.slice(code.indexOf('<TokenAdminForm'))).toContain('mode={unlockedView}');
            });

            it('arms both catalogue entries, and each one targets a view the shell routes', () => {
                const catalogue = actionsCatalogue(code);
                expect(catalogue, 'the buildActionEntries handler block was not found').toBeTruthy();
                const routed = routedViews(code);
                for (const id of ['bridge-move', 'bridge-settings']) {
                    // The handler name comes from the catalogue, not a literal,
                    // so renaming it there without following in the shells is
                    // the failure this catches: an unarmed entry does not render.
                    const { handler } = ACTION_ENTRY_DEFS.find((d) => d.id === id);
                    const armed = catalogue.match(
                        new RegExp(`\\b${handler}:\\s*\\(\\) => setUnlockedView\\('([^']+)'\\)`),
                    );
                    expect(armed, `${handler} is not armed in this shell`).toBeTruthy();
                    // The whole point: a way in that names a view no branch
                    // handles renders a button that does nothing at all.
                    expect(routed.has(armed[1]), `${handler} navigates to unrouted view '${armed[1]}'`).toBe(true);
                }
            });

            // P19: the two entries used to be declared inside each shell, three
            // copies of one label and one description. A shell that keeps its
            // own copy would render the row twice, and the copies would drift.
            it('declares no bridge entry of its own any more', () => {
                expect(/id: 'bridge-(move|settings)'/.test(code)).toBe(false);
            });

            it('opens the bridge-settings form from the token page, with the token in hand', () => {
                const mount = code.slice(code.indexOf('<ManageToken'));
                // The opener is taken from a neighbouring issuer-only row
                // rather than named: it is the one that sets formReturnView,
                // and formReturnView is what turns tokenDetailRef into the
                // form's chainId/tick prefill. A bare setUnlockedView would
                // open the bridge form on no token at all.
                const neighbour = mount.match(/onAccessLists=\{\(\) => (\w+)\('access-lists'\)\}/);
                expect(neighbour, 'no onAccessLists row to take the opener from').toBeTruthy();
                const wired = mount.match(
                    new RegExp(`onBridgeSettings=\\{\\(\\) => ${neighbour[1]}\\('([^']+)'\\)\\}`),
                );
                expect(wired, 'the token page does not open bridge settings through the prefilling opener').toBeTruthy();
                expect(routedViews(code).has(wired[1])).toBe(true);
            });
        });
    }

    it('the shared menu renders both catalogue entries and fires the right one', () => {
        const onBridgeMove = vi.fn();
        const onBridgeSettings = vi.fn();
        render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging: {} },
                React.createElement(ActionsMenu, {
                    entries: buildActionEntries({ onBridgeMove, onBridgeSettings }),
                    onBack() {},
                }),
            ),
        );
        fireEvent.click(screen.getByText('Move across chains'));
        expect(onBridgeMove).toHaveBeenCalledTimes(1);
        expect(onBridgeSettings).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('Bridge settings'));
        expect(onBridgeSettings).toHaveBeenCalledTimes(1);
    });
});

// P19: one catalogue, one copy of each string, one place a shell arms them.
describe('P19: the bridge entries are catalogue entries', () => {
    const def = (id) => ACTION_ENTRY_DEFS.find((d) => d.id === id);

    it('declares both entries with a handler, a label and a description', () => {
        for (const id of ['bridge-move', 'bridge-settings']) {
            const entry = def(id);
            expect(entry, `${id} is not in the catalogue`).toBeTruthy();
            expect(entry.handler).toBeTruthy();
            expect(entry.label).toBeTruthy();
            expect(entry.description).toBeTruthy();
        }
    });

    it('drops each one when its shell does not arm it', () => {
        const ids = buildActionEntries({ onBridgeMove() {} }).map((e) => e.id);
        expect(ids).toContain('bridge-move');
        expect(ids).not.toContain('bridge-settings');
    });

    it('seats them beside the other cross-chain rows, not at the end', () => {
        const order = ACTION_ENTRY_DEFS.map((d) => d.id);
        expect(order.indexOf('bridge-move')).toBeGreaterThan(order.indexOf('cross-chain-templates'));
        expect(order.indexOf('bridge-settings')).toBe(order.indexOf('bridge-move') + 1);
    });
});

// P19: the command palette. Two views a user reaches by name, not by
// remembering which submenu of the actions catalogue they sit in.
describe('P19: the palette reaches both bridge views', () => {
    const find = (list, id) => list.find((c) => c.id === id);

    it('navigates to each view, ungated', () => {
        const navigate = vi.fn();
        // Bare context: no BTC address, no governance, no DEX surface. The
        // bridge is not the DEX, so a store build still reaches it.
        const commands = buildCommands({ navigate, hasDexSurface: false });
        find(commands, 'create-bridge-move').run();
        expect(navigate).toHaveBeenCalledWith('bridge-move');
        find(commands, 'create-bridge-settings').run();
        expect(navigate).toHaveBeenCalledWith('bridge-settings');
    });

    it('points at views every shell actually routes', () => {
        for (const rel of Object.values(SHELLS)) {
            const routed = routedViews(codeOf(rel));
            expect(routed.has('bridge-move')).toBe(true);
            expect(routed.has('bridge-settings')).toBe(true);
        }
    });

    it('is findable by the words a user types', () => {
        const commands = buildCommands({ navigate() {} });
        for (const id of ['create-bridge-move', 'create-bridge-settings']) {
            expect(find(commands, id).keywords).toContain('bridge');
        }
    });
});

// P19: the token page. The Actions catalogue opens the bridge form with no
// token in hand; this is the entry point that carries one.
describe('P19: Manage Token offers the bridge row', () => {
    afterEach(() => { cleanup(); __clearTokenInfoCache(); });

    const CHAIN = 'bitcoin-regtest';
    const ISSUER = 'bcrt1qissuer';
    let tick = 0;

    // Every case waits on this string before asserting, so a row read before
    // the token info landed cannot pass for a row the info allows.
    const MARKER = 'Probe token';

    async function renderManage({ info = {}, addresses = [ISSUER], onBridgeSettings } = {}) {
        // A fresh tick per render: useTokenInfo caches by chainId/tick at module
        // scope, so reusing one would serve the previous case's info.
        const TICK = `BRIDGEROW${tick += 1}`;
        const messaging = {
            getTokenInfo: async () => ({ creator: ISSUER, description: MARKER, ...info }),
            getAddressesByChain: async () => ({ [CHAIN]: addresses.map((address) => ({ address })) }),
            getHoldersForToken: async () => ({ data: [] }),
            getHistoryForToken: async () => ({ data: [] }),
            getWalletBalances: async () => ({}),
        };
        render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(ManageToken, {
                    walletId: 'w1', chainId: CHAIN, tick: TICK, onBack() {}, onBridgeSettings,
                }),
            ),
        );
        await screen.findByText(MARKER);
    }

    // The row sits past the three primaries, so it lives behind More; open it
    // when there is one, then hand back whichever Bridge control is on screen.
    function bridgeRow() {
        const more = screen.queryByRole('button', { name: /More/ });
        if (more) fireEvent.click(more);
        return screen.queryByRole(more ? 'menuitem' : 'button', { name: /^Bridge$/ });
    }

    it('opens the bridge-settings form for the token in hand', async () => {
        const onBridgeSettings = vi.fn();
        await renderManage({ onBridgeSettings });
        const row = bridgeRow();
        expect(row, 'no Bridge row on the token page').toBeTruthy();
        fireEvent.click(row);
        expect(onBridgeSettings).toHaveBeenCalledTimes(1);
    });

    it('disables the row and says why once the bridge is frozen', async () => {
        const onBridgeSettings = vi.fn();
        await renderManage({ info: { lockBridge: true }, onBridgeSettings });
        const row = bridgeRow();
        // Still on screen: an issuer who froze it needs to see what stops them.
        expect(row, 'the frozen row vanished instead of explaining itself').toBeTruthy();
        expect(row.disabled).toBe(true);
        expect(row.getAttribute('title')).toMatch(/frozen/i);
        fireEvent.click(row);
        expect(onBridgeSettings).not.toHaveBeenCalled();
    });

    it('stays live when the flag is absent, which is unknown and not frozen', async () => {
        const onBridgeSettings = vi.fn();
        await renderManage({ info: { lockBridge: null }, onBridgeSettings });
        const row = bridgeRow();
        expect(row.disabled).toBe(false);
        fireEvent.click(row);
        expect(onBridgeSettings).toHaveBeenCalledTimes(1);
    });

    it('is gated like the other issuer-only rows: absent for a non-issuer', async () => {
        await renderManage({
            addresses: ['bcrt1qsomeoneelse'],
            onBridgeSettings: vi.fn(),
        });
        // The owner gate resolves after its own fetch, so wait for the banner
        // it raises rather than reading the grid the instant info arrives.
        await waitFor(() => {
            expect(screen.getByText(/hold the token's issuer address/i)).toBeTruthy();
        });
        expect(bridgeRow()).toBeNull();
    });
});
