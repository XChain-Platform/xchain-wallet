// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Phase 3 Step 1 smoke — Markets list scaffold (§41.2).
//
// Static wiring checks (shared route, messaging helpers × 3 shells,
// background handlers, vault collection, App.jsx sub-routes, Home
// entry) plus a runtime round-trip of the watchlist flow against a
// stub vault.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
    flows,
    schemas,
} from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desk = join(wsRoot, 'packages', 'desktop');

// --- 1. Shared route exists + exports ----------------------------

const routePath = join(core, 'src', 'shared', 'routes', 'MarketsList.jsx');
assert.ok(existsSync(routePath), 'MarketsList.jsx exists');
const routeSrc = readFileSync(routePath, 'utf8');
assert.ok(/export function MarketsList\b/.test(routeSrc),
    'MarketsList is a named export');
assert.ok(/listWatchlistForWallet/.test(routeSrc)
    && /saveWatchlistEntry/.test(routeSrc)
    && /clearWatchlistEntry/.test(routeSrc),
    'MarketsList reads + writes the watchlist via messaging');
assert.ok(/messaging\.getMarkets\(/.test(routeSrc),
    'MarketsList queries sdk.getMarkets per chain');
assert.ok(/onOpenMarket/.test(routeSrc),
    'MarketsList accepts onOpenMarket prop for navigation to market view');

// --- 2. Schema + flow exports ------------------------------------

assert.equal(typeof schemas.createWatchlistEntry, 'function',
    'schemas.createWatchlistEntry exported');
assert.equal(typeof schemas.validateWatchlistEntry, 'function',
    'schemas.validateWatchlistEntry exported');
assert.equal(typeof schemas.watchlistEntryKey, 'function',
    'schemas.watchlistEntryKey exported');
assert.equal(typeof flows.getMarkets, 'function', 'flows.getMarkets exported');
assert.equal(typeof flows.getMarket, 'function', 'flows.getMarket exported');
assert.equal(typeof flows.getMarketHistory, 'function', 'flows.getMarketHistory exported');
assert.equal(typeof flows.getMarketOrders, 'function', 'flows.getMarketOrders exported');
assert.equal(typeof flows.getOrderbook, 'function', 'flows.getOrderbook exported');
assert.equal(typeof flows.listWatchlistForWallet, 'function',
    'flows.listWatchlistForWallet exported');
assert.equal(typeof flows.saveWatchlistEntry, 'function',
    'flows.saveWatchlistEntry exported');
assert.equal(typeof flows.clearWatchlistEntry, 'function',
    'flows.clearWatchlistEntry exported');

// --- 3. Vault + codec plumbing ----------------------------------

const vaultSrc = readFileSync(join(core, 'src', 'storage', 'Vault.js'), 'utf8');
assert.ok(/this\.watchlistEntries\s*=\s*makeCollection/.test(vaultSrc),
    'Vault mounts watchlistEntries collection');
const codecSrc = readFileSync(join(core, 'src', 'storage', 'codec.js'), 'utf8');
assert.ok(/watchlistEntries:\s*\[\]/.test(codecSrc),
    'emptyDocument initialises watchlistEntries: []');
assert.ok(/watchlistEntries:\s*parsed\.watchlistEntries/.test(codecSrc),
    'codec.decodeDocument defensively merges watchlistEntries');

// --- 4. Background handlers + messaging helpers × 3 shells -----

const bgSrc = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8',
);
for (const h of [
    'markets.list', 'markets.byPair', 'markets.history',
    'markets.orders', 'markets.orderbook',
    'watchlist.listForWallet', 'watchlist.save', 'watchlist.clear',
]) {
    assert.ok(
        new RegExp(`host\\.register\\('${h.replace('.', '\\.')}'`).test(bgSrc),
        `background registers ${h}`,
    );
}

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desk, 'renderer', 'messaging.js')],
]) {
    const msg = readFileSync(msgPath, 'utf8');
    for (const fn of [
        'getMarkets', 'getMarket', 'getMarketHistory', 'getMarketOrders',
        'getOrderbook', 'listWatchlistForWallet', 'saveWatchlistEntry',
        'clearWatchlistEntry',
    ]) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(msg),
            `${shell} messaging exports ${fn}`,
        );
    }
}

// --- 5. Home + App wiring (3 shells) ----------------------------

const homeSrc = readFileSync(join(core, 'src', 'shared', 'routes', 'Home.jsx'), 'utf8');
assert.ok(/onMarkets/.test(homeSrc), 'Home accepts onMarkets prop');
assert.ok(/>\s*Markets\s*</.test(homeSrc), 'Home renders a "Markets" button');

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desk, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(
        /import \{ MarketsList \}/.test(app),
        `${shell} App imports MarketsList`,
    );
    assert.ok(
        /unlockedView === 'markets'/.test(app),
        `${shell} App handles 'markets' sub-route`,
    );
    assert.ok(
        /unlockedView === 'market'/.test(app),
        `${shell} App reserves 'market' sub-route for the detail view (Step 2)`,
    );
    assert.ok(
        /onMarkets=\{activeWalletId/.test(app),
        `${shell} App threads onMarkets into Home`,
    );
    assert.ok(
        /activeMarket,\s*setActiveMarket/.test(app),
        `${shell} App carries activeMarket state`,
    );
}

// --- 6. Runtime watchlist CRUD against a stub vault -------------

function makeStubVault() {
    const rows = [];
    return {
        watchlistEntries: {
            async put(rec) {
                const idx = rows.findIndex((r) => r.id === rec.id);
                if (idx >= 0) rows[idx] = rec;
                else rows.push(rec);
                return rec;
            },
            async findBy(field, value) {
                return rows.filter((r) => r[field] === value).slice();
            },
            async delete(id) {
                const idx = rows.findIndex((r) => r.id === id);
                if (idx >= 0) rows.splice(idx, 1);
                return idx >= 0;
            },
        },
        _rows() { return rows.slice(); },
    };
}

const vault = makeStubVault();
// Save one entry — returns a fresh record.
const saved = await flows.saveWatchlistEntry({
    vault, walletId: 'w1', chainId: 'bitcoin-mainnet', tick1: 'MYTOKEN', tick2: 'BTC',
});
assert.equal(saved.tick1, 'MYTOKEN');
assert.equal(saved.tick2, 'BTC');
assert.equal(typeof saved.id, 'string');

// Re-save the same pair — idempotent, returns the same id.
const again = await flows.saveWatchlistEntry({
    vault, walletId: 'w1', chainId: 'bitcoin-mainnet', tick1: 'MYTOKEN', tick2: 'BTC',
});
assert.equal(again.id, saved.id, 'saveWatchlistEntry is idempotent by (walletId, chainId, tick1, tick2)');
assert.equal(vault._rows().length, 1);

// Add one for a different wallet — scoped to that wallet.
await flows.saveWatchlistEntry({
    vault, walletId: 'w2', chainId: 'bitcoin-mainnet', tick1: 'COOL', tick2: 'BTC',
});
const list1 = await flows.listWatchlistForWallet({ vault, walletId: 'w1' });
assert.equal(list1.length, 1);
assert.equal(list1[0].tick1, 'MYTOKEN');
const list2 = await flows.listWatchlistForWallet({ vault, walletId: 'w2' });
assert.equal(list2.length, 1);
assert.equal(list2[0].tick1, 'COOL');

// Clear by id.
await flows.clearWatchlistEntry({ vault, id: saved.id });
const after = await flows.listWatchlistForWallet({ vault, walletId: 'w1' });
assert.equal(after.length, 0, 'clearWatchlistEntry removes by id');

// --- 7. Validation -----------------------------------------------

const rec = schemas.createWatchlistEntry({
    walletId: 'w1', chainId: 'bitcoin-mainnet', tick1: 'A', tick2: 'B',
});
assert.equal(schemas.validateWatchlistEntry(rec).ok, true);
const bad = { ...rec, tick1: '' };
assert.equal(schemas.validateWatchlistEntry(bad).ok, false,
    'validation rejects empty tick1');

console.log(
    'OK — markets-list smoke (MarketsList §41.2 shared route + watchlist schema/flow/vault/codec plumbing + markets.* and watchlist.* background handlers + 8 messaging exports × 3 shells + Home onMarkets prop + "markets" + reserved "market" sub-routes in popup/web/desktop + runtime watchlist CRUD idempotence / per-wallet scoping / delete via stub vault)',
);
