// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';

const PUBKEY = `02${'11'.repeat(32)}`;
const TAPROOT_CHAIN = {
    id: 'bitcoin-regtest',
    coin: 'bitcoin',
    addressTypes: ['p2pkh', 'p2wpkh', 'p2tr'],
};

async function submit({ actionString, rawData, signerKind = 'software', encoding } = {}) {
    const createTx = vi.fn(async () => ({ psbt: '70736274ff', encoding: 'OP_RETURN' }));
    const signer = {
        kind: signerKind,
        signPsbt: vi.fn(async () => ({ txHex: 'signed', txid: 'txid' })),
    };
    await submitWithSigner({
        sdkRegistry: {
            get: () => ({
                encoder: { createTx, broadcastTx: vi.fn(async () => ({})) },
                actions: {
                    createAction: vi.fn(() => ({
                        actionString,
                        action: 'BROADCAST',
                        version: 0,
                    })),
                },
            }),
        },
        chainRegistry: { get: () => TAPROOT_CHAIN },
        chainId: TAPROOT_CHAIN.id,
        actionData: { action: 'BROADCAST', params: {} },
        encoderOpts: { pubkey: PUBKEY, rawData, ...(encoding ? { encoding } : {}) },
        signer,
        signingPaths: [{ inputIndex: 0, path: "m/86'/1'/0'/0/0" }],
    });
    return createTx.mock.calls[0][0];
}

describe('submitWithSigner atomic envelope request', () => {
    it('asks for a Taproot envelope when the action string exceeds the legacy ceiling', async () => {
        const opts = await submit({ actionString: `BROADCAST|0|${'x'.repeat(9000)}` });
        expect(opts).toMatchObject({
            encoding: 'AUTO',
            options: { signerSupportsTapscript: true },
            compressedPubKey: PUBKEY,
        });
    });

    it('counts binary raw data with the action when selecting the envelope', async () => {
        const opts = await submit({ actionString: 'FILE|0|large.bin', rawData: 'x'.repeat(9000) });
        expect(opts).toMatchObject({
            encoding: 'AUTO',
            options: { signerSupportsTapscript: true },
            compressedPubKey: PUBKEY,
        });
    });

    it('leaves a short request unchanged', async () => {
        const opts = await submit({ actionString: 'BROADCAST|0|gm' });
        expect(opts.encoding).toBeUndefined();
        expect(opts.options).toBeUndefined();
        expect(opts.compressedPubKey).toBeUndefined();
    });

    it('switches only above the compiled 8192-byte ceiling', async () => {
        const atLimit = await submit({ actionString: 'x'.repeat(8189) });
        const overLimit = await submit({ actionString: 'x'.repeat(8190) });
        expect(atLimit.encoding).toBeUndefined();
        expect(overLimit.encoding).toBe('AUTO');
    });

    it('does not opt a hardware signer into the envelope', async () => {
        const opts = await submit({
            actionString: `BROADCAST|0|${'x'.repeat(9000)}`,
            signerKind: 'ledger',
        });
        expect(opts.encoding).toBeUndefined();
        expect(opts.options).toBeUndefined();
    });

    it('preserves an explicit legacy encoding', async () => {
        const opts = await submit({
            actionString: `BROADCAST|0|${'x'.repeat(9000)}`,
            encoding: 'P2WSH',
        });
        expect(opts.encoding).toBe('P2WSH');
        expect(opts.options).toBeUndefined();
    });
});
