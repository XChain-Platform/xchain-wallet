// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A device signer needs the whole previous transaction on every segwit input,
// and the encoder attaches it only when asked. The atomic build inside
// submitWithSigner is reached by the direct-dispatch hardware routes with no
// prebuilt PSBT, so it asks whenever the signer is a device and never for a
// software signer.

import { describe, expect, it, vi } from 'vitest';
import { submitWithSigner } from '../../../packages/core/src/sdk/submitWithSigner.js';

const PUBKEY = `02${'11'.repeat(32)}`;
const CHAIN = { id: 'bitcoin-regtest', coin: 'bitcoin', addressTypes: ['p2pkh', 'p2wpkh'] };

async function submit({ signer, encoderOpts = {} }) {
    const createTx = vi.fn(async () => ({ psbt: '70736274ff', encoding: 'OP_RETURN' }));
    await submitWithSigner({
        sdkRegistry: {
            get: () => ({
                encoder: { createTx, broadcastTx: vi.fn(async () => ({})) },
                actions: {
                    createAction: vi.fn(() => ({ actionString: 'BROADCAST|0|gm', action: 'BROADCAST', version: 0 })),
                },
            }),
        },
        chainRegistry: { get: () => CHAIN },
        chainId: CHAIN.id,
        actionData: { action: 'BROADCAST', params: {} },
        encoderOpts: { pubkey: PUBKEY, ...encoderOpts },
        signer: signer.rawObject ?? { signPsbt: vi.fn(async () => ({ txHex: 'signed', txid: 'txid' })), ...signer },
        signingPaths: [{ inputIndex: 0, path: "m/84'/1'/0'/0/0" }],
    });
    return createTx.mock.calls[0][0];
}

describe('submitWithSigner atomic build asks for the previous transaction on a device', () => {
    it.each(['ledger', 'trezor'])('sets attachPrevTx for a %s signer', async (kind) => {
        const opts = await submit({ signer: { kind } });
        expect(opts.attachPrevTx).toBe(true);
    });

    it('overrides a caller that left it off for a device signer', async () => {
        const opts = await submit({ signer: { kind: 'ledger' }, encoderOpts: { attachPrevTx: false } });
        expect(opts.attachPrevTx).toBe(true);
    });

    it.each(['software', 'multisig', 'airgap', undefined])('does not set it for a %s signer', async (kind) => {
        const opts = await submit({ signer: { kind } });
        expect(opts).not.toHaveProperty('attachPrevTx');
    });

    it('does not set it when reading the signer kind throws', async () => {
        const rawObject = {
            get kind() { throw new Error('no kind'); },
            signPsbt: vi.fn(async () => ({ txHex: 'signed', txid: 'txid' })),
        };
        const opts = await submit({ signer: { rawObject } });
        expect(opts).not.toHaveProperty('attachPrevTx');
    });
});
