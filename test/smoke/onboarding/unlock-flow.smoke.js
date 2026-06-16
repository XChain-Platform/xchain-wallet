// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke test for Batch 2 piece 5 (real unlock screen).
//
// Runs the unlock handler against real crypto. Builds a genuine
// encrypted vault blob + plaintext kdfParams meta in a fake chrome
// storage, then drives `wallet.unlock` through:
//
//   1. Wrong password        → InvalidPasswordError
//   2. Right password        → {unlocked: true}, session populated, onUnlocked fires
//   3. No vault meta in slot → NoVaultError
//
// Also covers the static surface: popup UI wires to unlockWallet(),
// messaging.js exposes it, ChromeMetaBackend is exported, and the
// session-meta listener co-exists cleanly with the existing
// session.status flow (wrong password ≠ "no wallet").

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

// Node 18 exposes `globalThis.crypto` only under the experimental flag.
// `@noble/hashes` + `crypto.getRandomValues` in kdf.js expect the bare
// global, and the `crypto.subtle` AES-GCM used by Vault opens through
// the same surface — install the polyfill before importing anything
// that touches it.
if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import {
    crypto as cryptoLib,
    storage as storageLib,
} from '../../../packages/core/src/index.js';
import { ChromeStorageBackend } from '../../../packages/extension/src/storage/ChromeStorageBackend.js';
import { ChromeSessionBackend } from '../../../packages/extension/src/storage/ChromeSessionBackend.js';
import { ChromeMetaBackend } from '../../../packages/extension/src/storage/ChromeMetaBackend.js';
import {
    PRE_HOST_MESSAGE_TYPES,
    attachSessionMetaListener,
} from '../../../packages/extension/src/background/sessionMeta.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const ext = join(wsRoot, 'packages', 'extension');

// --- 1. Static surface -------------------------------------------------

// Locked was hoisted from the popup into the shared-routes namespace
// (piece 1 of the §40 shared-routes refactor). The popup App wires
// <MessagingProvider shell="popup" messaging={messaging}> so this
// shared route calls messaging.unlockWallet under the hood.
const locked = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Locked.jsx'),
    'utf8',
);
assert.ok(
    locked.includes('messaging.unlockWallet'),
    'shared Locked.jsx calls messaging.unlockWallet',
);
assert.ok(
    locked.includes('type="password"'),
    'shared Locked.jsx renders a password input',
);
assert.ok(
    locked.includes("'InvalidPasswordError'"),
    'shared Locked.jsx distinguishes InvalidPasswordError',
);
assert.ok(
    locked.includes('autoComplete="current-password"'),
    'shared Locked.jsx password input has autoComplete hint',
);
const popupApp = readFileSync(
    join(ext, 'src', 'popup', 'App.jsx'),
    'utf8',
);
assert.ok(
    popupApp.includes('shell="popup"') && popupApp.includes('MessagingProvider'),
    'popup App.jsx wraps in MessagingProvider shell="popup"',
);

const msg = readFileSync(
    join(ext, 'src', 'popup', 'messaging.js'),
    'utf8',
);
assert.ok(
    /export function unlockWallet/.test(msg),
    'messaging.js exports unlockWallet',
);
assert.ok(
    msg.includes("'wallet.unlock'"),
    'unlockWallet targets wallet.unlock',
);

const storageIdx = readFileSync(
    join(ext, 'src', 'storage', 'index.js'),
    'utf8',
);
assert.ok(
    storageIdx.includes('ChromeMetaBackend'),
    'storage/index.js re-exports ChromeMetaBackend',
);

assert.ok(
    PRE_HOST_MESSAGE_TYPES.has('session.status'),
    'pre-host types include session.status',
);
assert.ok(
    PRE_HOST_MESSAGE_TYPES.has('wallet.unlock'),
    'pre-host types include wallet.unlock',
);

// --- 2. Behavioural: real unlock crypto against a real blob ------------

function makeFakeStorage(seed = {}) {
    let store = { ...seed };
    return {
        async get(key) {
            if (typeof key === 'string') return { [key]: store[key] };
            return { ...store };
        },
        async set(obj) { Object.assign(store, obj); },
        async remove(key) {
            if (Array.isArray(key)) for (const k of key) delete store[k];
            else delete store[key];
        },
        _store() { return store; },
    };
}

function makeFakeRuntime() {
    const listeners = [];
    return {
        runtime: {
            onMessage: {
                addListener(fn) { listeners.push(fn); },
                removeListener(fn) {
                    const i = listeners.indexOf(fn);
                    if (i >= 0) listeners.splice(i, 1);
                },
            },
            lastError: null,
        },
        async fire(message) {
            return new Promise((resolve) => {
                const done = (response) => resolve(response);
                let handled = false;
                for (const l of listeners) {
                    const r = l(message, {}, done);
                    if (r === true) { handled = true; break; }
                }
                if (!handled) {
                    resolve({
                        ok: false,
                        error: { name: 'Unhandled', message: 'no listener' },
                    });
                }
            });
        },
    };
}

async function setUpVault(chromeStub, password) {
    // Real KDF → real master key → real AES-GCM blob. The resulting
    // layout matches what background.js's `ensureHost` reads on startup.
    const kdfParams = cryptoLib.makeFreshKdfParams();
    const masterKey = cryptoLib.deriveMasterKey(password, kdfParams);
    const storage = new ChromeStorageBackend({
        chromeStorage: chromeStub.storage.local,
    });
    const meta = new ChromeMetaBackend({
        chromeStorage: chromeStub.storage.local,
    });
    await meta.save({ kdfParams });
    const vault = new storageLib.Vault({ backend: storage, masterKey });
    await vault.open();
    await vault.save();
    vault.close();
    masterKey.fill(0);
}

function withChromeStubs(fn) {
    const stub = {
        storage: {
            local: makeFakeStorage(),
            session: makeFakeStorage(),
        },
    };
    const prev = globalThis.chrome;
    globalThis.chrome = stub;
    return Promise.resolve(fn(stub)).finally(() => {
        globalThis.chrome = prev;
    });
}

// 2a. No vault planted → NoVaultError.
await withChromeStubs(async () => {
    const fake = makeFakeRuntime();
    attachSessionMetaListener({}, fake.runtime);
    const r = await fake.fire({
        type: 'wallet.unlock',
        request: { password: 'anything' },
    });
    assert.equal(r.ok, false, 'no-vault unlock fails');
    assert.equal(r.error.name, 'NoVaultError');
});

// 2b. Right password → unlocks, seeds session, fires onUnlocked.
await withChromeStubs(async (stub) => {
    const password = 'correct horse battery staple';
    await setUpVault(stub, password);

    let onUnlockedFired = 0;
    const fake = makeFakeRuntime();
    attachSessionMetaListener(
        { onUnlocked: () => { onUnlockedFired++; } },
        fake.runtime,
    );

    // Pre-unlock: session.status reports `locked`.
    {
        const r = await fake.fire({ type: 'session.status' });
        assert.deepEqual(r, {
            ok: true,
            result: { hasWallet: true, hasSession: false, state: 'locked' },
        });
    }

    // Unlock with the right password.
    const r = await fake.fire({
        type: 'wallet.unlock',
        request: { password },
    });
    assert.deepEqual(r, { ok: true, result: { unlocked: true } });
    assert.equal(onUnlockedFired, 1, 'onUnlocked fired exactly once');

    // Session backend now has a 32-byte master key.
    const session = new ChromeSessionBackend({
        chromeStorage: stub.storage.session,
    });
    const loaded = await session.load();
    assert.ok(loaded instanceof Uint8Array, 'session backend has a byte blob');
    assert.equal(loaded.length, 32, 'session key is 32 bytes');

    // Post-unlock: session.status reports `unlocked`.
    {
        const r2 = await fake.fire({ type: 'session.status' });
        assert.equal(r2.result.state, 'unlocked');
    }
});

// 2c. Wrong password → InvalidPasswordError, session stays empty.
await withChromeStubs(async (stub) => {
    const password = 'correct horse battery staple';
    await setUpVault(stub, password);

    let onUnlockedFired = 0;
    const fake = makeFakeRuntime();
    attachSessionMetaListener(
        { onUnlocked: () => { onUnlockedFired++; } },
        fake.runtime,
    );

    const r = await fake.fire({
        type: 'wallet.unlock',
        request: { password: 'wrong password' },
    });
    assert.equal(r.ok, false, 'wrong password rejected');
    assert.equal(r.error.name, 'InvalidPasswordError');
    assert.equal(onUnlockedFired, 0, 'onUnlocked NOT fired on bad password');

    const session = new ChromeSessionBackend({
        chromeStorage: stub.storage.session,
    });
    assert.equal(await session.load(), null, 'session backend still empty');
});

// 2d. Empty-string password → guarded at the handler boundary.
await withChromeStubs(async (stub) => {
    await setUpVault(stub, 'whatever');
    const fake = makeFakeRuntime();
    attachSessionMetaListener({}, fake.runtime);
    const r = await fake.fire({
        type: 'wallet.unlock',
        request: { password: '' },
    });
    assert.equal(r.ok, false, 'empty password rejected');
    assert.ok(
        /password is required/i.test(r.error.message),
        'empty password surfaces "password is required"',
    );
});

console.log(
    'OK — unlock flow smoke (static checks + 4 behavioural cases: no-vault / success / wrong / empty)',
);
