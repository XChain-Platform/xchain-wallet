// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: the wallet's own signing lifecycle refuses a Taproot envelope pair
// rather than half-completing it ( §6/§3.5, ).
//
// The wallet does NOT go through the SDK's lifecycleManager; submitWithSigner is
// a second implementation of the same job, and it had the same gap  fixed
// in the SDK: it signs one PSBT, broadcasts it, and branches to a second
// transaction only for P2SH/P2WSH. Handed a commit/reveal pair it would put the
// commit on chain and drop the reveal, leaving the coin in a one-time P2TR
// output whose only exit is the §3.5 key-path cancel.
//
// Nothing reaches this branch today, because the wallet never asks for TAPROOT.
// That is exactly why the guard is worth a test: the day someone turns the
// encoding on, this must fail loudly instead of quietly costing a user coin.

import { describe, it, expect, vi } from 'vitest';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';

function harness({ withReveal }) {
    const broadcastTx = vi.fn(async () => ({}));
    const signPsbt = vi.fn(async () => ({ txHex: 'deadbeef', txid: 'COMMITTXID' }));
    const encoder = {
        createTx: vi.fn(async () => ({
            psbt: '70736274ff',                       // opaque to the guard
            encoding: 'TAPROOT',
            ...(withReveal ? { revealPsbt: '70736274ff' } : {}),
        })),
        broadcastTx,
        spendP2sh: vi.fn(async () => ({ psbt: '70736274ff' })),
    };
    const sdkRegistry = {
        get: () => ({
            encoder,
            actions: { createAction: () => ({ actionString: 'FILE|0|a.txt|text/plain', action: 'FILE', version: 0 }) },
        }),
    };
    return { sdkRegistry, signPsbt, broadcastTx, encoder };
}

const call = ({ sdkRegistry, signPsbt }) => submitWithSigner({
    sdkRegistry,
    chainId: 'BTC',
    chainRegistry: { get: () => ({}) },
    actionData: { action: 'FILE', params: {} },
    encoderOpts: { pubkey: '03abc', rawData: 'x' },
    signer: { signPsbt },
    signingPaths: [{ inputIndex: 0 }],
});

describe('submitWithSigner and the Taproot envelope pair ', () => {
    it('REFUSES a commit/reveal pair, and refuses it BEFORE signing or broadcasting', async () => {
        const h = harness({ withReveal: true });
        await expect(call(h)).rejects.toThrow(/envelope commit\/reveal pair|cannot complete/i);
        // the two facts that make this a guard rather than a message
        expect(h.signPsbt).not.toHaveBeenCalled();
        expect(h.broadcastTx).not.toHaveBeenCalled();
    });

    it('names the consequence, so the next reader does not "fix" it by dropping the guard', async () => {
        const h = harness({ withReveal: true });
        await expect(call(h)).rejects.toThrow(/strand/i);
    });

    it('a single-PSBT response is untouched by the guard', async () => {
        const h = harness({ withReveal: false });
        await call(h).catch(() => { /* later stages are out of scope here */ });
        // the guard must not fire on the lanes that work today
        expect(h.signPsbt).toHaveBeenCalled();
    });
});
