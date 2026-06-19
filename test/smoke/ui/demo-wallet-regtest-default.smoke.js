// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Cluster J FOLLOWUP 7: demo wallets activate on the regtest networks
// rather than mainnet. Pairs with FOLLOWUP 1 (synthesizeDemo* flows
// short-circuit the chain fetch entirely so the wallet never actually
// hits a regtest node), but keeps any future "fan out a real fetch"
// code path off mainnet under demo.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const onboardingSrc = read('packages/core/src/shared/routes/Onboarding.jsx');

// 1. The demo handler tags the FOLLOWUP id.
assert.ok(/Cluster J FOLLOWUP 7/.test(onboardingSrc),
    'Onboarding.jsx tags Cluster J FOLLOWUP 7');

// 2. handleEnterDemo passes regtest chain ids (all three) to
//    importMnemonic. The array may also contain mainnet / testnet ids;
//    the key invariant is that all three regtest ids are present.
assert.ok(/activeChainIds:[\s\S]*?'bitcoin-regtest'/.test(onboardingSrc),
    'handleEnterDemo includes bitcoin-regtest in activeChainIds');
assert.ok(/activeChainIds:[\s\S]*?'litecoin-regtest'/.test(onboardingSrc),
    'handleEnterDemo includes litecoin-regtest in activeChainIds');
assert.ok(/activeChainIds:[\s\S]*?'dogecoin-regtest'/.test(onboardingSrc),
    'handleEnterDemo passes the three regtest chain ids to importMnemonic');

// 3. The same call still passes name: 'Demo Wallet' so the rest of
//    the demo wiring (DemoBanner detection via name, markDemoWallet
//    via id) keeps working.
assert.ok(/name: 'Demo Wallet'/.test(onboardingSrc),
    'handleEnterDemo still names the wallet "Demo Wallet"');

// 4. Chain descriptors for the three regtest ids exist in the bundled
//    registry, so the chainRegistry.has() check inside importMnemonic
//    succeeds at runtime.
const chainSources = [
    'packages/core/src/registry/descriptors/bitcoin.js',
    'packages/core/src/registry/descriptors/litecoin.js',
    'packages/core/src/registry/descriptors/dogecoin.js',
];
for (const path of chainSources) {
    const src = read(path);
    const coin = path.match(/descriptors\/(\w+)\.js$/)[1];
    assert.ok(new RegExp(`id: '${coin}-regtest'`).test(src),
        `${coin} descriptor file declares the regtest chain`);
}

console.log('OK: demo wallet regtest defaults');
