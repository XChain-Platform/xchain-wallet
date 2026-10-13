// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi } from 'vitest';

import {
    AmbiguousSignerMatchError,
    reconcileAddressSigners,
} from '../../../packages/core/src/flows/reconcileAddressSigners.js';

const address = (id, overrides = {}) => ({
    id,
    accountId: 'account-1',
    chain: 'bitcoin',
    network: 'regtest',
    derivationPath: "m/84'/1'/0'/0/0",
    publicKey: `pub-${id}`,
    signerId: null,
    ...overrides,
});

function harness(addresses, accounts = [{ id: 'account-1', walletId: 'wallet-1' }]) {
    const put = vi.fn(async () => {});
    return {
        put,
        vault: {
            accounts: {
                findBy: vi.fn(async (field, value) => accounts.filter((row) => row[field] === value)),
            },
            addresses: { list: vi.fn(async () => addresses), put },
        },
        chainRegistry: {
            chainIdFor: vi.fn((coin, network) => (
                coin === 'bitcoin' && network === 'regtest' ? 'bitcoin-regtest' : null
            )),
        },
    };
}

describe('reconcileAddressSigners', () => {
    it('links the only matching signer and reports every non-match reason', async () => {
        const rows = [
            address('linked', { signerId: 'existing' }),
            address('other-wallet', { accountId: 'account-2' }),
            address('no-path', { derivationPath: null }),
            address('unknown', { chain: 'unknown' }),
            address('match'),
            address('miss'),
        ];
        const { vault, chainRegistry, put } = harness(rows);
        const signer = {
            id: 'signer-1',
            getPublicKey: vi.fn(async ({ path }) => {
                if (path.endsWith('/0')) return { publicKey: 'pub-match' };
                throw new Error('unsupported path');
            }),
        };

        const result = await reconcileAddressSigners({
            vault,
            chainRegistry,
            signers: [signer],
            walletId: 'wallet-1',
        });

        expect(result).toEqual({
            scanned: 4,
            reconciled: 1,
            skipped: [
                { id: 'no-path', reason: 'no-path' },
                { id: 'unknown', reason: 'unknown-chain' },
                { id: 'miss', reason: 'no-match' },
            ],
        });
        expect(put).toHaveBeenCalledWith(expect.objectContaining({ id: 'match', signerId: 'signer-1' }));
        expect(rows.find((row) => row.id === 'match').signerId).toBeNull();
    });

    it('applies a chain filter before scanning', async () => {
        const { vault, chainRegistry, put } = harness([
            address('btc'),
            address('unknown', { chain: 'unknown' }),
        ]);

        const result = await reconcileAddressSigners({
            vault,
            chainRegistry,
            signers: [{ id: 's', getPublicKey: vi.fn(async () => ({ publicKey: 'nope' })) }],
            chainId: 'litecoin-regtest',
        });

        expect(result).toEqual({ scanned: 0, reconciled: 0, skipped: [] });
        expect(put).not.toHaveBeenCalled();
    });

    it('rejects an address matched by more than one signer without persisting it', async () => {
        const { vault, chainRegistry, put } = harness([address('ambiguous')]);
        const signers = ['a', 'b'].map((id) => ({
            id,
            getPublicKey: vi.fn(async () => ({ publicKey: 'pub-ambiguous' })),
        }));

        const error = await reconcileAddressSigners({ vault, chainRegistry, signers }).catch((err) => err);

        expect(error).toBeInstanceOf(AmbiguousSignerMatchError);
        expect(error).toMatchObject({ addressId: 'ambiguous', signerIds: ['a', 'b'] });
        expect(put).not.toHaveBeenCalled();
    });

    it.each([
        [{ chainRegistry: {}, signers: [{}] }, 'vault is required'],
        [{ vault: {}, signers: [{}] }, 'chainRegistry is required'],
        [{ vault: {}, chainRegistry: {}, signers: [] }, 'signers must be a non-empty array'],
        [{ vault: {}, chainRegistry: {}, signers: null }, 'signers must be a non-empty array'],
    ])('validates required collaborators', async (args, message) => {
        await expect(reconcileAddressSigners(args)).rejects.toThrow(message);
    });
});
