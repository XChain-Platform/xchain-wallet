// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for: every surface that approves a wallet-composed action passes the
// two Approve-time guards useConfirmAction only runs when asked for.
//
// `checkInputs` is the §4.6 input-liveness re-check: without it a PSBT left
// on the confirm screen past a competing spend is signed and fails for good
// at broadcast. `reservationLedger` is the §4.7 host-shared reservation:
// without it two windows can both approve against the same token balance.
// The hook skips each one silently when the argument is missing, so no hook
// test can see a form that never passes them. Forms on
// useActionConfirmFlow.run inherit both; a form that calls
// confirmAction.confirm itself has to pass them by hand, and this is the
// assertion that it did.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const wsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// --- 1. the hook only runs the guards when a caller passes them -------

const hook = read('packages', 'core', 'src', 'shared', 'hooks', 'useConfirmAction.js');
assert.match(hook, /typeof args\.checkInputs === 'function'/,
    'the confirm hook runs the liveness re-check only for a caller that passes it');
assert.match(hook, /if \(args\.reservationLedger &&/,
    'the confirm hook reserves only for a caller that passes the ledger');

// --- 2. the shared flow passes both for every migrated form -----------

const flow = read('packages', 'core', 'src', 'shared', 'hooks', 'useActionConfirmFlow.js');
assert.match(flow, /checkInputs: \(psbtHex\) => messaging\.checkInputLiveness\(/,
    'useActionConfirmFlow.run passes the liveness re-check');
assert.match(flow, /reservationLedger: \{/,
    'useActionConfirmFlow.run passes the reservation ledger');

// --- 3. every direct confirm caller passes both by hand ---------------

const routesDir = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes');
// Two surfaces approve nothing the wallet composed, and say why here rather
// than by omission. PsbtSignForm signs a PSBT a dApp handed it, so its compose
// carries no simulation to reserve from. SignMessageForm signs a message
// off-chain, with no transaction and no inputs at all.
const EXEMPT = new Set(['PsbtSignForm.jsx', 'SignMessageForm.jsx']);

const unguarded = readdirSync(routesDir)
    .filter((f) => f.endsWith('.jsx') && !EXEMPT.has(f))
    .filter((f) => {
        const src = readFileSync(join(routesDir, f), 'utf8');
        if (!src.includes('confirmAction.confirm({')) return false;
        return !/checkInputs: \(psbtHex\) => messaging\.checkInputLiveness\(/.test(src)
            || !/reservationLedger: \{/.test(src);
    });
assert.deepEqual(unguarded, [],
    `these forms approve a composed action without the liveness re-check or the reservation ledger: ${unguarded.join(', ')}`);

console.log('approve-guards wiring smoke: OK');
