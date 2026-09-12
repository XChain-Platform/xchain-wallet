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

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActionsMenu } from '../../../packages/core/src/shared/routes/ActionsMenu.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';

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

// The entries array handed to ActionsMenu: from the buildActionEntries spread
// to the menu's own Back handler. Anything outside it is not a way in.
function actionsCatalogue(code) {
    const start = code.indexOf('entries={[...buildActionEntries(');
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

            it('offers a way in for each view, and each one targets a view the shell routes', () => {
                const catalogue = actionsCatalogue(code);
                expect(catalogue, 'the ActionsMenu entries array was not found').toBeTruthy();
                const routed = routedViews(code);
                for (const id of ['bridge-move', 'bridge-settings']) {
                    const entry = catalogue.match(
                        new RegExp(`id: '${id}',[\\s\\S]{0,400}?onSelect: \\(\\) => setUnlockedView\\('([^']+)'\\)`),
                    );
                    expect(entry, `no catalogue entry opens ${id}`).toBeTruthy();
                    // The whole point: a way in that names a view no branch
                    // handles renders a button that does nothing at all.
                    expect(routed.has(entry[1]), `entry ${id} navigates to unrouted view '${entry[1]}'`).toBe(true);
                }
            });
        });
    }

    it('the shared menu renders a host-appended entry and fires it', () => {
        const onSelect = vi.fn();
        render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging: {} },
                React.createElement(ActionsMenu, {
                    entries: [{
                        id: 'bridge-move',
                        label: 'Move across chains',
                        description: 'Move a token to another chain.',
                        onSelect,
                    }],
                    onBack() {},
                }),
            ),
        );
        fireEvent.click(screen.getByText('Move across chains'));
        expect(onSelect).toHaveBeenCalledTimes(1);
    });
});
