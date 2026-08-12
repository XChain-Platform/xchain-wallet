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
// WHERE THE SDK COMES FROM, and it changed under this test (DD6).
// It used to be loaded from a sibling checkout, matching the `link:` target
// the shells consumed. DD6 moved all three shells to the published
// `@dankest-llc/xchain-sdk`, and the sibling half of this guard then failed
// on every push: the CI step checking out the private sibling repo errored
// `Not Found`, because the deploy-key secret it names has never existed on
// this repo (measured 2026-08-02: the repo has no Actions secrets at all).
//
// So the SDK is now resolved through the same `xchain-sdk` alias the shells
// import, from `packages/core`, which reads the SDK the wallet actually
// SHIPS rather than whatever sibling master happens to be checked out. That
// is the stronger comparison of the two: a published SDK the lockfile pins
// is what users get, and it is what a release signs.
//
// A sibling checkout is still honoured when one is present, so working
// across both repos locally keeps behaving as before. What is NOT tolerated
// is finding neither: a `describe.skipIf` here used to let the guard vanish
// silently whenever the SDK was absent, which is exactly the failure mode
// the guard exists to catch (uuid 9737f60d) - a routine xchain-sdk wif bump
// passing CI unnoticed. It fails loud instead.
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

// Resolve through the `xchain-sdk` alias as packages/core sees it (the
// published package), falling back to a sibling checkout. Returns null when
// neither exists, which the gate below turns into a loud failure.
const requireFromCore = createRequire(join(here, '..', '..', '..', 'packages', 'core', 'package.json'));
const sdkFile = (...parts) => {
    const spec = `xchain-sdk/${parts.join('/')}`;
    try {
        return requireFromCore.resolve(spec);
    } catch {
        const sibling = join(here, '..', '..', '..', '..', 'xchain-sdk', ...parts);
        return existsSync(sibling) ? sibling : null;
    }
};

const sdkNetworksPath = sdkFile('src', 'networks.js');
const haveSdk = sdkNetworksPath !== null;

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
        it('parity guard requires the xchain-sdk package', (ctx) => {
            if (process.env.XCHAIN_REQUIRE_SIBLINGS === '1') {
                throw new Error(
                    'xchain-sdk could not be resolved, either as the published package via the ' +
                    '`xchain-sdk` alias in packages/core or as a sibling checkout. This suite ' +
                    'guards wallet descriptor wifVersionByte/coin-type parity against xchain-sdk ' +
                    'and must run with the SDK present; XCHAIN_REQUIRE_SIBLINGS=1 was set but ' +
                    'the SDK is absent.'
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
    const sdkDerivationPath = sdkFile('src', 'derivation.js');
    const sdkCoinsPath = sdkFile('src', 'coins', 'index.js');
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
