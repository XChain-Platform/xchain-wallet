// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// No orphan pages (operator ruling 2026-11-13). Every user-facing route in
// the registry must be reachable by taps alone: a main menu row, a tab, Home,
// or a button or row on a page that is itself reachable. The tap graph is read
// from each shell's route switch: a route block `if (unlockedView === 'x')`
// links to every view its handlers open (setUnlockedView('y'), navigate('y'),
// resetNav('y'), landView('y'), openForm('y'), openWalletPicker()). A new page that nothing
// opens fails here by name, so it is linked before it ships.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HIDDEN_ROUTE_IDS, ROUTE_REGISTRY } from '../../../packages/core/src/shared/routeRegistry.js';
import {
    WALLET_MENU_GROUPS,
    WALLET_TAB_BAR_IDS,
} from '../../../packages/core/src/shared/walletMenu.js';

const read = (path) => readFileSync(join(process.cwd(), path), 'utf8');

// Routes that are not pages a user taps to: each needs a reason.
const NOT_TAPPED_TO = {
    // Search, deep links and the wide sidebar are not counted; nothing is
    // excluded today. Add a route here only with the reason it has no tap.
};

// Links inside a page that do not change the shell's view, so the switch
// below cannot see them. Each names the page and the control.
const IN_PAGE_LINKS = {
    // Settings opens Connected sites as its own sub-page (the shells also
    // mount it as the 'connected-sites' alias for deep links).
    settings: ['connected-sites'],
};

const SHELLS = [
    { name: 'web', files: ['packages/web/src/App.jsx', 'packages/web/src/surfaces/dex.jsx'] },
    { name: 'desktop', files: ['packages/desktop/renderer/App.jsx'] },
    { name: 'extension', files: ['packages/extension/src/popup/App.jsx'] },
];

// The view setters a route block calls, plus the local form openers (Manage
// token's openForm, the token page's openFromAsset and its issuer actions'
// openOwnerForm).
const TARGET_RE = /\b(?:setUnlockedView|navigate|resetNav|landView|land|openForm|openFromAsset|openOwnerForm|handleMenuSelect|handleShellSelect|handleWalletMenuSelect)\(\s*'([a-z0-9-]+)'/g;
const BLOCK_RE = /if \(\s*unlockedView (?:===|!==) '[a-z0-9-]+'/g;
// A page renderer the switch defines once and several route blocks call
// (G12: renderTokenDetail draws the coin and token page for token-detail,
// manage-token and wide Home's panel). Its links belong to every block that
// calls it, never to the block it happens to sit after.
const HELPER_RE = /const (render[A-Z]\w*) = \(/g;

/** The route switch of one source file: the IIFE in an App.jsx, or a whole surface module. */
function routeSwitch(source) {
    const start = source.indexOf('const routeNode = (() => {');
    if (start < 0) return source;
    const end = source.indexOf('})();', start);
    return source.slice(start, end);
}

/** Edges source view -> target view, read block by block from the route switch. */
function tapEdges(files) {
    const edges = new Map();
    const add = (from, to) => {
        if (!edges.has(from)) edges.set(from, new Set());
        edges.get(from).add(to);
    };
    const linksIn = (text) => {
        const targets = [...text.matchAll(TARGET_RE)].map((match) => match[1]);
        if (/\bopenWalletPicker\(/.test(text)) targets.push('wallet-picker');
        return targets;
    };
    for (const file of files) {
        const body = routeSwitch(read(file));
        const starts = [...body.matchAll(BLOCK_RE)].map((match) => match.index);
        // Each helper runs from its definition to the next route block.
        const helpers = [...body.matchAll(HELPER_RE)].map((match) => {
            const end = starts.find((at) => at > match.index) ?? body.length;
            return { name: match[1], start: match.index, end, targets: linksIn(body.slice(match.index, end)) };
        });
        starts.forEach((at, index) => {
            const blockEnd = starts[index + 1] ?? body.length;
            // The block's own text, without any helper defined inside it.
            let block = '';
            let cursor = at;
            for (const helper of helpers) {
                if (helper.start < at || helper.start >= blockEnd) continue;
                block += body.slice(cursor, helper.start);
                cursor = Math.min(helper.end, blockEnd);
            }
            block += body.slice(cursor, blockEnd);
            const condition = block.slice(0, block.indexOf('{'));
            // The `!== 'home'` guard returns RouteNotFound; what follows it is Home.
            const sources = condition.includes("!== 'home'")
                ? ['home']
                : [...condition.matchAll(/unlockedView === '([a-z0-9-]+)'/g)].map((match) => match[1]);
            const targets = linksIn(block);
            for (const helper of helpers) {
                if (new RegExp(`\\b${helper.name}\\(`).test(block)) targets.push(...helper.targets);
            }
            for (const from of sources) for (const to of targets) add(from, to);
        });
    }
    for (const [from, tos] of Object.entries(IN_PAGE_LINKS)) for (const to of tos) add(from, to);
    return edges;
}

function reachable(edges) {
    const roots = [
        'home',
        ...WALLET_TAB_BAR_IDS,
        ...WALLET_MENU_GROUPS.flatMap((group) => group.rows.map((row) => row.id)),
    ];
    const seen = new Set(roots);
    const queue = [...roots];
    while (queue.length) {
        const from = queue.shift();
        for (const to of edges.get(from) || []) {
            if (!seen.has(to)) {
                seen.add(to);
                queue.push(to);
            }
        }
    }
    return seen;
}

const userFacingRoutes = Object.keys(ROUTE_REGISTRY)
    .filter((id) => !HIDDEN_ROUTE_IDS.includes(id) && !(id in NOT_TAPPED_TO));

describe('every page is linked from somewhere a user can tap', () => {
    it('reads a tap graph from every shell', () => {
        for (const shell of SHELLS) {
            const edges = tapEdges(shell.files);
            // A parser that found no blocks would pass every route vacuously.
            expect(edges.size, shell.name).toBeGreaterThan(20);
        }
    });

    it('opens Settings, Airdrop, Create Poll and New Message straight from the menu (2026-11-14)', () => {
        const edges = new Map();
        const seen = reachable(edges);
        for (const id of ['settings', 'airdrop', 'governance-create-poll', 'compose-message']) {
            expect(ROUTE_REGISTRY[id] || id === 'settings', id).toBeTruthy();
            expect(seen.has(id), `${id} is a menu row`).toBe(true);
        }
    });

    it('fails a page whose only links are removed', () => {
        // Sell token name opens only from the token page's issuer actions,
        // which every page drawing the token page carries (token-detail,
        // manage-token, wide Home's panel). Without those links it must read
        // as an orphan, or the guard proves nothing.
        const edges = tapEdges(SHELLS[0].files);
        expect(reachable(edges).has('sell-name')).toBe(true);
        expect(edges.get('manage-token')?.has('sell-name')).toBe(true);
        expect(edges.get('token-detail')?.has('sell-name')).toBe(true);
        for (const tos of edges.values()) tos.delete('sell-name');
        expect(reachable(edges).has('sell-name')).toBe(false);
    });

    it('names every exclusion with a reason', () => {
        for (const [id, reason] of Object.entries(NOT_TAPPED_TO)) {
            expect(ROUTE_REGISTRY[id], id).toBeDefined();
            expect(String(reason).trim(), id).not.toBe('');
        }
    });

    for (const shell of SHELLS) {
        const seen = reachable(tapEdges(shell.files));
        it.each(userFacingRoutes)(`${shell.name}: %s is reachable by taps`, (id) => {
            expect(seen.has(id), `${id} has no menu row, tab, Home link or page link in the ${shell.name} shell`).toBe(true);
        });
    }
});
