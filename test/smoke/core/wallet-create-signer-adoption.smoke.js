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
// `wallet.add.import` adopts the new wallet's signer while the password is in
// scope. A wallet without one cannot sign without a prompt, which is invisible
// for every prompted action and total for the one feature that must act
// unattended:
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
//
// The guarded route is `wallet.add.import`: the Add Wallet create screen
// generates the mnemonic in the UI and persists it through that route, and
// `wallet.create` / `wallet.import` belong to the pre-host fresh-install lane,
// so the host must not register them (a host copy is unreachable from every
// shell, and pinning one reads green while guarding nothing).

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

const addImport = handlerBody(host, 'wallet.add.import');

assert.match(addImport, /\{\s*vault,[^}]*signerPool\s*\}/,
    'wallet.add.import is not handed the signer pool, so the wallet it adds cannot sign '
    + 'unattended (PC-16 auto-pay never fires for it)');
assert.match(addImport, /signerPool\s*&&\s*req\?\.password/,
    'wallet.add.import adopts a signer without checking it has a pool and a password');
assert.match(addImport, /signerPool\.unlockOne\(\{/,
    'wallet.add.import does not adopt the new wallet into the signer pool');
assert.match(addImport, /wallet:\s*r\.wallet/,
    'wallet.add.import adopts some wallet other than the one it just added');
assert.ok(addImport.includes('password: req.password'),
    'wallet.add.import adopts without the password the user just typed');

// The Add Wallet create screen must keep persisting through the route pinned
// above; a create lane of its own would need its own adoption and its own pin.
const createScreen = readFileSync(
    join(root, 'packages/core/src/shared/routes/CreateWallet.jsx'), 'utf8');
assert.match(createScreen, /mode === 'add'[\s\S]{0,400}messaging\.addImportedWallet\(/,
    'the Add Wallet create screen no longer persists through addImportedWallet '
    + '(wallet.add.import), so the adoption pinned above no longer covers a created wallet');

// Refuse a host copy of a pre-host type: it is unreachable, so pinning it
// reads green while guarding nothing.
for (const type of ['wallet.create', 'wallet.import']) {
    assert.equal(host.indexOf(`host.register('${type}'`), -1,
        `createBackgroundHost registers '${type}', which the pre-host lane owns: `
        + 'both transports divert it first, so that handler can never run');
}

console.log('OK: wallet-create signer-adoption smoke (a wallet created in an open session is '
    + 'signable in that session, so PC-16 auto-pay can act on its consent)');
