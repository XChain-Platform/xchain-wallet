// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke test for Batch 4 piece 12 (web onboarding).
//
// Closes the loop the TEST_DAPP_RUNBOOK currently calls out as the
// bootstrap gap. Exercises both create + import against a real Vault
// with a real BIP39 mnemonic, then verifies the post-state:
//
//   1. Static wiring — routes exist, messaging helpers exported, App
//      has the create/import sub-route, the dev-mock SDK is flagged
//      in-line so it can't quietly reach mainnet.
//   2. createWalletLocal → mnemonic returned, vault persisted to the
//      fake IDB, meta persisted to the fake localStorage, session
//      transitions to `unlocked`, `wallet.list` returns the new
//      wallet, lockWalletLocal → locked, unlockWalletLocal with the
//      SAME password → unlocked again (proves kdfParams round-trip
//      cleanly).
//   3. importMnemonicLocal with a fresh BIP39 phrase → same post-state
//      shape as create.
//   4. Attempting to create or import when meta already exists →
//      "a wallet already exists" error (idempotence guard).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import { crypto as cryptoLib } from '../../../packages/core/src/index.js';
import { IndexedDBStorageBackend } from '../../../packages/web/src/storage/IndexedDBStorageBackend.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const webPkg = join(wsRoot, 'packages', 'web');

// --- 1. Static wiring -------------------------------------------------

const app = readFileSync(join(webPkg, 'src', 'App.jsx'), 'utf8');
for (const sub of ['welcome', 'create', 'import']) {
    assert.ok(app.includes(`'${sub}'`), `App.jsx sub-route ${sub}`);
}
assert.ok(app.includes('<CreateWallet'), 'App.jsx renders CreateWallet');
assert.ok(app.includes('<ImportWallet'), 'App.jsx renders ImportWallet');

// CreateWallet + ImportWallet live in @xchain-wallet/core/shared/routes
// and reach messaging.importMnemonic through the MessagingProvider.
const sharedRoutes = join(webPkg, '..', 'core', 'src', 'shared', 'routes');
const create = readFileSync(join(sharedRoutes, 'CreateWallet.jsx'), 'utf8');
assert.ok(
    /messaging\.importMnemonic\(\{ password, mnemonic, name \}\)/.test(create),
    'shared CreateWallet persists via messaging.importMnemonic (post-confirm commit)',
);
assert.ok(
    /generateBip39Mnemonic/.test(create),
    'shared CreateWallet generates BIP39 mnemonic client-side',
);
assert.ok(create.includes('MnemonicGrid'), 'shared CreateWallet shows the mnemonic grid');

const importR = readFileSync(join(sharedRoutes, 'ImportWallet.jsx'), 'utf8');
assert.ok(
    /ACCEPTED_WORD_COUNTS\s*=\s*\[12,\s*15,\s*18,\s*21,\s*24\]/.test(importR),
    'shared ImportWallet validates BIP39 word counts',
);

const msg = readFileSync(join(webPkg, 'src', 'messaging.js'), 'utf8');
for (const fn of ['createWallet', 'importMnemonic']) {
    assert.ok(
        new RegExp(`export function ${fn}\\b`).test(msg),
        `messaging.js exports ${fn}`,
    );
}

const host = readFileSync(join(webPkg, 'src', 'hostBridge.js'), 'utf8');
assert.ok(
    /xchain-sdk isn't resolvable|sdkResolved/.test(host),
    'hostBridge references the real-SDK resolver with dev-mock fallback',
);
assert.ok(
    /createWalletLocal/.test(host),
    'hostBridge exports createWalletLocal',
);
assert.ok(
    /importMnemonicLocal/.test(host),
    'hostBridge exports importMnemonicLocal',
);
assert.ok(
    /DEFAULT_ACTIVE_CHAIN_IDS/.test(host),
    'hostBridge defines DEFAULT_ACTIVE_CHAIN_IDS',
);

// --- 2. In-page onboarding round-trip -------------------------------

// Inject storage fakes (see web-shell.smoke.js for the pattern).
function makeFakeLocalStorage() {
    let store = {};
    return {
        getItem(k) { return store[k] ?? null; },
        setItem(k, v) { store[k] = String(v); },
        removeItem(k) { delete store[k]; },
    };
}

function makeFakeKvStore() {
    const map = new Map();
    return {
        async get(k) { return map.get(k); },
        async set(k, v) { map.set(k, v); },
        async delete(k) { map.delete(k); },
    };
}

const fakeLocalStorage = makeFakeLocalStorage();
globalThis.localStorage = fakeLocalStorage;

// Swap in our fake KV store for every IDB backend instance.
const fakeKv = makeFakeKvStore();
const originalOpen = IndexedDBStorageBackend.prototype._openStore;
IndexedDBStorageBackend.prototype._openStore = function _openStore() {
    this._store = fakeKv;
    return Promise.resolve(fakeKv);
};

const hostBridge = await import('../../../packages/web/src/hostBridge.js');

// 2a. Fresh page — no wallet.
{
    const s = await hostBridge.getSessionStatus();
    assert.equal(s.state, 'no-wallet');
}

// 2b. Create flow.
const createPassword = 'correct horse battery staple';
let createdMnemonic = null;
{
    const result = await hostBridge.createWalletLocal({
        password: createPassword,
        name: 'Unit Wallet',
        strengthBits: 128,
    });
    assert.ok(typeof result.mnemonic === 'string', 'create returns mnemonic');
    createdMnemonic = result.mnemonic;
    assert.equal(result.mnemonic.trim().split(/\s+/).length, 12, '12-word mnemonic');
    assert.equal(result.walletName, 'Unit Wallet');

    const s = await hostBridge.getSessionStatus();
    assert.equal(s.state, 'unlocked', 'host is live immediately after create');

    const wallets = /** @type {any[]} */ (await hostBridge.sendMessage('wallet.list'));
    assert.equal(wallets.length, 1);
    assert.equal(wallets[0].name, 'Unit Wallet');
    assert.equal(wallets[0].format, 'bip39');
}

// 2c. Lock + unlock round-trip with the same password — proves meta
//     + kdfParams persisted correctly so a subsequent session can
//     decrypt the blob.
{
    await hostBridge.lockWalletLocal();
    const s1 = await hostBridge.getSessionStatus();
    assert.equal(s1.state, 'locked');

    await hostBridge.unlockWalletLocal({ password: createPassword });
    const s2 = await hostBridge.getSessionStatus();
    assert.equal(s2.state, 'unlocked', 'unlock-after-create works');
}

// 2d. Idempotence guard — second create throws.
{
    let caught = null;
    try {
        await hostBridge.createWalletLocal({ password: 'another', name: 'x' });
    } catch (err) {
        caught = err;
    }
    assert.ok(caught, 'second create rejects');
    assert.match(caught.message, /already exists/i);
}

// --- 3. Reset storage and exercise import ---------------------------

fakeKv._store = new Map();
const origStore = new Map();
// Reset fake KV (Map) and localStorage fully between the two flows.
for (const k of Array.from(fakeKv._store?.keys?.() || [])) fakeKv._store.delete(k);
// Deeper reset — swap in brand-new Maps/objects.
{
    const freshKv = makeFakeKvStore();
    const freshLocal = makeFakeLocalStorage();
    IndexedDBStorageBackend.prototype._openStore = function _openStore() {
        this._store = freshKv;
        return Promise.resolve(freshKv);
    };
    globalThis.localStorage = freshLocal;
    // Force the hostBridge module to rebuild its host on next call by
    // locking first (clears module-scoped vault/host refs).
    await hostBridge.lockWalletLocal();

    const s = await hostBridge.getSessionStatus();
    assert.equal(s.state, 'no-wallet', 'after reset, back to no-wallet');
}

// 3b. Import with a fresh, valid BIP39 phrase.
{
    const mnemonic = cryptoLib.generateBip39Mnemonic(128);
    const result = await hostBridge.importMnemonicLocal({
        password: 'another-secure-password',
        mnemonic,
        name: 'Imported',
    });
    assert.equal(result.format, 'bip39');
    assert.equal(result.walletName, 'Imported');

    const s = await hostBridge.getSessionStatus();
    assert.equal(s.state, 'unlocked');

    const wallets = /** @type {any[]} */ (await hostBridge.sendMessage('wallet.list'));
    assert.equal(wallets.length, 1);
    assert.equal(wallets[0].origin, 'imported-mnemonic');
}

// 3c. Second import also rejects with "already exists".
{
    let caught = null;
    try {
        await hostBridge.importMnemonicLocal({
            password: 'x',
            mnemonic: cryptoLib.generateBip39Mnemonic(128),
            name: 'Nope',
        });
    } catch (err) {
        caught = err;
    }
    assert.ok(caught, 'second import rejects');
    assert.match(caught.message, /already exists/i);
}

// Restore the original IDB opener.
IndexedDBStorageBackend.prototype._openStore = originalOpen;

console.log(
    'OK — web onboarding smoke (static wiring + create/import round-trips + lock/unlock persistence + idempotence guards)',
);
