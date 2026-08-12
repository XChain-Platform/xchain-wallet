// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §5.4: the §4.7 reservation ledger survives an MV3 service-
// worker kill.
//
// The mechanism (confirmActionSessionStorage) had been BUILT and left
// unconsumed - nothing but its own unit test imported it - so the ledger was
// in-memory only. On MV3 that is not a theoretical gap: Chrome may kill the
// worker after ~30s of perceived idle, which is well inside the window where a
// user is reading warnings, typing a password or waking a hardware device. A
// kill dropped every reservation, so a second approval window would see the
// full balance again and the two-window race the ledger exists to close would
// silently be back.
//
// unit/flows/confirmActionSessionStorage.test.js already proves the storage and
// the ledger work together. What this pins is the WIRING, which is what was
// actually missing.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const hostPath = join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
const storagePath = join(wsRoot, 'packages', 'extension', 'src', 'background', 'confirmActionSessionStorage.js');
const ledgerPath = join(wsRoot, 'packages', 'core', 'src', 'flows', 'reservationLedger.js');

const hostSrc = readFileSync(hostPath, 'utf8');
const storageSrc = readFileSync(storagePath, 'utf8');
const ledgerSrc = readFileSync(ledgerPath, 'utf8');

// --- 1. The host imports the persistence adapter -------------------------

assert.match(
    hostSrc,
    /import \{\s*createConfirmActionSessionStorage,\s*reservationStoreFrom,\s*\} from '\.\/confirmActionSessionStorage\.js'/,
    'createBackgroundHost imports the session-storage adapter',
);

// --- 2. ... and actually passes a store to the ledger --------------------

assert.match(
    hostSrc,
    /createReservationLedger\(\s*\n?\s*confirmSessionStorage \? \{ store: reservationStoreFrom\(confirmSessionStorage\) \} : undefined/,
    'the reservation ledger is constructed WITH the session-backed store '
    + '(an in-memory ledger loses every reservation on an SW kill)',
);

// The old state - a bare createReservationLedger() with no store - must not
// come back, since it fails silently: everything works until Chrome kills the
// worker, and then the race is quietly unprotected again.
assert.doesNotMatch(
    hostSrc,
    /const reservationLedger = createReservationLedger\(\);/,
    'the ledger is no longer constructed store-less',
);

// --- 3. The adapter degrades outside an extension -----------------------

// Web and desktop hosts run the same createBackgroundHost, and Node tests
// import it, so the adapter must return null rather than throw where
// chrome.storage.session does not exist.
assert.match(
    storageSrc,
    /if \(typeof chrome === 'undefined' \|\| !chrome\?\.storage\?\.session\) return null;/,
    'the storage adapter returns null when chrome.storage.session is absent',
);
assert.match(
    storageSrc,
    /chrome\.storage\.session/,
    'persists to storage.session (clears on browser close, right for '
    + 'approved-not-yet-broadcast state) rather than storage.local',
);

// --- 4. The ledger hydrates before answering, and is idempotent ---------

assert.match(
    ledgerSrc,
    /async function ensureHydrated\(\)/,
    'the ledger hydrates from its store before answering',
);
assert.match(
    ledgerSrc,
    /Idempotent on id \(re-reserve after a rehydrate must not double\)/,
    're-reserving the same id after a rehydrate does not double-count',
);

console.log(
    'OK: confirm reservation SW-persistence smoke (createBackgroundHost'
    + 'now backs the §4.7 reservation ledger with chrome.storage.session, so an MV3 '
    + 'worker kill mid-modal no longer drops reservations and silently re-opens the '
    + 'two-window race; adapter returns null outside an extension; ledger hydrates '
    + 'before answering and is idempotent on id)',
);
