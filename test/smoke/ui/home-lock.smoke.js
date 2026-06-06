// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke test for Batch 2 piece 6 (Home screen + wallet.lock + auto-lock).
//
// Behavioural coverage exercises the lock path end-to-end through the
// pre-host dispatcher:
//   1. With a populated session, wallet.lock clears the session backend,
//      fires onLocked, and flips session.status back to `locked`.
//   2. With no session, wallet.lock is still idempotent — returns
//      `locked: true` without error.
//
// Static coverage asserts Home.jsx wires lockWallet + listWallets +
// getWalletBalances + useAutoLock, that ChainBalanceCard exists with
// ChainBadge integration, and that messaging.js exposes the full set.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import {
    PRE_HOST_MESSAGE_TYPES,
    attachSessionMetaListener,
} from '../../../packages/extension/src/background/sessionMeta.js';
import { ChromeSessionBackend } from '../../../packages/extension/src/storage/ChromeSessionBackend.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const ext = join(wsRoot, 'packages', 'extension');

// --- 1. Static surface ------------------------------------------------

assert.ok(
    PRE_HOST_MESSAGE_TYPES.has('wallet.lock'),
    'wallet.lock added to PRE_HOST_MESSAGE_TYPES',
);

// Home lives at @xchain-wallet/core/shared/routes/Home.jsx now. It
// resolves lockWallet / listWallets / getWalletBalances off the
// messaging module passed into <MessagingProvider>, and uses the
// shared useAutoLock hook + ChainBalanceCard component.
const sharedHome = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Home.jsx');
const home = readFileSync(sharedHome, 'utf8');
for (const call of [
    'messaging.lockWallet',
    'messaging.listWallets',
    'messaging.getWalletBalances',
]) {
    assert.ok(home.includes(call), `shared Home.jsx wires ${call}`);
}
for (const symbol of ['useAutoLock', 'ChainBalanceCard']) {
    assert.ok(home.includes(symbol), `shared Home.jsx imports ${symbol}`);
}
assert.ok(
    /registry as registryLib/.test(home),
    'shared Home.jsx imports registry namespace for descriptor lookups',
);

const msg = readFileSync(
    join(ext, 'src', 'popup', 'messaging.js'),
    'utf8',
);
for (const fn of ['lockWallet', 'listWallets', 'getWalletBalances']) {
    assert.ok(
        new RegExp(`export function ${fn}\\b`).test(msg),
        `messaging.js exports ${fn}`,
    );
}
assert.ok(msg.includes("'wallet.lock'"), 'lockWallet targets wallet.lock');
assert.ok(msg.includes("'wallet.list'"), 'listWallets targets wallet.list');
assert.ok(
    msg.includes("'balances.wallet'"),
    'getWalletBalances targets balances.wallet',
);

const hook = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'hooks', 'useAutoLock.js'),
    'utf8',
);
assert.ok(
    /export function useAutoLock/.test(hook),
    'shared useAutoLock.js exports the hook',
);
for (const ev of ['mousemove', 'keydown', 'scroll', 'click', 'touchstart']) {
    assert.ok(
        hook.includes(`'${ev}'`),
        `shared useAutoLock listens for ${ev}`,
    );
}

const card = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'ChainBalanceCard.jsx'),
    'utf8',
);
assert.ok(
    /export function ChainBalanceCard/.test(card),
    'shared ChainBalanceCard exports the component',
);
assert.ok(card.includes('ChainBadge'), 'shared ChainBalanceCard uses ChainBadge');

const bg = readFileSync(join(ext, 'src', 'background.js'), 'utf8');
assert.ok(bg.includes('tearDownHost'), 'background.js defines tearDownHost');
assert.ok(
    bg.includes('onLocked:'),
    'background.js passes onLocked to sessionMeta listener',
);
assert.ok(
    bg.includes('detachHost = attachChromeRuntime'),
    'background.js captures the attachChromeRuntime detach fn',
);

// --- 2. Behavioural: lock from populated session ---------------------

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
        fire(message) {
            return new Promise((resolve) => {
                const done = (r) => resolve(r);
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

function withChrome(seed, fn) {
    const stub = {
        storage: {
            local: makeFakeStorage(seed.local || {}),
            session: makeFakeStorage(seed.session || {}),
        },
    };
    const prev = globalThis.chrome;
    globalThis.chrome = stub;
    return Promise.resolve(fn(stub)).finally(() => {
        globalThis.chrome = prev;
    });
}

// 2a. Populated session → lock clears it + fires onLocked + status flips.
await withChrome(
    {
        local: {
            'xchain-wallet:vault': Buffer.from([1, 2, 3]).toString('base64'),
        },
        session: {
            'xchain-wallet:session': Buffer.from(new Array(32).fill(9)).toString('base64'),
        },
    },
    async (stub) => {
        let onLockedFired = 0;
        const fake = makeFakeRuntime();
        attachSessionMetaListener(
            { onLocked: () => { onLockedFired++; } },
            fake.runtime,
        );

        // Baseline: unlocked.
        {
            const r = await fake.fire({ type: 'session.status' });
            assert.equal(r.result.state, 'unlocked');
        }

        // Lock.
        const lockResp = await fake.fire({ type: 'wallet.lock' });
        assert.deepEqual(lockResp, { ok: true, result: { locked: true } });
        assert.equal(onLockedFired, 1, 'onLocked fired exactly once');

        // Session backend is empty.
        const session = new ChromeSessionBackend({
            chromeStorage: stub.storage.session,
        });
        assert.equal(await session.load(), null, 'session cleared');

        // session.status now reports `locked` (wallet still present).
        {
            const r = await fake.fire({ type: 'session.status' });
            assert.equal(r.result.state, 'locked');
        }
    },
);

// 2b. Idempotent: lock with no session still succeeds.
await withChrome(
    {
        local: {
            'xchain-wallet:vault': Buffer.from([1, 2, 3]).toString('base64'),
        },
    },
    async () => {
        const fake = makeFakeRuntime();
        let onLockedFired = 0;
        attachSessionMetaListener(
            { onLocked: () => { onLockedFired++; } },
            fake.runtime,
        );
        const r = await fake.fire({ type: 'wallet.lock' });
        assert.deepEqual(r, { ok: true, result: { locked: true } });
        // onLocked still fires — the callback shouldn't be gated on prior session.
        assert.equal(onLockedFired, 1, 'onLocked fires even without session');
    },
);

console.log(
    'OK — home+lock smoke (static wiring, lock-from-unlocked, idempotent lock)',
);
