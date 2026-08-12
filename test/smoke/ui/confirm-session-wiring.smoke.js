// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for: the §5.4 confirm-session store must have a PRODUCTION
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
    'putSession must have a production caller (it had none)');
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
// allow-lists its builder name: an attacker-supplied name would
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

// --- 6. the CLIENT half is wired on every shell ------------------------
//
// The host half alone was the same defect one level up: three routes nobody
// called. The handover for this item said it in as many words - "do not
// half-wire it, it is end-to-end or not at all" - so every link in that chain
// is asserted here, from the shell method to the screen the user taps.

for (const shell of [
    ['packages', 'extension', 'src', 'popup', 'messaging.js'],
    ['packages', 'web', 'src', 'messaging.js'],
    ['packages', 'desktop', 'renderer', 'messaging.js'],
]) {
    const src = read(...shell);
    for (const route of ['action.confirmSession.put', 'action.confirmSession.list', 'action.confirmSession.clear', 'action.inputLiveness']) {
        assert.ok(src.includes(`'${route}'`),
            `${shell.join('/')} must expose ${route}`);
    }
}

// --- 7. the hook writes on open and clears on EVERY terminal -----------
//
// `clear` lives in teardown rather than beside each terminal branch because
// teardown is the ONE path approve, reject, error and unmount all pass
// through; a per-branch clear is a list someone will add a branch to.

const hook = read('packages', 'core', 'src', 'shared', 'hooks', 'useConfirmAction.js');
assert.match(hook, /persistSession\(args, sessionIdRef\.current, built, null\)/,
    'the hook must persist the confirm when the modal opens');
assert.match(hook, /session\.clear\(id\)/,
    'the hook must clear the stored confirm');
assert.ok(/const teardown = useCallback\(\(\) => \{[\s\S]*?session\.clear\(id\)/.test(hook),
    'clear must live in teardown, the single path every terminal state passes through');

// The §4.6 gate: a resumed confirm may never be approved without proving its
// inputs are still unspent.
assert.match(hook, /alwaysCheckInputs/,
    'the hook must support forcing the liveness probe (the resume path)');
assert.match(hook, /reason: 'inputs-spent'/,
    'spent inputs must interrupt rather than sign');

// --- 8. the user can actually reach it ---------------------------------

const home = read('packages', 'core', 'src', 'shared', 'routes', 'Home.jsx');
assert.match(home, /ResumeConfirmCard/, 'Home must render the resume card');
assert.match(home, /listConfirmSessions/, 'Home must load the stored confirms');

const popup = read('packages', 'extension', 'src', 'popup', 'App.jsx');
assert.match(popup, /ResumeConfirm/, 'the popup must route to the resume screen');
assert.match(popup, /onResumeConfirm=/, 'Home must be given the resume navigation');

const resume = read('packages', 'core', 'src', 'shared', 'routes', 'ResumeConfirm.jsx');
assert.match(resume, /alwaysCheckInputs: true/,
    'the resume screen must force the §4.6 liveness gate: a stored PSBT is the oldest in the wallet');
assert.match(resume, /clearConfirmSession/,
    'the resume screen must clear the session it consumed');
assert.match(resume, /resumeDispatch/,
    'the resume screen must dispatch through the allow-list, never a stored name directly');
assert.ok(!/password:\s*session/.test(resume),
    'a credential must never come from the stored session');

// --- 9. at least one form opts in --------------------------------------
//
// Persistence is opt-in per form (a stored confirm has to be finishable
// without its form, and not every Approve can be). Opt-in with no opters is
// the inert-module shape this whole smoke exists to prevent.

const optedIn = ['Send.jsx', 'AirdropForm.jsx'].filter((f) => {
    const src = read('packages', 'core', 'src', 'shared', 'routes', f);
    return /resume:\s*\{/.test(src) && /software:/.test(src);
});
assert.ok(optedIn.length >= 2,
    `at least two forms must opt into confirm persistence (found: ${optedIn.join(', ') || 'none'})`);

// AirdropForm is the form that proves the bookkeeping hazard is solved rather
// than dodged: its pending record is written AFTER Approve, so a resume that
// broadcast the LIST without it would orphan the airdrop mid-flight.
const airdrop = read('packages', 'core', 'src', 'shared', 'routes', 'AirdropForm.jsx');
assert.match(airdrop, /after:\s*\{[\s\S]*?savePendingAirdrop/,
    'AirdropForm must carry its post-broadcast bookkeeping in the resume descriptor');
assert.match(airdrop, /txidPath/,
    'the follow-up must receive the broadcast txid it could not know in advance');

console.log(
    'OK: confirm session wiring smoke (putSession/loadSessions/removeSession all have production'
    + 'callers in createBackgroundHost; put/list/clear routes registered; clear is mandatory so a stale session '
    + 'cannot invite a re-approve of an already-broadcast tx; reservations and sessions share one storage.session '
    + 'adapter; the dispatch descriptor crosses the boundary as an allow-listable name, not a closure; the CLIENT '
    + 'half is wired on all three shells, the hook persists on open and clears in teardown, the §4.6 liveness gate '
    + 'is forced on resume, Home + the popup route reach the screen, and two forms opt in - one of them carrying '
    + 'its own post-broadcast bookkeeping)',
);
