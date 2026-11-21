// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The inbox flows hand a session signer's key to the SDK for decryption. The
// signer may only export a key for this wallet's own seed or imported
// addresses: a watch-only, device or other-wallet record would otherwise get
// a key derived from this wallet's seed at that record's path.

import { describe, expect, it, vi } from 'vitest';

import { getMessagingInbox, getMessagingInboxSweep } from '../../../../packages/core/src/flows/messagingInbox.js';

const rec = (id, accountId, source, extra = {}) => ({
    id, accountId, source, chain: 'bitcoin', network: 'regtest', address: `ADDR_${id}`,
    derivationPath: source === 'watch-only' || source === 'imported-wif' ? null : "m/84'/0'/0'/0/0", ...extra,
});

const RECORDS = {
    own: rec('own', 'acct-1', 'hd'),
    imported: rec('imported', null, 'imported-wif'),
    watch: rec('watch', null, 'watch-only'),
    device: rec('device', 'acct-1', 'trezor', { signerId: 'sig-1' }),
    other: rec('other', 'acct-2', 'hd'),
};

function makeDeps({ signerId = 'w1' } = {}) {
    const vault = {
        addresses: { get: async (id) => RECORDS[id] ?? null },
        accounts: { get: async (id) => ({ 'acct-1': { id, walletId: 'w1' }, 'acct-2': { id, walletId: 'w2' } })[id] ?? null },
        wallets: { get: async (id) => (id === 'w1' ? { id, importedKeys: [{ addressId: 'imported' }] } : null) },
    };
    const signer = {
        id: signerId,
        kind: 'software',
        exportWifForPath: vi.fn(() => 'WIF_PATH'),
        exportWifForAddressId: vi.fn(() => 'WIF_IMPORTED'),
    };
    const getMessagesForAddress = vi.fn(async (address) => [{ txid: `t-${address}`, timestamp: 1 }]);
    return {
        signer,
        getMessagesForAddress,
        args: {
            vault, walletId: 'w1', signer,
            chainRegistry: { chainIdFor: () => 'bitcoin-regtest' },
            sdkRegistry: { get: () => ({ getMessagesForAddress }) },
        },
    };
}

describe('inbox flows refuse keys the session signer does not hold', () => {
    it('still sweeps the wallet seed and imported addresses', async () => {
        const { args, signer } = makeDeps();
        const res = await getMessagingInboxSweep({ ...args, addressIds: ['own', 'imported'] });
        expect(res.addresses).toEqual(['ADDR_own', 'ADDR_imported']);
        expect(res.errors).toEqual([]);
        expect(signer.exportWifForPath).toHaveBeenCalledTimes(1);
        expect(signer.exportWifForAddressId).toHaveBeenCalledWith('imported');
    });

    it.each(['watch', 'device'])('aborts a sweep naming a %s address without exporting a key', async (id) => {
        const { args, signer, getMessagesForAddress } = makeDeps();
        await expect(getMessagingInboxSweep({ ...args, addressIds: [id, 'own'] }))
            .rejects.toMatchObject({ name: 'NoKeyForAddressError' });
        expect(signer.exportWifForPath).not.toHaveBeenCalled();
        expect(getMessagesForAddress).not.toHaveBeenCalled();
    });

    it('skips an address of another wallet without exporting a key for it', async () => {
        const { args, signer } = makeDeps();
        const res = await getMessagingInboxSweep({ ...args, addressIds: ['other', 'own'] });
        expect(res.addresses).toEqual(['ADDR_own']);
        expect(res.errors).toEqual([expect.objectContaining({ addressId: 'other', error: expect.stringMatching(/does not belong/) })]);
        expect(signer.exportWifForPath).toHaveBeenCalledTimes(1);
    });

    it('refuses a signer that is not this wallet signer', async () => {
        const { args, signer } = makeDeps({ signerId: 'w2' });
        const res = await getMessagingInboxSweep({ ...args, addressIds: ['own'] });
        expect(res.addresses).toEqual([]);
        expect(res.errors[0].error).toMatch(/signer does not belong/);
        expect(signer.exportWifForPath).not.toHaveBeenCalled();
    });

    it('refuses a device address in the single-address inbox', async () => {
        const { args, signer } = makeDeps();
        await expect(getMessagingInbox({ ...args, addressId: 'device' }))
            .rejects.toMatchObject({ name: 'NoKeyForAddressError' });
        expect(signer.exportWifForPath).not.toHaveBeenCalled();
    });
});
