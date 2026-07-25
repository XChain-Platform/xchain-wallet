// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  (D-21): a P2SH/P2WSH two-phase REVEAL tx spends the chunk-lane
// data-carrier outputs, whose redeem script is a custom "<data> OP_DROP
// <P2PKH gate>" that the default single-sig finalizer cannot finalize
// ("Can not finalize input #0"). SoftwareSigner.signPsbt must route the
// reveal (phase 2) through sdk.wallet.signRevealPsbt (custom finalizer,
// sign-all) instead of the scoped sdk.wallet.signPsbt (default finalizer)
// used for phase 1. submitWithSigner sets `reveal: true` on the phase-2 call.

import { describe, it, expect } from 'vitest';
import { SoftwareSigner } from '../../../packages/core/src/signers/SoftwareSigner.js';

const PATH = "m/84'/0'/0'/0/0";
const CHAIN = 'bitcoin';

function makeSigner() {
    const calls = { signPsbt: [], signRevealPsbt: [] };
    const wallet = {
        signPsbt: (psbtHex, wif, opts) => {
            calls.signPsbt.push({ psbtHex, wif, opts });
            return { txHex: 'phase1hex', txid: 'phase1txid', psbtHex: 'phase1signed' };
        },
        signRevealPsbt: (psbtHex, wif) => {
            calls.signRevealPsbt.push({ psbtHex, wif });
            return { txHex: 'revealhex', txid: 'revealtxid', psbtHex: 'revealsigned' };
        },
    };
    const sdkRegistry = { get: () => ({ wallet }) };
    const signer = new SoftwareSigner({
        id: 'sw-1',
        displayName: 'Test',
        chainRegistry: { get: () => ({}) },
        walletEncryption: {},
        sdkRegistry,
    });
    // Bypass password unlock + real key derivation: seed the unlocked state and
    // stub WIF resolution (this test asserts routing, not derivation).
    const seed = new Uint8Array(64);
    signer._acceptUnlockedState({ mnemonicBytes: new Uint8Array(0), seed, importedWifs: new Map() });
    signer._resolveWifForEntry = () => 'cTestWifPlaceholder';
    return { signer, calls };
}

describe('SoftwareSigner.signPsbt reveal routing ', () => {
    const params = { psbtHex: 'deadbeef', chainId: CHAIN, signingPaths: [{ inputIndex: 0, path: PATH }] };

    it('reveal:true routes to sdk.wallet.signRevealPsbt (custom finalizer, sign-all)', async () => {
        const { signer, calls } = makeSigner();
        const out = await signer.signPsbt({ ...params, reveal: true });
        expect(calls.signRevealPsbt.length).toBe(1);
        expect(calls.signPsbt.length).toBe(0);
        // reveal path signs ALL inputs; it must NOT pass scoped inputIndices.
        expect(calls.signRevealPsbt[0]).toEqual({ psbtHex: 'deadbeef', wif: 'cTestWifPlaceholder' });
        expect(out).toEqual({ signedPsbtHex: 'revealsigned', txHex: 'revealhex', txid: 'revealtxid' });
    });

    it('reveal falsy routes to the scoped sdk.wallet.signPsbt (default finalizer)', async () => {
        const { signer, calls } = makeSigner();
        const out = await signer.signPsbt(params);
        expect(calls.signPsbt.length).toBe(1);
        expect(calls.signRevealPsbt.length).toBe(0);
        expect(calls.signPsbt[0].opts).toEqual({ inputIndices: [0] });
        expect(out).toEqual({ signedPsbtHex: 'phase1signed', txHex: 'phase1hex', txid: 'phase1txid' });
    });
});
