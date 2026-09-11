// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// WHO is spending, for the native-fee quote on the atomic (rebuild) path.
//
// D-146 made the quote read a source at all, off `change`, on the premise that
// change and sourceAddress name the same address. Change-address rotation then
// broke that premise from the other side: submitAction rotates the self-change
// default onto a fresh internal address and leaves sourceAddress alone, so the
// quote asked the indexer about an address holding nothing and the dry run's
// valid:false reached the user as NativeFeeForfeitError on a fundable action.
//
// Both halves are pinned here: the spender wins, and a flow that names only a
// change address still quotes with a source rather than none.

import { describe, it, expect, vi } from 'vitest';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';

const SPENDER = 'bcrt1qspender';
const ROTATED = 'bcrt1qrotatedinternal';
const FEE_DEST = 'mfeesJdVLx23zhtsCveA8EEfmHX7qSV2Ls';

function makeHarness(encoderOpts) {
    const quoteNativeFee = vi.fn(async () => ({
        supported: true, valid: null, feeDestination: FEE_DEST, requiredFeeSats: 1000,
    }));
    const sdk = {
        encoder: {
            createTx: vi.fn(async () => ({ psbt: 'COMMIT-PSBT', encoding: 'OP_RETURN' })),
            broadcastTx: vi.fn(async () => ({})),
        },
        actions: {
            createAction: vi.fn(() => ({ actionString: 'SEND|0|x', action: 'SEND', version: 0 })),
        },
        wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
        quoteNativeFee,
    };
    const signer = {
        kind: 'software',
        signPsbt: vi.fn(async ({ psbtHex }) => ({ txHex: `TX(${psbtHex})`, txid: `txid-${psbtHex}` })),
    };
    return {
        quoteNativeFee,
        args: {
            sdkRegistry: { get: () => sdk },
            chainId: 'litecoin-regtest',
            actionData: { action: 'SEND', params: { DESTINATION: 'bcrt1qdest', TICK: 'XCP', AMOUNT: '1' } },
            encoderOpts: { pubkey: 'pub', payFeeInNativeCoin: true, ...encoderOpts },
            signer,
            signingPaths: [{ inputIndex: 0, path: 'm/0' }],
        },
    };
}

/** The `source` the fee quote was actually asked about. */
function quotedSource(h) {
    return h.quoteNativeFee.mock.calls[0][1].source;
}

describe('the native-fee quote names the spender, not the change sink', () => {

    it('quotes the funding address when change has been rotated away from it', async () => {
        const h = makeHarness({ sourceAddress: SPENDER, change: ROTATED });
        await submitWithSigner(h.args);
        expect(quotedSource(h)).toBe(SPENDER);
    });

    it('quotes the funding address when change is a deliberate third party', async () => {
        // createList and friends point change somewhere that is not the spender.
        const h = makeHarness({ sourceAddress: SPENDER, change: 'bcrt1qelsewhere' });
        await submitWithSigner(h.args);
        expect(quotedSource(h)).toBe(SPENDER);
    });

    it('[REGRESSION D-146] still quotes SOMETHING when only change is named', async () => {
        const h = makeHarness({ change: ROTATED });
        await submitWithSigner(h.args);
        expect(quotedSource(h)).toBe(ROTATED);
    });

    it('quotes the funding address when it is the only one named', async () => {
        const h = makeHarness({ sourceAddress: SPENDER });
        await submitWithSigner(h.args);
        expect(quotedSource(h)).toBe(SPENDER);
    });
});
