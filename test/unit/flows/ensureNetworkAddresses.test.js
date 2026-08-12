// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Switching Settings > Network used to strand a wallet with no
// addresses. Addresses were derived exactly once, at wallet creation, one per
// `activeChainIds` - which the shells hardcode to the three mainnets - while
// `activeNetwork` only FILTERED the visible set. After a switch, Receive said
// "No addresses yet on any chain", the app reported itself offline, and no
// affordance anywhere could create one. Two clicks from a shipped control into
// a dead end. Regtest is developer-only; Testnet is offered to everyone.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const receiveAddress = vi.hoisted(() => vi.fn());
vi.mock('../../../packages/core/src/flows/receiveAddress.js', () => ({ receiveAddress }));

const { ensureNetworkAddresses } = await import(
    '../../../packages/core/src/flows/ensureNetworkAddresses.js'
);

const DESCRIPTORS = {
    regtest: [
        { id: 'bitcoin-regtest', defaultAddressType: 'p2wpkh' },
        { id: 'litecoin-regtest', defaultAddressType: 'p2wpkh' },
        { id: 'dogecoin-regtest', defaultAddressType: 'p2pkh' },
    ],
};

function harness({ addresses = [], accounts = [{ id: 'acct-1', index: 0 }] } = {}) {
    return {
        vault: {
            accounts: { findBy: async () => accounts },
            addresses: { list: async () => addresses },
        },
        chainRegistry: {
            byNetworkKind: (kind) => DESCRIPTORS[kind] || [],
            // Mirrors the real registry: (coin, network) -> chain id.
            chainIdFor: (coin, network) => `${coin}-${network}`,
        },
        sdkRegistry: {},
        walletId: 'w1',
        network: 'regtest',
        signer: { kind: 'software' },
    };
}

beforeEach(() => receiveAddress.mockReset());

describe('ensureNetworkAddresses', () => {
    it('derives the first address on every chain of the network', async () => {
        receiveAddress.mockResolvedValue({ address: 'bcrt1qexample' });
        const res = await ensureNetworkAddresses(harness());

        expect(res.created).toEqual(['bitcoin-regtest', 'litecoin-regtest', 'dogecoin-regtest']);
        expect(res.failed).toEqual([]);
        expect(receiveAddress).toHaveBeenCalledTimes(3);
        // Same shape wallet creation uses: account 0, the chain's default type
        // (left to receiveAddress), and the caller's pre-unlocked signer.
        expect(receiveAddress.mock.calls[0][0]).toMatchObject({
            walletId: 'w1', chainId: 'bitcoin-regtest', accountId: 'acct-1',
        });
        expect(receiveAddress.mock.calls[0][0].signer).toBeTruthy();
    });

    it('leaves chains that already have an address alone', async () => {
        receiveAddress.mockResolvedValue({ address: 'bcrt1qexample' });
        const res = await ensureNetworkAddresses(harness({
            addresses: [{ accountId: 'acct-1', chain: 'bitcoin', network: 'regtest' }],
        }));

        expect(res.existing).toEqual(['bitcoin-regtest']);
        expect(res.created).toEqual(['litecoin-regtest', 'dogecoin-regtest']);
        // Re-deriving an existing chain would mint a SECOND address on every
        // network switch, quietly growing the address list.
        expect(receiveAddress).toHaveBeenCalledTimes(2);
    });

    it('one chain failing does not deny the user the others', async () => {
        receiveAddress
            .mockRejectedValueOnce(new Error('bitcoin sdk unavailable'))
            .mockResolvedValue({ address: 'bcrt1qexample' });
        const res = await ensureNetworkAddresses(harness());

        expect(res.created).toHaveLength(2);
        expect(res.failed).toEqual([
            { chainId: 'bitcoin-regtest', reason: 'bitcoin sdk unavailable' },
        ]);
    });

    it('derives NOTHING without a signer, and says so', async () => {
        // A locked vault, or a hardware-backed account where deriving would
        // wake the device three times for a settings toggle. Reporting the
        // skip beats half-doing it or prompting out of nowhere.
        const res = await ensureNetworkAddresses({ ...harness(), signer: undefined });

        expect(res.skipped).toBe('no-signer');
        expect(res.created).toEqual([]);
        expect(receiveAddress).not.toHaveBeenCalled();
    });

    it('reports a wallet with no accounts rather than throwing', async () => {
        const res = await ensureNetworkAddresses(harness({ accounts: [] }));
        expect(res.skipped).toBe('no-accounts');
        expect(receiveAddress).not.toHaveBeenCalled();
    });

    it('requires walletId and network', async () => {
        await expect(ensureNetworkAddresses({ ...harness(), walletId: '' }))
            .rejects.toThrow(/walletId is required/);
        await expect(ensureNetworkAddresses({ ...harness(), network: '' }))
            .rejects.toThrow(/network is required/);
    });
});
