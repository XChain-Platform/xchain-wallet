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
import { buildRemoteSigner } from '../../../packages/core/src/flows/resolveSigner.js';
import { RemoteSigner } from '../../../packages/core/src/signers/RemoteSigner.js';

describe('buildRemoteSigner', () => {
    it('builds a RemoteSigner carrying the descriptor address and transport', async () => {
        const address = { id: 'addr-1', address: 'bc1qremote' };
        const descriptor = {
            kind: 'ledger',
            address,
            signerRecord: { id: 'signer-1', label: 'Ledger One', vendor: 'ledger', model: 'nano-s' },
        };
        const transport = vi.fn().mockResolvedValue([address]);

        const signer = buildRemoteSigner(descriptor, transport);

        expect(signer).toBeInstanceOf(RemoteSigner);
        expect(signer).toMatchObject({ id: 'signer-1', displayName: 'Ledger One', kind: 'ledger' });
        expect(signer.address).toBe(descriptor.address);
        expect(signer._transport).toBe(transport);
        await expect(signer.getAddresses({ chainId: 'bitcoin-mainnet' })).resolves.toEqual([address]);
        expect(transport).toHaveBeenCalledWith({
            op: 'getAddresses',
            payload: { chainId: 'bitcoin-mainnet', signerId: 'signer-1' },
        });
    });

    it('rejects a descriptor missing its hardware kind', () => {
        const transport = vi.fn();
        const descriptor = { signerRecord: { id: 'signer-1' } };

        expect(() => buildRemoteSigner(descriptor, transport)).toThrow(
            'buildRemoteSigner: descriptor must be HW (got kind="undefined")',
        );
    });
});
