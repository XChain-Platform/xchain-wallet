// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §24 / G055 — Resume-last-view on unlock.
//
// Verifies:
//   1. `lastViewMemory.js` exposes the helper surface and a frozen
//      `RESUMABLE_VIEWS` allowlist.
//   2. Read/write/clear behave correctly under a stub localStorage —
//      including filtering out non-resumable views, treating Home as
//      the implicit default (no entry written), and the storage
//      defensiveness (missing localStorage / throwing localStorage
//      no-ops, missing walletId no-ops).
//   3. `useLastView` hook exists and reads/writes via the helper.
//   4. All three shell App.jsx files import the hook and call it
//      with the active walletId + current view + setUnlockedView.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// 1. Helper module + barrel-style shape.
const helperPath = 'packages/core/src/shared/utils/lastViewMemory.js';
assert.ok(existsSync(join(root, helperPath)), `${helperPath} exists`);

const helperSrc = read(helperPath);
for (const fn of ['readLastView', 'writeLastView', 'clearLastView']) {
    assert.ok(new RegExp(`export function ${fn}\\(`).test(helperSrc),
        `lastViewMemory exports ${fn}`);
}
assert.ok(/export const RESUMABLE_VIEWS = Object\.freeze\(\[/.test(helperSrc),
    'RESUMABLE_VIEWS exported as frozen array');
for (const view of ['home', 'history', 'addresses', 'actions', 'contacts', 'messaging', 'markets']) {
    assert.ok(new RegExp(`'${view}'`).test(helperSrc),
        `RESUMABLE_VIEWS includes '${view}'`);
}

// 2. Runtime — exercise read/write/clear with a stub localStorage.
const stub = {};
const stubStorage = {
    getItem(key) { return key in stub ? stub[key] : null; },
    setItem(key, val) { stub[key] = String(val); },
    removeItem(key) { delete stub[key]; },
};
globalThis.localStorage = stubStorage;

const helperUrl = `file://${join(root, helperPath)}`;
const { readLastView, writeLastView, clearLastView, RESUMABLE_VIEWS } =
    await import(helperUrl);

const W1 = 'wallet-id-1';
const W2 = 'wallet-id-2';

// Empty state.
assert.equal(readLastView(W1), null, 'fresh storage reads as null');

// Writing 'home' is a no-op (Home is the implicit default).
writeLastView(W1, 'home');
assert.equal(readLastView(W1), null, 'home is the implicit default — not stored');
assert.equal(stub['xc:lastView:' + W1], undefined, 'home write removes any existing entry');

// Writing a resumable non-home view persists.
writeLastView(W1, 'history');
assert.equal(readLastView(W1), 'history', 'resumable view round-trips');

// Different wallet id maintains its own bucket.
assert.equal(readLastView(W2), null, 'second walletId not contaminated');
writeLastView(W2, 'contacts');
assert.equal(readLastView(W2), 'contacts', 'second walletId persists independently');
assert.equal(readLastView(W1), 'history', 'first walletId still has its value');

// Writing a non-resumable view no-ops.
writeLastView(W1, 'send');
assert.equal(readLastView(W1), 'history', 'send is non-resumable — no overwrite');
writeLastView(W1, 'token-detail');
assert.equal(readLastView(W1), 'history', 'token-detail is non-resumable — no overwrite');

// Clearing drops the entry.
clearLastView(W1);
assert.equal(readLastView(W1), null, 'clearLastView wipes the entry');
assert.equal(readLastView(W2), 'contacts', 'clearLastView only touches one walletId');

// Missing / non-string walletId no-ops both ways.
assert.equal(readLastView(null), null, 'null walletId reads null');
assert.equal(readLastView(undefined), null, 'undefined walletId reads null');
assert.equal(readLastView(''), null, 'empty walletId reads null');
writeLastView(null, 'history');
writeLastView(undefined, 'history');
writeLastView('', 'history');
clearLastView(null);
clearLastView('');
// Should not have written anything new for a null walletId.
let wroteNullKey = false;
for (const key of Object.keys(stub)) {
    if (!key.endsWith(W2)) wroteNullKey = true;
}
assert.equal(wroteNullKey, false, 'null/empty walletId never produces a storage key');

// A persisted view that's no longer in the resumable set reads as null
// (handles spec drift — view was removed but a stale entry survives).
stub['xc:lastView:' + W1] = 'not-a-real-view';
assert.equal(readLastView(W1), null, 'persisted view outside resumable set reads null');

// Defensiveness — a localStorage that throws on every call must not crash.
const throwingStorage = {
    getItem() { throw new Error('boom'); },
    setItem() { throw new Error('boom'); },
    removeItem() { throw new Error('boom'); },
};
globalThis.localStorage = throwingStorage;
assert.equal(readLastView(W1), null, 'throwing localStorage reads null');
writeLastView(W1, 'history');     // must not throw
clearLastView(W1);                // must not throw

// Restore stub for any later tests.
globalThis.localStorage = stubStorage;

// 3. Hook module.
const hookPath = 'packages/core/src/shared/hooks/useLastView.js';
assert.ok(existsSync(join(root, hookPath)), `${hookPath} exists`);
const hookSrc = read(hookPath);
assert.ok(/export function useLastView\(/.test(hookSrc),
    'useLastView is a named export');
assert.ok(/import \{ readLastView, writeLastView \} from/.test(hookSrc),
    'hook imports both helpers from lastViewMemory');
assert.ok(/lastResumedFor\.current === walletId/.test(hookSrc),
    'hook guards against re-resuming for the same walletId');

// 4. All three shells wire the hook.
const shells = [
    'packages/extension/src/popup/App.jsx',
    'packages/web/src/App.jsx',
    'packages/desktop/renderer/App.jsx',
];
for (const shellPath of shells) {
    const src = read(shellPath);
    assert.ok(/import \{ useLastView \} from '@xchain-wallet\/core\/shared\/hooks\/useLastView\.js'/.test(src),
        `${shellPath} imports useLastView`);
    assert.ok(/useLastView\(\{[\s\S]*walletId: activeWalletId,[\s\S]*currentView: unlockedView,[\s\S]*onResume: setUnlockedView,/.test(src),
        `${shellPath} calls useLastView with active wallet / current view / setter`);
}

console.log('OK — last-view memory + useLastView hook + 3 shells wiring smoke');
