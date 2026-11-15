// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect } from 'vitest';
import { collectPairingKeys } from '../../../packages/core/src/flows/pairPartner.js';

const descriptor = { id: 'bitcoin-mainnet', defaultAddressType: 'p2wpkh' };
const chainRegistry = {
    descriptorFor: () => descriptor,
    derivationPathFor: (_chainId, _addressType, _account, change, index, opts) => (
        opts?.format === 'counterwallet-legacy' ? `m/0'/${change}/${index}` : null
    ),
};
const signer = {
    getPublicKey: async () => ({
        publicKey: `02${'11'.repeat(32)}`,
        chainCode: '22'.repeat(32),
    }),
};

describe('collectPairingKeys legacy address type', () => {
    it('labels the shared legacy account key as p2pkh', async () => {
        const keys = await collectPairingKeys({
            signer,
            chainRegistry,
            chainIds: [descriptor.id],
            format: 'counterwallet-legacy',
        });
        expect(keys).toHaveLength(1);
        expect(keys[0]).toMatchObject({
            chainId: descriptor.id,
            addressType: 'p2pkh',
            path: "m/0'",
        });
    });
});
