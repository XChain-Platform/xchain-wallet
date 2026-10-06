// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';
import {
    buildRemoteSigner,
    SignerResolutionError,
} from '../../../packages/core/src/flows/resolveSigner.js';
import { RemoteSigner } from '../../../packages/core/src/signers/RemoteSigner.js';

describe('buildRemoteSigner with a hardware descriptor', () => {
    it.each([
        [
            {
                kind: 'ledger',
                signerRecord: {
                    id: 'ledger-1', label: 'Ledger One', vendor: 'Ledger', model: 'Nano S',
                },
            },
            'Ledger One',
        ],
        [
            {
                kind: 'trezor',
                signerRecord: {
                    id: 'trezor-1', label: '', vendor: 'Trezor', model: 'Safe 5',
                },
            },
            'Trezor Safe 5',
        ],
    ])('builds a RemoteSigner and delegates to its transport', async (descriptor, name) => {
        const publicKey = { publicKeyHex: '02abc' };
        const transport = vi.fn().mockResolvedValue(publicKey);

        const signer = buildRemoteSigner(descriptor, transport);

        expect(signer).toBeInstanceOf(RemoteSigner);
        expect(signer).toMatchObject({
            id: descriptor.signerRecord.id,
            displayName: name,
            kind: descriptor.kind,
        });
        await expect(signer.getPublicKey({ chainId: 'bitcoin-mainnet' })).resolves.toBe(publicKey);
        expect(transport).toHaveBeenCalledWith({
            op: 'getPublicKey',
            payload: { chainId: 'bitcoin-mainnet', signerId: descriptor.signerRecord.id },
        });
    });
});

describe('buildRemoteSigner validation', () => {
    it.each([
        { description: 'missing', descriptor: undefined },
        {
            description: 'not hardware',
            descriptor: { kind: 'software', signerRecord: { id: 'software-1' } },
        },
    ])('rejects a descriptor that is $description', ({ descriptor }) => {
        const transport = vi.fn();

        expect(() => buildRemoteSigner(descriptor, transport))
            .toThrow(SignerResolutionError);
    });

    it.each([undefined, null, {}])('rejects a non-function transport', (transport) => {
        const descriptor = {
            kind: 'ledger',
            signerRecord: { id: 'ledger-1', label: 'Ledger One', vendor: 'Ledger', model: 'Nano S' },
        };

        expect(() => buildRemoteSigner(descriptor, transport))
            .toThrow(SignerResolutionError);
    });
});
