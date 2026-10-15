// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { RemoteSigner } from '../../../packages/core/src/signers/RemoteSigner.js';
import { SignerStatusError } from '../../../packages/core/src/signers/Signer.js';

function signerFor(result) {
    return new RemoteSigner({
        id: 'remote-1',
        displayName: 'Remote device',
        kind: 'ledger',
        transport: async () => result,
    });
}

describe('RemoteSigner edge responses', () => {
    it.each([null, undefined, 7, { status: 7 }])(
        'maps an invalid status response (%j) to error',
        async (response) => {
            await expect(signerFor(response).getStatus()).resolves.toBe('error');
        },
    );

    it.each([
        {},
        { txHex: 7, txid: 'id' },
        { txHex: 'hex', txid: 7 },
    ])('rejects malformed transaction result %#', async (response) => {
        await expect(signerFor(response).signPsbt({ psbtHex: '00' }))
            .rejects.toMatchObject({
                name: 'SignerStatusError',
                signerId: 'remote-1',
                status: 'error',
            });
    });

    it('drops a non-string optional signed PSBT without changing transaction fields', async () => {
        await expect(signerFor({ signedPsbtHex: 7, txHex: 'aa', txid: 'bb' }).signPsbt({}))
            .resolves.toEqual({ signedPsbtHex: '', txHex: 'aa', txid: 'bb' });
    });

    it.each([null, { signature: null }, { signature: 1 }])(
        'rejects invalid signature response %#',
        async (response) => {
            await expect(signerFor(response).signMessage({ message: 'hello' }))
                .rejects.toBeInstanceOf(SignerStatusError);
        },
    );

    it('keeps its signer identity when forwarding an undefined payload', async () => {
        let request;
        const signer = new RemoteSigner({
            id: 'remote-1',
            displayName: 'Remote device',
            kind: 'trezor',
            transport: async (value) => {
                request = value;
                return { publicKey: '02aa' };
            },
        });

        await expect(signer.getPublicKey()).resolves.toEqual({ publicKey: '02aa' });
        expect(request).toEqual({ op: 'getPublicKey', payload: { signerId: 'remote-1' } });
    });
});
