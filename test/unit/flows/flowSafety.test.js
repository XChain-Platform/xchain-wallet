// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const capture = vi.hoisted(() => ({ decoded: null, exported: null }));

vi.mock('../../../packages/core/src/crypto/index.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        encodeBackupEnvelope: vi.fn(async (input) => {
            capture.exported = structuredClone(input.payload);
            return {
                magic: 'XCHAIN-WALLET-BACKUP',
                formatVersion: 1,
                createdAt: '2026-10-13T18:00:00.000Z',
                walletName: 'Safety test',
                encryption: {
                    algorithm: 'aes-256-gcm',
                    kdf: input.kdfParams,
                    iv: 'aXY=',
                    tag: 'dGFn',
                },
                payload: 'Y2lwaGVydGV4dA==',
            };
        }),
        decodeBackupEnvelope: vi.fn(async () => structuredClone(capture.decoded)),
    };
});

import {
    exportBackupFile,
    importBackupFile,
    remintIdentifiers,
} from '../../../packages/core/src/flows/backupFile.js';
import {
    computeBackupReminderState,
    dismissBackupReminder,
} from '../../../packages/core/src/flows/backupReminder.js';
import { isBiometricSupported } from '../../../packages/core/src/flows/biometricUnlock.js';

const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 3,
    memory: 65536,
    parallelism: 1,
};
const DAY = 24 * 60 * 60 * 1000;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalPublicKeyCredential = Object.getOwnPropertyDescriptor(
    globalThis, 'PublicKeyCredential',
);

function testEnvelope(kdf = KDF_PARAMS) {
    return {
        magic: 'XCHAIN-WALLET-BACKUP',
        formatVersion: 1,
        createdAt: '2026-10-13T18:00:00.000Z',
        walletName: 'Safety test',
        encryption: {
            algorithm: 'aes-256-gcm',
            kdf,
            iv: 'aXY=',
            tag: 'dGFn',
        },
        payload: 'Y2lwaGVydGV4dA==',
    };
}

function collection(records = []) {
    return {
        get: vi.fn(async (id) => records.find((record) => record.id === id) ?? null),
        list: vi.fn(async () => records),
        put: vi.fn(async () => {}),
    };
}

function vaultWith(records = {}) {
    return {
        wallets: collection(records.wallets),
        accounts: collection(records.accounts),
        addresses: collection(records.addresses),
        contacts: collection(records.contacts),
        connectedSites: collection(records.connectedSites),
        pendingTxs: collection(records.pendingTxs),
        settings: {
            get: vi.fn(async () => records.settings ?? null),
            put: vi.fn(async () => {}),
        },
    };
}

beforeEach(() => {
    capture.decoded = null;
    capture.exported = null;
    globalThis.localStorage.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
    if (originalPublicKeyCredential) {
        Object.defineProperty(globalThis, 'PublicKeyCredential', originalPublicKeyCredential);
    } else {
        delete globalThis.PublicKeyCredential;
    }
});

describe('backup wallet and network scope', () => {
    it('exports only matching-network pending transactions and target-wallet grants', async () => {
        const wallet = { id: 'wallet-1', name: 'Scoped', importedKeys: [] };
        const ownAccount = { id: 'account-1', walletId: wallet.id };
        const otherAccount = { id: 'account-2', walletId: 'wallet-2' };
        const ownAddress = {
            id: 'address-1', accountId: ownAccount.id,
            chain: 'bitcoin', network: 'mainnet', address: 'same-text-address',
        };
        const otherAddress = {
            id: 'address-2', accountId: otherAccount.id,
            chain: 'bitcoin', network: 'testnet', address: 'same-text-address',
        };
        const ownPending = {
            id: 'pending-1', chain: 'bitcoin', network: 'mainnet',
            fromAddress: ownAddress.address,
        };
        const otherPending = {
            id: 'pending-2', chain: 'bitcoin', network: 'testnet',
            fromAddress: otherAddress.address,
        };
        const mixedSite = {
            id: 'site-1',
            permissions: { accounts: [ownAccount.id, otherAccount.id] },
        };
        const otherSite = {
            id: 'site-2',
            permissions: { accounts: [otherAccount.id] },
        };
        const vault = vaultWith({
            wallets: [wallet],
            accounts: [ownAccount, otherAccount],
            addresses: [ownAddress, otherAddress],
            pendingTxs: [ownPending, otherPending],
            connectedSites: [mixedSite, otherSite],
        });

        await exportBackupFile({
            vault, walletId: wallet.id, password: 'backup-secret', kdfParams: KDF_PARAMS,
        });

        expect(capture.exported.pendingTxs).toEqual([ownPending]);
        expect(capture.exported.connectedSites).toEqual([{
            ...mixedSite,
            permissions: { accounts: [ownAccount.id] },
        }]);
        expect(mixedSite.permissions.accounts).toEqual([ownAccount.id, otherAccount.id]);
    });

    it('rewires connected-site account grants in add mode', () => {
        const payload = {
            wallet: { id: 'wallet-1', importedKeys: [] },
            accounts: [{ id: 'account-1', walletId: 'wallet-1' }],
            addresses: [],
            connectedSites: [{
                id: 'site-1',
                permissions: { accounts: ['account-1'] },
            }],
            pendingTxs: [],
        };

        remintIdentifiers(payload);

        expect(payload.connectedSites[0].permissions.accounts)
            .toEqual([payload.accounts[0].id]);
        expect(payload.connectedSites[0].permissions.accounts[0]).not.toBe('account-1');
    });

    it('rejects another wallet account before writing any vault state', async () => {
        capture.decoded = {
            payloadVersion: 1,
            wallet: {
                schemaVersion: 3,
                id: 'wallet-1',
                importedKeys: [],
                encryptedSeed: '',
                encryptedPassphrase: null,
            },
            accounts: [{ schemaVersion: 2, id: 'foreign-account', walletId: 'wallet-2' }],
            addresses: [],
            contacts: [],
            connectedSites: [],
            signers: [],
            pendingTxs: [],
            settings: null,
        };
        const vault = vaultWith();

        await expect(importBackupFile({
            vault,
            fileContent: testEnvelope(),
            password: 'backup-secret',
        })).rejects.toThrow(/belongs to another wallet/);

        for (const name of ['wallets', 'accounts', 'addresses', 'contacts', 'connectedSites', 'pendingTxs']) {
            expect(vault[name].put).not.toHaveBeenCalled();
        }
        expect(vault.settings.put).not.toHaveBeenCalled();
    });

    it('restores an older backup with a dangling imported key and an off-network pending transaction', async () => {
        // Shapes an earlier exporter wrote: importedKeys kept a reference to an
        // address record that no longer existed, and pending transactions were
        // matched by address text alone, so a same-text testnet row rode along.
        const ownPending = {
            schemaVersion: 3, id: 'pending-1', chain: 'bitcoin', network: 'mainnet',
            fromAddress: 'same-text-address', txid: 'a'.repeat(64), status: 'broadcast',
        };
        const offNetworkPending = {
            ...ownPending, id: 'pending-2', network: 'testnet',
        };
        capture.decoded = {
            payloadVersion: 1,
            wallet: {
                schemaVersion: 3,
                id: 'wallet-1',
                importedKeys: [{ addressId: 'removed-address' }],
                encryptedSeed: '',
                encryptedPassphrase: null,
            },
            accounts: [{ schemaVersion: 2, id: 'account-1', walletId: 'wallet-1' }],
            addresses: [{
                schemaVersion: 1, id: 'address-1', accountId: 'account-1',
                chain: 'bitcoin', network: 'mainnet', address: 'same-text-address',
            }],
            contacts: [],
            connectedSites: [],
            signers: [],
            pendingTxs: [ownPending, offNetworkPending],
            settings: null,
        };
        const vault = vaultWith();

        const result = await importBackupFile({
            vault,
            fileContent: testEnvelope(),
            password: 'backup-secret',
        });

        expect(result.walletId).toBe('wallet-1');
        expect(result.writes.wallets).toBe(1);
        expect(result.writes.addresses).toBe(1);
        // The same-text testnet row is dropped, never written.
        expect(vault.pendingTxs.put.mock.calls.map(([p]) => p.id)).toEqual(['pending-1']);
    });
});

describe('backup reminder input validation', () => {
    it('uses the current time instead of persisting a non-finite snooze time', () => {
        const fundedAt = Date.parse('2026-06-01T00:00:00.000Z');
        vi.spyOn(Date, 'now').mockReturnValue(fundedAt);
        computeBackupReminderState({ walletId: 'wallet-1', hasFunds: true, now: fundedAt });

        dismissBackupReminder('wallet-1', Number.NaN);

        expect(computeBackupReminderState({
            walletId: 'wallet-1', hasFunds: false, now: fundedAt + DAY - 1,
        })).toEqual({ kind: 'hidden', recheckAt: fundedAt + DAY });
    });

    it('does not create reminder state under a coerced non-string wallet key', () => {
        expect(computeBackupReminderState({
            walletId: { id: 'wallet-1' }, hasFunds: true, now: 1,
        })).toEqual({ kind: 'hidden' });
        expect(globalThis.localStorage.getItem('xc:backupReminderFundedAt')).toBeNull();
    });
});

describe('biometric capability validation', () => {
    it('reports unsupported when WebAuthn cannot perform assertions', async () => {
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: { credentials: { create: vi.fn(async () => null) } },
        });
        globalThis.PublicKeyCredential = class {
            static isUserVerifyingPlatformAuthenticatorAvailable = vi.fn(async () => true);
        };

        expect(await isBiometricSupported()).toBe(false);
        expect(globalThis.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable)
            .not.toHaveBeenCalled();
    });
});
