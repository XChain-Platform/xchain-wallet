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
// extension/web packages consume). A `describe.skipIf` gate here used to
// let this guard vanish silently whenever the sibling wasn't checked out,
// which is exactly the failure mode the guard exists to catch (uuid
// 9737f60d): a routine xchain-sdk wif bump would pass CI unnoticed in any
// job that doesn't happen to check out siblings. The guard must fail loud
// instead: this suite requires the xchain-sdk sibling to be present.
//
// Note: xchain-sdk's coin data (src/coins/*.js) carries no SLIP-44 /
// coin-type field, but src/derivation.js exposes FAMILY_SLIP44 as the
// backend-side coin-type anchor precisely so this suite has a real SDK value
// to assert the wallet's FAMILY_MAINNET_COIN_TYPE_SLOT against (the coin-type
// leg below binds the two across repos, rather than checking the wallet
// constant against itself).

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_DESCRIPTORS, FAMILY_MAINNET_COIN_TYPE_SLOT } from '../../../packages/core/src/registry/index.js';
import { ADDRESS_PARAMS } from '../../../packages/core/src/shared/utils/addressValidation.js';

const here = dirname(fileURLToPath(import.meta.url));
const sdkNetworksPath = join(here, '..', '..', '..', '..', 'xchain-sdk', 'src', 'networks.js');
const haveSdk = existsSync(sdkNetworksPath);

// Mainnet SLIP-44 slot per chain family: the parity anchor the descriptors,
// signers, and backend all agree on, on EVERY network of the family. Sourced
// from the registry (validate.js) so the runtime install-time guard and this
// CI guard cannot drift apart.
const MAINNET_SLOT = FAMILY_MAINNET_COIN_TYPE_SLOT;

describe('wallet descriptors vs xchain-sdk network params', () => {
    if (!haveSdk) {
        // House convention (see test/unit/ActionManifestConformance.test.js and
        // xchain-sync/.github/workflows/ci.yml): SKIP when the sibling is absent
        // unless XCHAIN_REQUIRE_SIBLINGS=1, which only the drift-guards CI job
        // (which actually checks out the sibling) sets. That job fails loud;
        // ordinary single-repo checkouts skip instead of reddening every push.
        it('parity guard requires the xchain-sdk sibling checkout', (ctx) => {
            if (process.env.XCHAIN_REQUIRE_SIBLINGS === '1') {
                throw new Error(
                    `xchain-sdk sibling not found at ${sdkNetworksPath}. This suite guards ` +
                    'wallet descriptor wifVersionByte/coin-type parity against xchain-sdk and ' +
                    'must run with the sibling checked out; XCHAIN_REQUIRE_SIBLINGS=1 was set ' +
                    'but the SDK is absent.'
                );
            }
            ctx.skip();
        });
        return;
    }

    const require = createRequire(import.meta.url);
    const { NETWORKS } = require(sdkNetworksPath);
    // Backend-side coin-type anchor (SDK). FAMILY_SLIP44 is keyed by ticker with
    // a numeric value ({ BTC: 0 }); COIN_FULL_NAME bridges ticker -> full coin
    // name so it compares to the wallet's FAMILY_MAINNET_COIN_TYPE_SLOT (keyed
    // by full name with a quoted-string value { bitcoin: "0'" }).
    const sdkDerivationPath = join(here, '..', '..', '..', '..', 'xchain-sdk', 'src', 'derivation.js');
    const sdkCoinsPath = join(here, '..', '..', '..', '..', 'xchain-sdk', 'src', 'coins', 'index.js');
    const { FAMILY_SLIP44 } = require(sdkDerivationPath);
    const { COIN_FULL_NAME } = require(sdkCoinsPath);

    // Cross-repo coin-type parity: bind the wallet's per-family mainnet slot to
    // the SDK's authoritative FAMILY_SLIP44 anchor, so a one-sided edit to
    // either hand-copied constant fails CI (the anchor's whole reason to exist).
    for (const [tick, slip44] of Object.entries(FAMILY_SLIP44)) {
        it(`${tick}: wallet coin-type slot matches xchain-sdk FAMILY_SLIP44`, () => {
            const fullName = COIN_FULL_NAME[tick];
            expect(fullName, `xchain-sdk COIN_FULL_NAME has no entry for "${tick}"`).toBeTruthy();
            expect(MAINNET_SLOT[fullName], `wallet FAMILY_MAINNET_COIN_TYPE_SLOT has no entry for "${fullName}"`).toBe(`${slip44}'`);
        });
    }

    for (const d of BUNDLED_DESCRIPTORS) {
        it(`${d.id}: wifVersionByte matches xchain-sdk net.wif`, () => {
            const net = NETWORKS[d.id];
            expect(net, `xchain-sdk has no network "${d.id}"`).toBeTruthy();
            expect(d.wifVersionByte).toBe(net.wif);
        });

        it(`${d.id}: ADDRESS_PARAMS byte params match xchain-sdk (pubKeyHash/scriptHash/bech32)`, () => {
            // The wif leg above guards one hand-copied registry value; these are
            // its three siblings (addressValidation.ADDRESS_PARAMS), read at
            // runtime by matchesParams to accept/reject recipient addresses. An
            // SDK bump that moves any byte would otherwise leave the wallet
            // silently rejecting addresses the backend considers valid.
            const [family, networkKind] = d.id.split('-');
            const params = ADDRESS_PARAMS[family]?.[networkKind];
            expect(params, `wallet ADDRESS_PARAMS has no entry for ${d.id}`).toBeTruthy();
            const net = NETWORKS[d.id];
            expect(net, `xchain-sdk has no network "${d.id}"`).toBeTruthy();
            expect(params.p2pkh, `${d.id} p2pkh vs net.pubKeyHash`).toBe(net.pubKeyHash);
            expect(params.p2sh, `${d.id} p2sh vs net.scriptHash`).toBe(net.scriptHash);
            expect(params.hrp, `${d.id} hrp vs net.bech32`).toBe(net.bech32 ?? null);
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
