// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';
import {
    resolveSigner,
    SignerResolutionError,
} from '../../../packages/core/src/flows/resolveSigner.js';

function makeVault(signerRecord = null) {
    return {
        signers: {
            find: vi.fn().mockResolvedValue(signerRecord),
        },
    };
}

describe('resolveSigner', () => {
    it('resolves an address owned by a local key to a software signer', async () => {
        const address = { id: 'local-address', source: 'hd' };
        const vault = makeVault();

        await expect(resolveSigner({ vault, address })).resolves.toEqual({
            kind: 'software',
            address,
        });
        expect(vault.signers.find).not.toHaveBeenCalled();
    });
});

describe('resolveSigner remote descriptors', () => {
    it('resolves a remote descriptor through the vault signer path', async () => {
        const signerRecord = { id: 'remote-signer', kind: 'trezor' };
        const address = {
            id: 'remote-address',
            source: 'trezor',
            signerId: signerRecord.id,
        };
        const vault = makeVault(signerRecord);

        await expect(resolveSigner({ vault, address })).resolves.toEqual({
            kind: 'trezor',
            address,
            signerRecord,
        });
        expect(vault.signers.find).toHaveBeenCalledWith(signerRecord.id);
    });

    it('throws SignerResolutionError when the vault lacks the remote signer', async () => {
        const address = {
            id: 'missing-address',
            address: 'bc1qmissing',
            source: 'ledger',
            signerId: 'missing-signer',
        };

        await expect(resolveSigner({ vault: makeVault(), address }))
            .rejects.toBeInstanceOf(SignerResolutionError);
    });

    it('carries the unresolved address identifier on the error', async () => {
        const address = {
            id: 'missing-address',
            address: 'bc1qmissing',
            source: 'ledger',
            signerId: 'missing-signer',
        };

        await expect(resolveSigner({ vault: makeVault(), address }))
            .rejects.toMatchObject({
                name: 'SignerResolutionError',
                addressId: address.id,
            });
    });
});
