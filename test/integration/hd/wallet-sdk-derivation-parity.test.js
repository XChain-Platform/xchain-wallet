// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Integration: wallet descriptors vs xchain-sdk network params.
//
// The descriptors' wifVersionByte and SLIP-44 coin-type slots are
// hand-maintained copies of the values xchain-sdk generates from
// src/coins/*.js. They are consumed independently at runtime
// (SoftwareSigner WIF-encodes with descriptor.wifVersionByte while
// address encoding rides sdk.wallet.deriveAddress and the SDK's own
// networks.js), so the two sides were held equal by prose comments
// alone. This test reads BOTH and asserts equality per (coin, network),
// so a descriptor edit, SDK bump, or copied-in coin fails CI instead
// of silently WIF-encoding keys the backend decodes differently.
//
// The SDK is loaded from the sibling checkout (the same link: target the
// extension/web packages consume). When the sibling is absent (isolated
// per-repo checkout) the suite skips; CI jobs that check out siblings run it.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const sdkNetworksPath = join(here, '..', '..', '..', '..', 'xchain-sdk', 'src', 'networks.js');
const haveSdk = existsSync(sdkNetworksPath);

// Mainnet SLIP-44 slot per chain family: the parity anchor the descriptors,
// signers, and backend all agree on, on EVERY network of the family.
const MAINNET_SLOT = { bitcoin: "0'", litecoin: "2'", dogecoin: "3'" };

describe.skipIf(!haveSdk)('wallet descriptors vs xchain-sdk network params', () => {
    const require = createRequire(import.meta.url);
    const { NETWORKS } = haveSdk ? require(sdkNetworksPath) : { NETWORKS: {} };

    for (const d of BUNDLED_DESCRIPTORS) {
        it(`${d.id}: wifVersionByte matches xchain-sdk net.wif`, () => {
            const net = NETWORKS[d.id];
            expect(net, `xchain-sdk has no network "${d.id}"`).toBeTruthy();
            expect(d.wifVersionByte).toBe(net.wif);
        });

        it(`${d.id}: every derivation path uses the family's mainnet SLIP-44 slot`, () => {
            const family = d.id.split('-')[0];
            const slot = MAINNET_SLOT[family];
            expect(slot, `unknown chain family "${family}"`).toBeTruthy();
            for (const [addressType, template] of Object.entries(d.derivationPaths)) {
                const m = template.match(/^m\/\d+'\/(\d+')\//);
                expect(m, `${d.id} ${addressType}: unrecognized template "${template}"`).toBeTruthy();
                expect(m[1], `${d.id} ${addressType}`).toBe(slot);
            }
        });
    }
});
