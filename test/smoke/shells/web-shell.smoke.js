// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke test for Batch 4 piece 11 (web SPA shell).
//
// Behavioural coverage drives the in-page host bridge through its
// three states (no-wallet / locked / unlocked) using a real vault +
// real AES-GCM crypto, with injected fakes for localStorage and
// IndexedDB so no browser is required:
//
//   1. Fresh page, empty storage  → getSessionStatus → no-wallet
//   2. Seed a vault + meta slot, unlock with right password, verify
//      host wires up (listWallets via sendMessage returns seeded data)
//   3. Wrong-password unlock throws InvalidPasswordError without
//      opening the host
//   4. lockWalletLocal tears the host down; sendMessage on a closed
//      session rejects with VaultClosedError
//
// Static coverage asserts the Vite config enables @vitejs/plugin-react,
// index.html references main.jsx, App.jsx covers the 5 router states,
// ExtensionBanner listens for the inject-script's init event, and the
// web package depends on @xchain-wallet/extension for the shared host
// factory.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import {
    crypto as cryptoLib,
    schemas,
    storage as storageLib,
} from '../../../packages/core/src/index.js';
import { IndexedDBStorageBackend } from '../../../packages/web/src/storage/IndexedDBStorageBackend.js';
import { WebMetaBackend } from '../../../packages/web/src/storage/WebMetaBackend.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const webPkg = join(wsRoot, 'packages', 'web');

// --- 1. Static surface ------------------------------------------------

const indexHtml = readFileSync(join(webPkg, 'index.html'), 'utf8');
assert.ok(
    indexHtml.includes('id="xchain-web-root"'),
    'index.html has root div',
);
assert.ok(
    /src="\/src\/main\.jsx"/.test(indexHtml),
    'index.html references main.jsx',
);

const viteCfg = readFileSync(join(webPkg, 'vite.config.js'), 'utf8');
assert.ok(
    /import react from '@vitejs\/plugin-react'/.test(viteCfg),
    'web vite.config imports @vitejs/plugin-react',
);
assert.ok(/react\(\)/.test(viteCfg), 'web vite.config enables react plugin');

const webPkgJson = JSON.parse(
    readFileSync(join(webPkg, 'package.json'), 'utf8'),
);
assert.ok(
    webPkgJson.dependencies?.['@xchain-wallet/extension'],
    'web depends on @xchain-wallet/extension for the shared host factory',
);
assert.ok(webPkgJson.dependencies?.react, 'web depends on react');

const app = readFileSync(join(webPkg, 'src', 'App.jsx'), 'utf8');
for (const state of ['loading', 'error', 'no-wallet', 'locked', 'unlocked']) {
    assert.ok(app.includes(`'${state}'`), `App.jsx handles ${state}`);
}
assert.ok(app.includes('getSessionStatus'), 'App.jsx queries getSessionStatus');

// Locked hoisted to @xchain-wallet/core/shared/routes; the shared
// version unlocks via useMessaging(); the web App renders the
// ExtensionBanner at App level, not inside the route.
const sharedLocked = readFileSync(
    join(webPkg, '..', 'core', 'src', 'shared', 'routes', 'Locked.jsx'),
    'utf8',
);
assert.ok(
    sharedLocked.includes('messaging.unlockWallet'),
    'shared Locked.jsx calls messaging.unlockWallet',
);
assert.ok(
    sharedLocked.includes("'InvalidPasswordError'"),
    'shared Locked.jsx distinguishes InvalidPasswordError',
);
assert.ok(
    app.includes('<ExtensionBanner'),
    'web App.jsx renders ExtensionBanner at App level',
);

// Home is shared. The shell-variant driver (screenVariantFor) picks
// Screen variant="full" when shell === 'web'; the web App wraps with
// <MessagingProvider shell="web" ...>.
const home = readFileSync(
    join(webPkg, '..', 'core', 'src', 'shared', 'routes', 'Home.jsx'),
    'utf8',
);
for (const call of [
    'messaging.lockWallet',
    'messaging.listWallets',
    'messaging.getWalletBalances',
]) {
    assert.ok(home.includes(call), `shared Home.jsx wires ${call}`);
}
assert.ok(
    /screenVariantFor/.test(home),
    'shared Home.jsx drives Screen variant from shell',
);
assert.ok(
    /shell=\{shell\}/.test(app) && /shellForVariant\(/.test(app),
    'web App.jsx wraps in MessagingProvider with the resolved shell',
);

const banner = readFileSync(
    join(webPkg, 'src', 'components', 'ExtensionBanner.jsx'),
    'utf8',
);
assert.ok(
    banner.includes("'xchain#initialized'"),
    'ExtensionBanner listens for window.xchain init event',
);
assert.ok(
    /window\.xchain/.test(banner),
    'ExtensionBanner checks window.xchain presence',
);

// --- 2. In-page host bridge round-trip -------------------------------

// Minimal in-memory fakes for the two browser storage surfaces the
// web shell uses. Both match the subset of methods WebMetaBackend /
// IndexedDBStorageBackend touch.

function makeFakeLocalStorage() {
    let store = {};
    return {
        getItem(k) { return store[k] ?? null; },
        setItem(k, v) { store[k] = String(v); },
        removeItem(k) { delete store[k]; },
        _dump: () => ({ ...store }),
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

// A shared fake localStorage for the whole run. Module-scoped;
// `globalThis.localStorage` is read by WebMetaBackend's default
// constructor path, so tests that don't inject can still exercise the
// real load/save code path.
const fakeLocalStorage = makeFakeLocalStorage();
globalThis.localStorage = fakeLocalStorage;

// The in-page hostBridge uses DEFAULT_DB_NAME / DEFAULT_STORAGE_KEY;
// we inject the same KvStore into both its IndexedDBStorageBackend
// instances by monkey-patching the class's default-store opener for
// this test run.
const fakeKv = makeFakeKvStore();

// Subclass IndexedDBStorageBackend to swap the real IDB opener out.
// (Cleaner than stubbing idb internals across Node versions.)
const originalOpen = IndexedDBStorageBackend.prototype._openStore;
IndexedDBStorageBackend.prototype._openStore = function _openStore() {
    this._store = fakeKv;
    return Promise.resolve(fakeKv);
};

// Import the hostBridge only AFTER the stubs are in place so its
// module-scoped registries / SDK never touches real IDB.
const hostBridge = await import('../../../packages/web/src/hostBridge.js');

// 2a. Fresh page → no-wallet.
{
    const status = await hostBridge.getSessionStatus();
    assert.deepEqual(status, {
        hasWallet: false,
        hasSession: false,
        state: 'no-wallet',
    });
}

// Seed a real encrypted vault + kdfParams meta slot so unlock has
// something to authenticate against.
const password = 'correct horse battery staple';
const kdfParams = cryptoLib.makeFreshKdfParams();

{
    const masterKey = cryptoLib.deriveMasterKey(password, kdfParams);
    try {
        const backend = new IndexedDBStorageBackend();
        const vault = new storageLib.Vault({ backend, masterKey });
        await vault.open();
        // Persist a minimal wallet record so `listWallets` has something
        // to return after unlock.
        await vault.wallets.put(
            schemas.createWallet({
                name: 'Web wallet',
                origin: 'created',
                format: 'bip39',
                passphraseEnabled: false,
                encryptedSeed: 'c3R1Yg==',
                kdfParams,
            }),
        );
        await vault.save();
        vault.close();
    } finally {
        masterKey.fill(0);
    }
    await new WebMetaBackend().save({ kdfParams });
}

// 2b. Vault present, not unlocked → locked.
{
    const status = await hostBridge.getSessionStatus();
    assert.deepEqual(status, {
        hasWallet: true,
        hasSession: false,
        state: 'locked',
    });
}

// 2c. Wrong password → InvalidPasswordError, host stays down.
{
    let caught = null;
    try {
        await hostBridge.unlockWalletLocal({ password: 'wrong' });
    } catch (err) {
        caught = err;
    }
    assert.ok(caught, 'wrong password throws');
    assert.equal(caught.name, 'InvalidPasswordError');
    const status = await hostBridge.getSessionStatus();
    assert.equal(status.state, 'locked', 'still locked after wrong password');
}

// 2d. Right password → unlocked; sendMessage works; listWallets
//      returns the seeded wallet.
{
    const result = await hostBridge.unlockWalletLocal({ password });
    assert.deepEqual(result, { unlocked: true });
    const status = await hostBridge.getSessionStatus();
    assert.equal(status.state, 'unlocked');

    const wallets = /** @type {any[]} */ (
        await hostBridge.sendMessage('wallet.list')
    );
    assert.equal(wallets.length, 1);
    assert.equal(wallets[0].name, 'Web wallet');
}

// 2e. Lock → host torn down, sendMessage rejects.
{
    await hostBridge.lockWalletLocal();
    const status = await hostBridge.getSessionStatus();
    assert.equal(status.state, 'locked', 'lock flips to locked');

    let caught = null;
    try {
        await hostBridge.sendMessage('wallet.list');
    } catch (err) {
        caught = err;
    }
    assert.ok(caught, 'sendMessage after lock throws');
    assert.equal(caught.name, 'VaultClosedError');
}

// Cleanup: restore the original opener so other smokes that import
// IndexedDBStorageBackend aren't affected.
IndexedDBStorageBackend.prototype._openStore = originalOpen;

console.log(
    'OK: web shell smoke (static wiring + hostBridge: no-wallet / locked / wrong / unlocked / lock)',
);
