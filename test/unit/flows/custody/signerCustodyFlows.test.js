// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { dispenserAddress } from '../../../../packages/core/src/flows/dispenserAddress.js';
import { receiveAddress } from '../../../../packages/core/src/flows/receiveAddress.js';
import {
    accountCustody,
    signerOwnsAccount,
    signerOwnsSource,
} from '../../../../packages/core/src/flows/custody/signerCustody.js';

function collection(initial = []) {
    const records = new Map(initial.map((row) => [row.id, structuredClone(row)]));
    return {
        get: async (id) => structuredClone(records.get(id) ?? null),
        put: async (row) => { records.set(row.id, structuredClone(row)); },
        list: async () => Array.from(records.values()).map((row) => structuredClone(row)),
        findBy: async (field, value) => Array.from(records.values())
            .filter((row) => row[field] === value).map((row) => structuredClone(row)),
    };
}

const account = { id: 'acct-1', walletId: 'wallet-1', index: 0, name: 'One' };
const deviceAddress = {
    id: 'addr-1', accountId: account.id, chain: 'bitcoin', network: 'regtest',
    source: 'trezor', signerId: 'device-1', addressType: 'p2wpkh',
    derivationPath: "m/84'/0'/0'/0/0", address: 'old', publicKey: 'old-pub',
};
const registry = {
    get: () => ({
        coin: 'bitcoin', networkKind: 'regtest', defaultAddressType: 'p2wpkh',
        addressTypes: ['p2wpkh'],
    }),
};
const sdkRegistry = { get: () => ({}) };

function signer(kind, id) {
    const calls = [];
    return {
        kind, id, calls,
        async getAddresses(params) {
            calls.push(params);
            return [{
                address: 'new', publicKey: 'new-pub',
                path: `m/84'/0'/0'/0/${params.startIndex}`,
            }];
        },
    };
}

function vault(addresses) {
    return {
        accounts: collection([account]),
        addresses: collection(addresses),
        wallets: collection([{ id: 'wallet-1', format: 'bip39' }]),
    };
}

function request(addresses, selectedSigner) {
    return dispenserAddress({
        vault: vault(addresses), walletId: 'wallet-1', accountId: account.id,
        signer: selectedSigner, chainRegistry: registry, sdkRegistry,
        chainId: 'bitcoin',
    });
}

function receive(addresses, selectedSigner) {
    return receiveAddress({
        vault: vault(addresses), walletId: 'wallet-1', accountId: account.id,
        signer: selectedSigner, chainRegistry: registry, sdkRegistry,
        chainId: 'bitcoin', derivationIndex: 1,
    });
}

const unlinkedDevice = { ...deviceAddress, signerId: null };

describe('account signer custody', () => {
    it('prefers a device owner over an old mixed software address', () => {
        const custody = accountCustody(account.id, [
            deviceAddress,
            { ...deviceAddress, id: 'addr-2', source: 'hd', signerId: null },
        ]);
        expect(custody).toEqual({ device: true, signerIds: ['device-1'] });
        expect(signerOwnsAccount(signer('trezor', 'device-1'), custody)).toBe(true);
        expect(signerOwnsAccount(signer('software', 'seed-1'), custody)).toBe(false);
    });

    it('marks accounts owned by multiple devices ambiguous', () => {
        const custody = accountCustody(account.id, [
            deviceAddress,
            { ...deviceAddress, id: 'addr-2', signerId: 'device-2' },
        ]);
        expect(custody).toEqual({ device: true, signerIds: ['device-1', 'device-2'] });
        expect(signerOwnsAccount(signer('trezor', 'device-1'), custody)).toBe(false);
        expect(signerOwnsAccount(signer('trezor', 'device-2'), custody)).toBe(false);
    });

    it('lets any device extend an account whose device records are unlinked, never the seed', () => {
        const custody = accountCustody(account.id, [
            unlinkedDevice,
            { ...unlinkedDevice, id: 'addr-2', source: 'ledger' },
        ]);
        expect(custody).toEqual({ device: true, signerIds: [] });
        expect(signerOwnsAccount(signer('trezor', 'any'), custody)).toBe(true);
        expect(signerOwnsAccount(signer('ledger', 'any'), custody)).toBe(true);
        expect(signerOwnsAccount(signer('software', 'seed-1'), custody)).toBe(false);
    });

    it('keeps seed accounts for the seed and leaves empty accounts open', () => {
        const seed = accountCustody(account.id, [{ ...deviceAddress, source: 'hd', signerId: null }]);
        expect(seed).toEqual({ device: false, signerIds: [] });
        expect(signerOwnsAccount(signer('software', 'seed-1'), seed)).toBe(true);
        expect(signerOwnsAccount(signer('trezor', 'device-1'), seed)).toBe(false);
        expect(accountCustody(account.id, [{ ...deviceAddress, accountId: 'other' }])).toBeNull();
        expect(signerOwnsAccount(signer('trezor', 'device-1'), null)).toBe(true);
    });

    it('keeps the change-address rule strict for an unlinked device record', () => {
        expect(signerOwnsSource(signer('trezor', 'device-1'), deviceAddress)).toBe(true);
        expect(signerOwnsSource(signer('trezor', 'device-1'), unlinkedDevice)).toBe(false);
        expect(signerOwnsSource(signer('software', 'seed-1'), deviceAddress)).toBe(false);
    });
});

describe('address flows refuse a signer that does not hold the account', () => {
    it('refuses receive derivation with the pooled software signer, linked or not', async () => {
        for (const record of [deviceAddress, unlinkedDevice]) {
            const selected = signer('software', 'seed-1');
            await expect(receive([record], selected)).rejects.toThrow(/does not own account/i);
            expect(selected.calls).toHaveLength(0);
        }
    });

    it('refuses receive derivation with a device other than the linked owner', async () => {
        const selected = signer('trezor', 'device-2');
        await expect(receive([deviceAddress], selected)).rejects.toThrow(/does not own account/i);
        expect(selected.calls).toHaveLength(0);
    });

    it('allows receive derivation with the linked device and with a device on unlinked records', async () => {
        const linked = await receive([deviceAddress], signer('trezor', 'device-1'));
        expect(linked.signerId).toBe('device-1');
        const unlinked = await receive([unlinkedDevice], signer('trezor', 'device-3'));
        expect(unlinked.source).toBe('trezor');
    });

    it('refuses dispenser derivation with a device other than the linked owner', async () => {
        const selected = signer('trezor', 'device-2');
        await expect(request([deviceAddress], selected)).rejects.toThrow(/does not own account/i);
        expect(selected.calls).toHaveLength(0);
    });

    it('refuses dispenser derivation with the software signer on unlinked device records', async () => {
        const selected = signer('software', 'seed-1');
        await expect(request([unlinkedDevice], selected)).rejects.toThrow(/does not own account/i);
        expect(selected.calls).toHaveLength(0);
    });

    it('refuses dispenser derivation with the pooled software signer', async () => {
        const selected = signer('software', 'seed-1');
        await expect(request([deviceAddress], selected)).rejects.toThrow(/does not own account/i);
        expect(selected.calls).toHaveLength(0);
    });

    it('allows dispenser derivation with the owning device', async () => {
        const selected = signer('trezor', 'device-1');
        const created = await request([deviceAddress], selected);
        expect(created.source).toBe('trezor');
        expect(created.signerId).toBe('device-1');
        expect(selected.calls).toHaveLength(1);
    });
});
