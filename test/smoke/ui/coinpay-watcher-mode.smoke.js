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
// COINPAY needs a native-coin output paying the matched seller. The form must
// not build that output itself and pass it to the generic
// `buildActionPsbtRequest`: the generic builder does no verification, so a
// watcher could be talked into encoding a payment to any payee or amount its form
// state happened to hold, and an air-gapped signer only sees the outputs it is
// handed.
//
// The watcher branch must not construct the payment. It names the obligation
// and lets the COINPAY-specific host route re-verify it against the chain and
// build the output from the verified row.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');
const formSrc = read('packages', 'core', 'src', 'shared', 'routes', 'CoinpayForm.jsx');
const ownerLaneSrc = read('packages', 'core', 'src', 'shared', 'hooks', 'useOwnerActionLane.js');

assert.match(formSrc, /import \{ useOwnerActionLane \} from '\.\.\/hooks\/useOwnerActionLane\.js';/);
assert.match(formSrc, /import \{ WatcherResultPanel \} from '\.\.\/components\/WatcherResultPanel\.jsx';/);
assert.match(formSrc, /const ownerLane = useOwnerActionLane\(\{/);
assert.match(ownerLaneSrc, /import \{ useWalletMode \} from '\.\/useWalletMode\.js';/);
assert.match(ownerLaneSrc, /const \{ isWatcherMode \} = useWalletMode\(\);/);
assert.match(ownerLaneSrc, /return \{[\s\S]{0,80}\bisWatcherMode,/);
assert.match(formSrc, /if \(ownerLane\.isWatcherMode\) \{/);
const watcherStart = formSrc.indexOf('if (ownerLane.isWatcherMode) {');
const watcherEnd = formSrc.indexOf('} else {', watcherStart);
assert.ok(watcherEnd > watcherStart, 'watcher-mode COINPAY has its own submit branch');
const watcherBranch = formSrc.slice(
    watcherStart,
    watcherEnd,
);

// Watcher mode goes through the verifying COINPAY route. (The call spreads
// `base` plus the chosen network fee under encoderOpts, so match the call,
// not the exact argument shape.)
assert.match(
    watcherBranch,
    /messaging\.buildCoinpayPsbtRequest\(\{\s*\n\s*\.\.\.base/,
    'watcher-mode COINPAY uses the verifying buildCoinpayPsbtRequest route',
);
assert.match(
    watcherBranch,
    /buildCoinpayPsbtRequest\([\s\S]{0,120}encoderOpts:\s*\{\s*feePerKb\s*\}/,
    'watcher-mode COINPAY threads the picked fee via encoderOpts.feePerKb',
);

// Keep the watcher branch away from hand-rolled payment outputs and the generic
// builder because neither re-verifies the obligation against the chain.
assert.doesNotMatch(
    watcherBranch,
    /customOutputs\s*:/,
    'watcher-mode COINPAY must not construct the native output itself',
);
assert.doesNotMatch(
    watcherBranch,
    /messaging\.buildActionPsbtRequest\(/,
    'watcher-mode COINPAY must not call the generic (unverified) PSBT builder',
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
