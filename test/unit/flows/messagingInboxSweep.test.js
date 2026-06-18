// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: getMessagingInboxSweep. Asserts the per-account sweep merges and
// de-dupes messages across addresses, tolerates a per-address transport
// failure, and aborts on an auth-class error.

import { describe, it, expect } from 'vitest';
import { getMessagingInboxSweep } from '../../../packages/core/src/flows/messagingInbox.js';

// Address records keyed by id. All HD on one chain for simplicity.
const ADDRS = {
    a1: { address: 'ADDR_ONE', chain: 'bitcoin', network: 'regtest', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' },
    a2: { address: 'ADDR_TWO', chain: 'bitcoin', network: 'regtest', derivationPath: "m/84'/0'/0'/2/0", source: 'hd' },
};

function makeDeps(messagesByAddress, { throwFor } = {}) {
    const vault = {
        addresses: { get: async (id) => ADDRS[id] || null },
    };
    const chainRegistry = { chainIdFor: () => 'bitcoin' };
    const sdkRegistry = {
        get: () => ({
            getMessagesForAddress: async (address) => {
                if (throwFor && throwFor[address]) throw throwFor[address];
                return messagesByAddress[address] || [];
            },
        }),
    };
    const signer = {
        exportWifForPath: () => 'WIF',
        exportWifForAddressId: () => 'WIF',
    };
    return { vault, chainRegistry, sdkRegistry, signer };
}

describe('getMessagingInboxSweep', () => {
    it('merges and de-dupes messages across the account address union', async () => {
        const { vault, chainRegistry, sdkRegistry, signer } = makeDeps({
            ADDR_ONE: [{ txid: 't1', timestamp: 10 }, { txid: 't2', timestamp: 20 }],
            ADDR_TWO: [{ txid: 't2', timestamp: 20 }, { txid: 't3', timestamp: 5 }],
        });
        const res = await getMessagingInboxSweep({
            vault, walletId: 'w1', chainRegistry, sdkRegistry, signer,
            addressIds: ['a1', 'a2'],
        });
        // t2 appears under both addresses; de-duped to one. Sorted newest-first.
        expect(res.messages.map((m) => m.txid)).toEqual(['t2', 't1', 't3']);
        expect(res.addresses).toEqual(['ADDR_ONE', 'ADDR_TWO']);
        expect(res.errors).toEqual([]);
    });

    it('tolerates a per-address transport failure and records it', async () => {
        const boom = new Error('explorer 503');
        const { vault, chainRegistry, sdkRegistry, signer } = makeDeps(
            { ADDR_ONE: [{ txid: 't1', timestamp: 10 }] },
            { throwFor: { ADDR_TWO: boom } },
        );
        const res = await getMessagingInboxSweep({
            vault, walletId: 'w1', chainRegistry, sdkRegistry, signer,
            addressIds: ['a1', 'a2'],
        });
        expect(res.messages.map((m) => m.txid)).toEqual(['t1']);
        expect(res.addresses).toEqual(['ADDR_ONE']);
        expect(res.errors).toHaveLength(1);
        expect(res.errors[0].addressId).toBe('a2');
    });

    it('aborts the whole sweep on an auth-class error', async () => {
        const authErr = new Error('wrong password');
        authErr.name = 'WrongPasswordError';
        const { vault, chainRegistry, sdkRegistry, signer } = makeDeps(
            {},
            { throwFor: { ADDR_ONE: authErr } },
        );
        await expect(getMessagingInboxSweep({
            vault, walletId: 'w1', chainRegistry, sdkRegistry, signer,
            addressIds: ['a1', 'a2'],
        })).rejects.toThrow(/wrong password/);
    });

    it('requires a non-empty addressIds array', async () => {
        const { vault, chainRegistry, sdkRegistry, signer } = makeDeps({});
        await expect(getMessagingInboxSweep({
            vault, walletId: 'w1', chainRegistry, sdkRegistry, signer, addressIds: [],
        })).rejects.toThrow(/non-empty array/);
    });
});
