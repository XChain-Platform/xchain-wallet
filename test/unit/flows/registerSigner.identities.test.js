// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Re-pairing a Ledger co-signer from another coin app. The device identifier
// is read in whichever app is open, so the same Ledger paired from its
// Litecoin app reports a different one than from its Bitcoin app. findSigner
// therefore also matches a Ledger record on its per-chain identities (stored,
// or derived from the addresses it gave), and registerSigner updates that
// record instead of writing a second one for the same device.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findSigner, registerSigner } from '../../../packages/core/src/flows/registerSigner.js';
import { ledgerIdentityFingerprint } from '../../../packages/core/src/signers/ledgerIdentity.js';
import { validateSignerRecord } from '../../../packages/core/src/schemas/signer.js';

const KEY_BTC = `02${'a1'.repeat(32)}`;
const KEY_LTC = `03${'b2'.repeat(32)}`;
const KEY_OTHER = `02${'c3'.repeat(32)}`;
const BTC_PATH = "m/84'/0'/0'/0/0";
const LTC_PATH = "m/84'/2'/0'/0/0";

const identity = (path, key) => ({ path, fingerprint: ledgerIdentityFingerprint(key) });

function ledgerRecord(overrides = {}) {
    return {
        schemaVersion: 1,
        id: 'signer-ledger',
        walletId: 'wallet-1',
        kind: 'ledger',
        vendor: 'ledger',
        model: 'nanoX',
        deviceIdentifier: 'id-from-bitcoin-app',
        label: 'Desk Ledger',
        firmwareVersion: '2.2.1',
        pairedAt: '2026-01-02T03:04:05.000Z',
        lastSeenAt: '2026-01-02T03:04:05.000Z',
        ...overrides,
    };
}

function mockVault(signers = [], addresses = []) {
    return {
        signers: {
            list: vi.fn(async () => signers),
            put: vi.fn(async () => undefined),
        },
        addresses: { list: vi.fn(async () => addresses) },
    };
}

const fromLitecoinApp = {
    walletId: 'wallet-1',
    kind: 'ledger',
    vendor: 'ledger',
    model: 'nanoX',
    deviceIdentifier: 'id-from-litecoin-app',
};

describe('findSigner matches a Ledger re-paired from another app on its identities', () => {
    it('matches a stored identity of any chain', async () => {
        const record = ledgerRecord({ identities: { 'bitcoin-mainnet': identity(BTC_PATH, KEY_BTC) } });
        const vault = mockVault([record]);

        await expect(findSigner(vault, {
            walletId: 'wallet-1',
            vendor: 'ledger',
            deviceIdentifier: 'id-from-litecoin-app',
            identities: { 'bitcoin-mainnet': identity(BTC_PATH, KEY_BTC) },
        })).resolves.toBe(record);
    });

    it('matches an identity derived from the addresses the device gave, for a record paired before identities', async () => {
        const record = ledgerRecord();
        const vault = mockVault([record], [{
            signerId: 'signer-ledger', chain: 'litecoin', network: 'mainnet', derivationPath: LTC_PATH, publicKey: KEY_LTC,
        }]);

        await expect(findSigner(vault, {
            walletId: 'wallet-1',
            vendor: 'ledger',
            deviceIdentifier: 'id-from-litecoin-app',
            identities: { 'litecoin-mainnet': identity(LTC_PATH, KEY_LTC) },
        })).resolves.toBe(record);
    });

    it('does not match another device, another wallet or another vendor', async () => {
        const records = [
            ledgerRecord({ identities: { 'bitcoin-mainnet': identity(BTC_PATH, KEY_BTC) } }),
            ledgerRecord({ id: 'other-wallet', walletId: 'wallet-2', identities: { 'bitcoin-mainnet': identity(BTC_PATH, KEY_OTHER) } }),
            ledgerRecord({ id: 'a-trezor', vendor: 'trezor', kind: 'trezor', identities: { 'bitcoin-mainnet': identity(BTC_PATH, KEY_OTHER) } }),
        ];
        const vault = mockVault(records);

        await expect(findSigner(vault, {
            walletId: 'wallet-1',
            vendor: 'ledger',
            deviceIdentifier: 'id-from-litecoin-app',
            identities: { 'bitcoin-mainnet': identity(BTC_PATH, KEY_OTHER) },
        })).resolves.toBeNull();
    });

    it('reads no addresses when the identifier matches or no identities are given', async () => {
        const record = ledgerRecord();
        const vault = mockVault([record]);

        await expect(findSigner(vault, {
            walletId: 'wallet-1', vendor: 'ledger', deviceIdentifier: 'id-from-bitcoin-app',
        })).resolves.toBe(record);
        await expect(findSigner(vault, {
            walletId: 'wallet-1', vendor: 'ledger', deviceIdentifier: 'id-from-litecoin-app',
        })).resolves.toBeNull();
        await expect(findSigner(vault, {
            walletId: 'wallet-1', vendor: 'ledger', deviceIdentifier: 'id-from-litecoin-app', identities: { x: { path: 'bad' } },
        })).resolves.toBeNull();
        expect(vault.addresses.list).not.toHaveBeenCalled();
    });
});

describe('registerSigner on a Ledger re-paired from another app', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-15T10:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('updates the existing record and merges the new identities, keeping its id and first identifier', async () => {
        const existing = ledgerRecord({ identities: { 'bitcoin-mainnet': identity(BTC_PATH, KEY_BTC) } });
        const vault = mockVault([existing], []);

        const record = await registerSigner({
            ...fromLitecoinApp,
            vault,
            identities: {
                'bitcoin-mainnet': identity(BTC_PATH, KEY_BTC),
                'litecoin-mainnet': identity(LTC_PATH, KEY_LTC),
            },
        });

        expect(record.id).toBe('signer-ledger');
        expect(record.deviceIdentifier).toBe('id-from-bitcoin-app');
        expect(Object.keys(record.identities).sort()).toEqual(['bitcoin-mainnet', 'litecoin-mainnet']);
        expect(record.lastSeenAt).toBe('2026-11-15T10:00:00.000Z');
        expect(validateSignerRecord(record)).toEqual({ ok: true, errors: [] });
        expect(vault.signers.put).toHaveBeenCalledOnce();
        expect(vault.signers.put).toHaveBeenCalledWith(record);
    });

    it('writes a new record, with its identities, for a Ledger it has not seen', async () => {
        const vault = mockVault([ledgerRecord({ identities: { 'bitcoin-mainnet': identity(BTC_PATH, KEY_BTC) } })]);

        const record = await registerSigner({
            ...fromLitecoinApp,
            vault,
            identities: { 'litecoin-mainnet': identity(LTC_PATH, KEY_OTHER) },
        });

        expect(record.id).not.toBe('signer-ledger');
        expect(record.identities).toEqual({ 'litecoin-mainnet': identity(LTC_PATH, KEY_OTHER) });
        expect(validateSignerRecord(record)).toEqual({ ok: true, errors: [] });
    });

    it('ignores identities for a Trezor, whose device id serves every coin', async () => {
        const vault = mockVault([]);
        const record = await registerSigner({
            walletId: 'wallet-1',
            kind: 'trezor',
            vendor: 'trezor',
            model: 'T3T1',
            deviceIdentifier: 'trezor-1',
            vault,
            identities: { 'bitcoin-mainnet': identity(BTC_PATH, KEY_BTC) },
        });
        expect(record.identities).toBeUndefined();
    });
});
