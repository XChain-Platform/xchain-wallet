// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke test: a failed vault.open() in the extension's ensureHost must not
// leave the session master key and the cached signing secret resident.
//
// Before the guard, `ensureHost()` opened the vault with no error handling.
// A vault blob the cached key cannot decrypt (blob replaced, storage
// corruption, a partially-written vault) left `host` null while both
// chrome.storage.session slots survived, and `maybeAutoLock` returns early
// on `!host`, so the idle backstop could never reclaim them either. The
// desktop shell already rolls back at the same point (runtime.js's
// ensureHost catch closes the vault and clears its session backend).
//
// Static coverage pins the guard in background.js. Behavioural coverage
// drives the rollback machinery the guard delegates to (handleWalletLock
// over real ChromeSessionBackend instances) and proves BOTH slots are gone.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { handleWalletLock } from '../../../packages/extension/src/background/walletLock.js';
import { ChromeSessionBackend } from '../../../packages/extension/src/storage/ChromeSessionBackend.js';
import { SIGNING_SECRET_SESSION_KEY } from '../../../packages/extension/src/background/signingSecretSession.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const ext = join(wsRoot, 'packages', 'extension');

// --- 1. Static: the guard is wired into ensureHost ---------------------

const bg = readFileSync(join(ext, 'src', 'background.js'), 'utf8');

const guarded = /try\s*\{\s*await vault\.open\(\);\s*\}\s*catch\s*\(err\)\s*\{/;
assert.ok(
    guarded.test(bg),
    'background.js wraps ensureHost vault.open() in a try/catch',
);

const rollback = bg.slice(bg.search(guarded));
assert.ok(
    /await lockWalletNow\(\)/.test(rollback.slice(0, 800)),
    'the vault.open() catch rolls the session back through lockWalletNow()',
);
assert.ok(
    /throw err;/.test(rollback.slice(0, 800)),
    'the vault.open() catch rethrows so callers still see the failure',
);

// lockWalletNow is what clears both slots; keep its shape pinned here too,
// since the guard is only as good as what it delegates to.
assert.ok(
    /signingSecretBackend: new ChromeSessionBackend\(\{ key: SIGNING_SECRET_SESSION_KEY \}\)/.test(bg),
    'lockWalletNow passes the signing-secret backend to handleWalletLock',
);

// --- 2. Behavioural: the rollback clears both session slots ------------

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
        snapshot() { return { ...store }; },
    };
}

const session = makeFakeStorage({
    'xchain-wallet:session': 'AAECAwQFBgcICQoLDA0ODw==',
    [SIGNING_SECRET_SESSION_KEY]: 'aHVudGVyMg==',
});

let tornDown = 0;
const result = await handleWalletLock(null, {
    sessionBackend: new ChromeSessionBackend({ chromeStorage: session }),
    signingSecretBackend: new ChromeSessionBackend({
        key: SIGNING_SECRET_SESSION_KEY,
        chromeStorage: session,
    }),
    onLocked: () => { tornDown++; },
});

assert.deepEqual(result, { locked: true }, 'rollback lock resolves');
assert.equal(tornDown, 1, 'rollback tears the host down');

const left = session.snapshot();
assert.equal(
    left['xchain-wallet:session'],
    undefined,
    'session master key is gone after the rollback',
);
assert.equal(
    left[SIGNING_SECRET_SESSION_KEY],
    undefined,
    'cached signing secret is gone after the rollback',
);

console.log(
    'OK: extension ensureHost rollback smoke (guard wired, both session slots cleared)',
);
