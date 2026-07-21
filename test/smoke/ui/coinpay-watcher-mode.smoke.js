// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §20 / Cluster X Step 22: CoinpayForm watcher-mode branch.
//
// COINPAY needs a native-coin output paying the matched seller. This smoke used
// to pin the form BUILDING that output itself and passing it to the generic
// `buildActionPsbtRequest`, which is exactly the shape  removed: the
// generic builder does no verification, so a watcher could be talked into
// encoding a payment to any payee/amount its form state happened to hold, and an
// air-gapped signer only ever sees the outputs it is handed.
//
// The contract is now inverted: the form must NOT construct the payment, it must
// name the obligation and let the COINPAY-specific host route re-verify it
// against the chain and build the output from the verified row.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');
const formSrc = read('packages', 'core', 'src', 'shared', 'routes', 'CoinpayForm.jsx');

assert.match(formSrc, /import \{ useWalletMode \} from '\.\.\/hooks\/useWalletMode\.js';/);
assert.match(formSrc, /import \{ WatcherResultPanel \} from '\.\.\/components\/WatcherResultPanel\.jsx';/);
assert.match(formSrc, /const \{ isWatcherMode \} = useWalletMode\(\);/);

// Watcher mode goes through the verifying COINPAY route. (The call spreads
// `base` plus the chosen network fee under encoderOpts, so match the call,
// not the exact argument shape.)
assert.match(
    formSrc,
    /messaging\.buildCoinpayPsbtRequest\(\{\s*\n\s*\.\.\.base/,
    'watcher-mode COINPAY uses the verifying buildCoinpayPsbtRequest route',
);
assert.match(
    formSrc,
    /buildCoinpayPsbtRequest\([\s\S]{0,120}encoderOpts:\s*\{\s*feePerKb\s*\}/,
    'watcher-mode COINPAY threads the picked fee via encoderOpts.feePerKb',
);

// And must NOT hand-roll the payment output any more. Asserted against real code
// (a call site / an object key), not any mention, so the comments explaining WHY
// this is forbidden don't trip their own guard.
assert.doesNotMatch(
    formSrc,
    /customOutputs\s*:/,
    'CoinpayForm must not construct the native output itself (the host route builds it from the verified obligation)',
);
assert.doesNotMatch(
    formSrc,
    /messaging\.buildActionPsbtRequest\(/,
    'CoinpayForm must not call the generic (unverified) PSBT builder',
);

assert.match(formSrc, /Create unsigned transaction/);

// The route the form calls must actually exist on every shell's messaging
// surface, and the host must register it.
for (const [label, ...p] of [
    ['extension', 'packages', 'extension', 'src', 'popup', 'messaging.js'],
    ['web', 'packages', 'web', 'src', 'messaging.js'],
    ['desktop', 'packages', 'desktop', 'renderer', 'messaging.js'],
]) {
    assert.match(
        read(...p),
        /export function buildCoinpayPsbtRequest\(opts\)[\s\S]{0,120}sendMessage\('action\.coinpay\.psbt'/,
        `${label} messaging exports buildCoinpayPsbtRequest -> action.coinpay.psbt`,
    );
}
assert.match(
    read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js'),
    /host\.register\('action\.coinpay\.psbt'[\s\S]{0,200}buildCoinpayPsbtRequest/,
    'background host registers action.coinpay.psbt -> buildCoinpayPsbtRequest',
);

console.log('coinpay-watcher-mode smoke OK');
