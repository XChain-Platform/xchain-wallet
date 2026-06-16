// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Bench: HD child-key derivation throughput. The wallet derives many
// children at unlock + on every Receive screen reveal; a regression
// here surfaces as visible lag.

import { hdKeyFromSeed, derive } from '../../../packages/core/src/crypto/hd.js';
import { mnemonicToSeedSync } from '@scure/bip39';

const SEED = mnemonicToSeedSync(
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
);
const ROOT = hdKeyFromSeed(SEED);

export async function runScenario(run) {
    return [
        await run('hd-derive-1-leaf', () => {
            derive(ROOT, "m/44'/0'/0'/0/0");
        }, 200),
        await run('hd-derive-100-leaves', () => {
            for (let i = 0; i < 100; i += 1) {
                derive(ROOT, `m/44'/0'/0'/0/${i}`);
            }
        }, 10),
    ];
}
