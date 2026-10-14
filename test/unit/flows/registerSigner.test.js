// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    findSigner,
    listSignersForWallet,
    registerSigner,
    unregisterSigner,
} from '../../../packages/core/src/flows/registerSigner.js';
import { validateSignerRecord } from '../../../packages/core/src/schemas/signer.js';

const NOW = '2026-10-13T19:20:21.000Z';

function signer(overrides = {}) {
    return {
        schemaVersion: 1,
        id: 'signer-1',
        walletId: 'wallet-1',
        kind: 'ledger',
        vendor: 'ledger',
        model: 'nanoX',
        deviceIdentifier: 'device-a',
        label: 'Desk Ledger',
        firmwareVersion: '2.1.0',
        pairedAt: '2026-01-02T03:04:05.000Z',
        lastSeenAt: '2026-01-02T03:04:05.000Z',
        ...overrides,
    };
}

function mockVault(records = [], deleteResult = true) {
    return {
        signers: {
            list: vi.fn(async () => records),
            put: vi.fn(async () => undefined),
            delete: vi.fn(async () => deleteResult),
        },
    };
}

function registration(vault, overrides = {}) {
    return {
        vault,
        walletId: 'wallet-1',
        kind: 'ledger',
        vendor: 'ledger',
        model: 'nanoX',
        deviceIdentifier: 'device-a',
        label: 'Travel Ledger',
        firmwareVersion: '2.2.1',
        ...overrides,
    };
}

describe('registerSigner', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(NOW));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('creates, validates, and persists a new signer record', async () => {
        const vault = mockVault();
        const record = await registerSigner(registration(vault));

        expect(validateSignerRecord(record)).toEqual({ ok: true, errors: [] });
        expect(record).toMatchObject({
            walletId: 'wallet-1',
            kind: 'ledger',
            vendor: 'ledger',
            model: 'nanoX',
            deviceIdentifier: 'device-a',
            label: 'Travel Ledger',
            firmwareVersion: '2.2.1',
            pairedAt: NOW,
            lastSeenAt: NOW,
        });
        expect(vault.signers.put).toHaveBeenCalledOnce();
        expect(vault.signers.put).toHaveBeenCalledWith(record);
    });

    it('uses signer defaults when optional metadata is absent', async () => {
        const vault = mockVault();
        const record = await registerSigner(registration(vault, {
            kind: 'trezor',
            vendor: 'trezor',
            model: 'T2T1',
            label: undefined,
            firmwareVersion: undefined,
        }));

        expect(record.label).toBe('Trezor');
        expect(record.firmwareVersion).toBeNull();
    });

    it('updates a matching device without replacing its identity', async () => {
        const existing = signer();
        const vault = mockVault([existing]);
        const record = await registerSigner(registration(vault));

        expect(record).toEqual({
            ...existing,
            firmwareVersion: '2.2.1',
            label: 'Travel Ledger',
            lastSeenAt: NOW,
        });
        expect(record.id).toBe(existing.id);
        expect(record.pairedAt).toBe(existing.pairedAt);
        expect(vault.signers.put).toHaveBeenCalledWith(record);
    });

    it('does not match a device from another wallet or vendor', async () => {
        const records = [
            signer({ id: 'other-wallet', walletId: 'wallet-2' }),
            signer({ id: 'other-vendor', vendor: 'trezor' }),
        ];
        const vault = mockVault(records);
        const record = await registerSigner(registration(vault));

        expect(record.id).not.toBe('other-wallet');
        expect(record.id).not.toBe('other-vendor');
        expect(record.pairedAt).toBe(NOW);
    });

    it.each([
        [undefined, /opts is required/],
        [{ vault: null }, /vault is required/],
        [{ walletId: '' }, /walletId is required/],
        [{ kind: '' }, /kind is required/],
        [{ vendor: '' }, /vendor is required/],
        [{ model: '' }, /model is required/],
        [{ deviceIdentifier: '' }, /deviceIdentifier is required/],
    ])('rejects invalid required input %#', async (overrides, message) => {
        const vault = mockVault();
        const input = overrides === undefined ? undefined : registration(vault, overrides);
        await expect(registerSigner(input)).rejects.toThrow(message);
    });
});

describe('signer registry reads and removal', () => {
    it('finds a signer only when all device identity fields match', async () => {
        const match = signer();
        const vault = mockVault([
            signer({ id: 'wrong-device', deviceIdentifier: 'device-b' }),
            match,
        ]);

        await expect(findSigner(vault, {
            walletId: 'wallet-1',
            vendor: 'ledger',
            deviceIdentifier: 'device-a',
        })).resolves.toBe(match);
        await expect(findSigner(vault, {
            walletId: 'wallet-1',
            vendor: 'ledger',
            deviceIdentifier: 'missing',
        })).resolves.toBeNull();
    });

    it('lists only records owned by the requested wallet', async () => {
        const owned = signer();
        const vault = mockVault([owned, signer({ id: 'signer-2', walletId: 'wallet-2' })]);

        await expect(listSignersForWallet(vault, 'wallet-1')).resolves.toEqual([owned]);
        expect(vault.signers.list).toHaveBeenCalledOnce();
    });

    it('delegates removal and returns the vault result', async () => {
        const vault = mockVault([], false);

        await expect(unregisterSigner(vault, 'signer-1')).resolves.toBe(false);
        expect(vault.signers.delete).toHaveBeenCalledWith('signer-1');
    });

    it('validates list and removal inputs before reading the vault', async () => {
        const vault = mockVault();

        await expect(listSignersForWallet(null, 'wallet-1')).rejects.toThrow(/vault is required/);
        await expect(listSignersForWallet(vault, '')).rejects.toThrow(/walletId is required/);
        await expect(unregisterSigner(null, 'signer-1')).rejects.toThrow(/vault is required/);
        await expect(unregisterSigner(vault, '')).rejects.toThrow(/signerId is required/);
        expect(vault.signers.list).not.toHaveBeenCalled();
        expect(vault.signers.delete).not.toHaveBeenCalled();
    });
});
