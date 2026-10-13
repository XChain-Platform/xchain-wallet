// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { reconcileAddressSigners } from '../../../packages/core/src/flows/reconcileAddressSigners.js';
import { registerSigner } from '../../../packages/core/src/flows/registerSigner.js';
import { resolveSigner, SignerResolutionError } from '../../../packages/core/src/flows/resolveSigner.js';
import { signerSupportsTapscript } from '../../../packages/core/src/flows/signerCapability.js';

function address(id, publicKey, overrides = {}) {
    return {
        id,
        accountId: 'account-a',
        chain: 'bitcoin',
        network: 'mainnet',
        derivationPath: `m/84'/0'/0'/0/${id}`,
        publicKey,
        signerId: null,
        ...overrides,
    };
}

function reconcileVault(addresses, signerRecords = []) {
    return {
        accounts: {
            list: vi.fn(async () => [
                { id: 'account-a', walletId: 'wallet-a' },
                { id: 'account-b', walletId: 'wallet-b' },
            ]),
        },
        signers: { list: vi.fn(async () => signerRecords) },
        addresses: {
            list: vi.fn(async () => addresses),
            put: vi.fn(async () => undefined),
        },
    };
}

const chainRegistry = {
    chainIdFor: vi.fn((chain, network) => `${chain}-${network}`),
};

describe('signer flow hardening', () => {
    it('refuses a hardware signer record owned by another wallet', async () => {
        const signerRecord = {
            id: 'signer-b',
            walletId: 'wallet-b',
            kind: 'ledger',
        };
        const vault = {
            signers: { find: vi.fn(async () => signerRecord) },
            accounts: { get: vi.fn(async () => ({ id: 'account-a', walletId: 'wallet-a' })) },
        };

        await expect(resolveSigner({
            vault,
            address: address('address-a', 'pubkey', {
                source: 'ledger',
                signerId: signerRecord.id,
            }),
        })).rejects.toMatchObject({
            name: 'SignerResolutionError',
            addressWalletId: 'wallet-a',
            signerWalletId: 'wallet-b',
        });
        await expect(resolveSigner({
            vault,
            address: address('address-a', 'pubkey', {
                source: 'ledger',
                signerId: signerRecord.id,
            }),
        })).rejects.toBeInstanceOf(SignerResolutionError);
    });

    it('rejects an unknown signer kind before an existing record can turn it into success', async () => {
        const existing = {
            id: 'signer-a',
            walletId: 'wallet-a',
            kind: 'ledger',
            vendor: 'ledger',
            deviceIdentifier: 'device-a',
        };
        const vault = {
            signers: {
                list: vi.fn(async () => [existing]),
                put: vi.fn(async () => undefined),
            },
        };

        await expect(registerSigner({
            vault,
            walletId: 'wallet-a',
            kind: 'future-signer',
            vendor: 'ledger',
            model: 'nanoX',
            deviceIdentifier: 'device-a',
        })).rejects.toThrow(/kind must be one of trezor, ledger/);
        expect(vault.signers.list).not.toHaveBeenCalled();
        expect(vault.signers.put).not.toHaveBeenCalled();
    });

    it('rejects contradictory signer kind and vendor metadata', async () => {
        const vault = {
            signers: {
                list: vi.fn(async () => []),
                put: vi.fn(async () => undefined),
            },
        };

        await expect(registerSigner({
            vault,
            walletId: 'wallet-a',
            kind: 'trezor',
            vendor: 'ledger',
            model: 'nanoX',
            deviceIdentifier: 'device-a',
        })).rejects.toThrow(/vendor must match kind/);
        expect(vault.signers.list).not.toHaveBeenCalled();
        expect(vault.signers.put).not.toHaveBeenCalled();
    });

    it('fails closed when an address source accessor throws', () => {
        const addressRecord = {
            get source() {
                throw new Error('unreadable source');
            },
        };

        expect(signerSupportsTapscript(addressRecord)).toBe(false);
    });

    it('propagates derivation failures without reporting a successful no-match', async () => {
        const vault = reconcileVault([address('0', 'pubkey')]);
        const failure = new Error('device disconnected');
        const signer = {
            id: 'wallet-a',
            getPublicKey: vi.fn(async () => { throw failure; }),
        };

        await expect(reconcileAddressSigners({
            vault,
            chainRegistry,
            signers: [signer],
        })).rejects.toBe(failure);
        expect(vault.addresses.put).not.toHaveBeenCalled();
    });

    it('does not persist earlier matches when a later address is ambiguous', async () => {
        const addresses = [address('0', 'first'), address('1', 'second')];
        const records = [
            { id: 'signer-a1', walletId: 'wallet-a' },
            { id: 'signer-a2', walletId: 'wallet-a' },
        ];
        const vault = reconcileVault(addresses, records);
        const signers = [
            {
                id: 'signer-a1',
                getPublicKey: vi.fn(async ({ path }) => ({
                    publicKey: path.endsWith('/0') ? 'first' : 'second',
                })),
            },
            {
                id: 'signer-a2',
                getPublicKey: vi.fn(async ({ path }) => ({
                    publicKey: path.endsWith('/0') ? 'not-first' : 'second',
                })),
            },
        ];

        await expect(reconcileAddressSigners({
            vault,
            chainRegistry,
            signers,
        })).rejects.toThrow(/matches multiple signers/);
        expect(vault.addresses.put).not.toHaveBeenCalled();
    });

    it('does not attach a matching signer owned by another wallet', async () => {
        const candidate = address('0', 'same-key');
        const vault = reconcileVault([candidate], [
            { id: 'signer-b', walletId: 'wallet-b' },
        ]);
        const signer = {
            id: 'signer-b',
            getPublicKey: vi.fn(async () => ({ publicKey: candidate.publicKey })),
        };

        await expect(reconcileAddressSigners({
            vault,
            chainRegistry,
            signers: [signer],
        })).resolves.toEqual({
            scanned: 1,
            reconciled: 0,
            skipped: [{ id: candidate.id, reason: 'no-match' }],
        });
        expect(signer.getPublicKey).not.toHaveBeenCalled();
        expect(vault.addresses.put).not.toHaveBeenCalled();
    });

    it('persists a same-wallet match using the address chain and stored path', async () => {
        const candidate = address('7', 'same-key');
        const vault = reconcileVault([candidate], [
            { id: 'signer-a', walletId: 'wallet-a' },
        ]);
        const signer = {
            id: 'signer-a',
            getPublicKey: vi.fn(async () => ({ publicKey: candidate.publicKey })),
        };

        await expect(reconcileAddressSigners({
            vault,
            chainRegistry,
            signers: [signer],
        })).resolves.toEqual({ scanned: 1, reconciled: 1, skipped: [] });
        expect(signer.getPublicKey).toHaveBeenCalledWith({
            chainId: 'bitcoin-mainnet',
            path: candidate.derivationPath,
        });
        expect(vault.addresses.put).toHaveBeenCalledWith({
            ...candidate,
            signerId: signer.id,
        });
    });
});
