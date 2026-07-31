// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-120: the watcher / encode-only lane must tell the encoder WHICH ADDRESS is
// spending.
//
// FOUND LIVE, driving campaign §11.3's watcher lane on Bitcoin regtest. Every
// build died on:
//
//     Encoder RPC error: Error getting utxos:
//     03c015d1857ef0227b38b31b0e33157382222da9a45e6e3f558994d7ea7250450f
//     has no matching Script
//
// which is D-7's signature, three years of flows later. The encoder selects
// funding UTXOs by `sourceAddress` when it is given one and falls back to the
// PUBKEY when it is not; the utxo-tracker cannot resolve a pubkey to a script
// for a bech32 address, so it answers "no matching Script". `composeForConfirm`
// has passed the pair since D-7 was fixed. `buildActionPsbt` never did.
//
// THE BLAST RADIUS IS THE POINT: this is the ONLY build path a watcher-mode
// wallet has, and bech32 is the wallet's default address type on every chain it
// supports. So the air-gapped signing story - watcher builds, signer signs,
// full-mode broadcasts - could not complete its first step for a default
// wallet. Session 24 proved watcher mode HIDES the signing controls correctly;
// nobody had ever asked it to build anything.

import { describe, it, expect, vi } from 'vitest';
import { buildActionPsbt } from '../../../packages/core/src/flows/buildActionPsbt.js';

const SOURCE = {
    address: 'bcrt1qexampleexampleexampleexampleexampleex',
    publicKey: '03c015d1857ef0227b38b31b0e33157382222da9a45e6e3f558994d7ea7250450f',
    derivationPath: "m/84'/1'/0'/0/0",
};

function harness() {
    const calls = [];
    const sdk = {
        actions: { createAction: vi.fn(() => ({ actionString: 'ISSUE|0|NEWTICK|1000', action: 'ISSUE', version: 0 })) },
        encoder: {
            createTx: vi.fn(async (args) => {
                calls.push(args);
                return { psbt: '70736274ff', encoding: 'opreturn' };
            }),
        },
    };
    return { calls, sdk, sdkRegistry: { get: () => sdk } };
}

async function build(extra = {}) {
    const h = harness();
    const out = await buildActionPsbt({
        sdkRegistry: h.sdkRegistry,
        chainRegistry: { get: () => ({ coin: 'BTC', networkKind: 'regtest' }) },
        chainId: 'bitcoin-regtest',
        from: SOURCE,
        actionData: { action: 'ISSUE', params: { TICK: 'NEWTICK', SUPPLY: '1000' } },
        ...extra,
    });
    return { ...h, out };
}

describe('the watcher build names its spender', () => {
    it('passes sourceAddress and change, not just the pubkey', async () => {
        const { calls } = await build();
        expect(calls).toHaveLength(1);
        expect(calls[0].sourceAddress,
            'the encoder is asked to find UTXOs by pubkey alone, which the utxo-tracker cannot '
            + 'resolve for a bech32 address ("has no matching Script") - the air-gapped lane cannot '
            + 'build anything (D-120)')
            .toBe(SOURCE.address);
        expect(calls[0].change,
            'no change sink, so the encoder refuses rather than burn the change as fee')
            .toBe(SOURCE.address);
        // The pubkey still rides along: the signer needs it, and dropping it
        // would trade one broken lane for another.
        expect(calls[0].pubkey).toBe(SOURCE.publicKey);
    });

    it('lets an explicit change address win', async () => {
        // Spread last on purpose: a caller that pins its own change sink (the
        // chunked-deploy lane does) must not have it silently replaced.
        const { calls } = await build({ encoderOpts: { change: 'bcrt1qsomewhereelse' } });
        expect(calls[0].change).toBe('bcrt1qsomewhereelse');
        expect(calls[0].sourceAddress).toBe(SOURCE.address);
    });
});
