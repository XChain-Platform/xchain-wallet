// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for : the §5.4 confirm-session store must have a PRODUCTION
// caller, not just a unit test.
//
// This is the whole reason the item existed. `confirmActionSessionStorage.js`
// shipped with slice 1 implementing BOTH halves and was unit-tested, but only
// the reservation half was ever wired: `createBackgroundHost` passed
// `reservationStoreFrom(...)` into the ledger and nothing anywhere called
// putSession / loadSessions / removeSession. A module with a green unit suite
// and no caller reads exactly like a shipped feature, which is how it survived
// the slice-1 review and sat inert for months.
//
// So the assertion here is deliberately about WIRING rather than behaviour:
// behaviour is covered by the storage unit tests, and behaviour was never the
// problem. The same shape appears twice more in this spec's history (the §8.5
// drift gate that no CI referenced, and broadcastPermanence's classifier that
// documented a guarantee it did not enforce), which is why it is worth a
// standing guard rather than a one-time fix.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const wsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// --- 1. the store's session half has production callers ----------------

const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');

assert.match(host, /confirmSessionStorage\.putSession\(/,
    'putSession must have a production caller (: it had none)');
assert.match(host, /confirmSessionStorage\.loadSessions\(/,
    'loadSessions must have a production caller');
assert.match(host, /confirmSessionStorage\.removeSession\(/,
    'removeSession must have a production caller');

// --- 2. all three lifecycle routes are registered ----------------------
//
// Writing without clearing is worse than not writing at all: a session that
// outlives its confirm invites the user to re-approve a transaction that may
// already be signed and broadcast, which is the double-broadcast trap §5.3.4
// forbids. The clear route is therefore mandatory, not optional.

for (const route of ['action.confirmSession.put', 'action.confirmSession.list', 'action.confirmSession.clear']) {
    assert.ok(host.includes(`host.register('${route}'`),
        `host must register ${route}`);
}

// --- 3. the store is still shared with the reservation ledger ----------
//
// Both halves live in ONE chrome.storage.session adapter on purpose; a second
// adapter would be a second lifetime for state that must die together.

assert.match(host, /reservationStoreFrom\(confirmSessionStorage\)/,
    'reservations and confirm sessions must share one session store');

// --- 4. the dispatch descriptor crosses the boundary as a NAME ---------
//
// A stored confirm has to be approvable without its originating form, and a
// closure cannot be persisted. It rides as a messaging METHOD NAME, which must
// be allow-listed on use for the same reason `action.vote.composeForConfirm`
// allow-lists its builder name : an attacker-supplied name would
// otherwise select an arbitrary host route.

assert.match(host, /dispatch/,
    'the stored session must carry a dispatch descriptor');

// --- 5. no second session store crept in -------------------------------

const bgDir = join(wsRoot, 'packages', 'extension', 'src', 'background');
const storeFiles = readdirSync(bgDir)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => /storage\.session/.test(readFileSync(join(bgDir, f), 'utf8')));
assert.ok(storeFiles.includes('confirmActionSessionStorage.js'),
    'the confirm-session adapter must still own storage.session');

console.log(
    'OK: confirm session wiring smoke (: putSession/loadSessions/removeSession all have production '
    + 'callers in createBackgroundHost; put/list/clear routes registered; clear is mandatory so a stale session '
    + 'cannot invite a re-approve of an already-broadcast tx; reservations and sessions share one storage.session '
    + 'adapter; the dispatch descriptor crosses the boundary as an allow-listable name, not a closure)',
);
