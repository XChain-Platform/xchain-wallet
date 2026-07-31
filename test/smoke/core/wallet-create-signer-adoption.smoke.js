// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke: a wallet CREATED inside an open session joins the signer pool, the
// same way an IMPORTED one does.
//
// `wallet.add.import` has always adopted the new wallet's signer while the
// password is in scope. `wallet.create` - the other half of the same Add
// Wallet flow - was not even handed `signerPool`, so the wallet it made could
// not sign without a prompt. That is invisible for every prompted action and
// total for the one feature that must act unattended:
//
//   MEASURED on Litecoin regtest 2026-07-29. A wallet created mid-session
//   armed PC-16 auto-pay on a native-GIVE order; its success screen promised
//   "matches on this order will be paid automatically while a wallet holding
//   it is unlocked". The order matched, the obligation was created, the wallet
//   sat open and unlocked on that screen for TEN MINUTES, and no COINPAY was
//   ever sent - CoinpayAutopayWatcher asks getSigner(walletId), got null, and
//   classified the wallet unsignable. The manual queue paid it immediately.
//
// Behaviour is proven by tests/dex/order-match-coinpay.regtest.spec.js against
// a live chain; this pins the wiring that spec depends on, which is one line
// away from being lost again.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const host = readFileSync(
    join(root, 'packages/extension/src/background/createBackgroundHost.js'), 'utf8');

/** The body of a host.register('<type>', ...) handler, up to the next register. */
function handlerBody(source, type) {
    const start = source.indexOf(`host.register('${type}'`);
    assert.notEqual(start, -1, `no handler registered for ${type}`);
    const next = source.indexOf('host.register(', start + 1);
    return source.slice(start, next === -1 ? source.length : next);
}

const create = handlerBody(host, 'wallet.create');
const addImport = handlerBody(host, 'wallet.add.import');

assert.match(create, /\{\s*vault,[^}]*signerPool\s*\}/,
    'wallet.create is not handed the signer pool, so the wallet it creates cannot sign '
    + 'unattended (PC-16 auto-pay never fires for it)');
assert.match(create, /signerPool\s*&&\s*req\?\.password/,
    'wallet.create adopts a signer without checking it has a pool and a password');
assert.match(create, /signerPool\.unlockOne\(\{/,
    'wallet.create does not adopt the new wallet into the signer pool');
assert.match(create, /wallet:\s*r\.wallet/,
    'wallet.create adopts some wallet other than the one it just created');

// The two halves of Add Wallet must not diverge again: whatever import does
// here, create does too.
for (const marker of ['signerPool.unlockOne({', 'password: req.password']) {
    assert.ok(addImport.includes(marker), `wallet.add.import lost its own adoption (${marker})`);
    assert.ok(create.includes(marker), `wallet.create diverged from wallet.add.import (${marker})`);
}

console.log('OK: wallet-create signer-adoption smoke (a wallet created in an open session is '
    + 'signable in that session, so PC-16 auto-pay can act on its consent)');
