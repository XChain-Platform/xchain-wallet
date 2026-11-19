// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Add account on a Ledger hardware wallet (the manage page's Add account).
// A Ledger answers only the coin of the app that is open, so the new account
// keeps every network that app reads and leaves the others waiting, as the
// connect flow does, instead of failing on the first refusal. A network it
// read records its identity: the signer list derives it from the address the
// device gave, so a later sign on that network can confirm the device.

import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryBackend, Vault } from '../../../packages/core/src/storage/index.js';
import { ChainRegistry } from '../../../packages/core/src/registry/index.js';
import { addHardwareWallet } from '../../../packages/core/src/flows/hardwareWallet.js';
import { createAccount } from '../../../packages/core/src/flows/createAccount.js';
import { listSignersForWallet } from '../../../packages/core/src/flows/registerSigner.js';
import { hardwareSigningError } from '../../../packages/core/src/signers/Signer.js';
import { RemoteSigner } from '../../../packages/core/src/signers/RemoteSigner.js';
import { ledgerIdentityFingerprint } from '../../../packages/core/src/signers/ledgerIdentity.js';

const chainRegistry = new ChainRegistry();
const sdkRegistry = { get: () => ({}) };
const MAINNETS = ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet'];
const COIN_TYPE = { 'bitcoin-mainnet': 0, 'litecoin-mainnet': 2, 'dogecoin-mainnet': 3 };
const keyFor = (chainId, accountIndex) => `02${String(COIN_TYPE[chainId]).padStart(2, '0')}${String(accountIndex).padStart(2, '0')}${'cd'.repeat(30)}`;

async function openVault() {
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(9) });
    await vault.open();
    return vault;
}

/**
 * A Ledger with one app open. A path of another coin is refused the way the
 * signer reports it; `portMessageOnly` drops everything but name and message,
 * as the extension and desktop signer ports do.
 */
function ledgerWithApp(signerId, openChainId, { portMessageOnly = false } = {}) {
    const calls = [];
    return {
        calls,
        signer: {
            id: signerId,
            kind: 'ledger',
            async getAddresses({ chainId, accountIndex }) {
                calls.push(chainId);
                if (chainId !== openChainId) {
                    const err = hardwareSigningError(signerId, 'ledger', Object.assign(new Error('UNKNOWN_ERROR'), { statusCode: 0x6a82 }));
                    if (!portMessageOnly) throw err;
                    throw Object.assign(new Error(err.message), { name: err.name });
                }
                return [{
                    address: `${chainId}-acct${accountIndex}`,
                    publicKey: keyFor(chainId, accountIndex),
                    path: `m/84'/${COIN_TYPE[chainId]}'/${accountIndex}'/0/0`,
                }];
            },
        },
    };
}

describe('Add account on a Ledger hardware wallet, one app open', () => {
    let vault;
    let hw;

    beforeEach(async () => {
        vault = await openVault();
        hw = await addHardwareWallet({
            vault,
            chainRegistry,
            name: 'My Ledger',
            device: { vendor: 'ledger', model: 'nanoX', deviceIdentifier: 'ledger-btc-app', firmwareVersion: '2.2.1' },
            accounts: [{
                chainId: 'bitcoin-mainnet',
                accountIndex: 0,
                address: 'bitcoin-mainnet-acct0',
                publicKey: keyFor('bitcoin-mainnet', 0),
                derivationPath: "m/84'/0'/0'/0/0",
                addressType: 'p2wpkh',
            }],
        });
    });

    it('keeps the network the open app reads and leaves the others waiting', async () => {
        const device = ledgerWithApp(hw.signer.id, 'litecoin-mainnet');
        const out = await createAccount({
            vault, walletId: hw.wallet.id, signer: device.signer, chainRegistry, sdkRegistry, activeChainIds: MAINNETS,
        });

        expect(device.calls).toEqual(MAINNETS);
        expect(out.account.index).toBe(1);
        expect(out.addresses.map(({ chainId }) => chainId)).toEqual(['litecoin-mainnet']);
        expect(out.waitingChains).toEqual(['bitcoin-mainnet', 'dogecoin-mainnet']);
        const stored = (await vault.addresses.list()).filter((a) => a.accountId === out.account.id);
        expect(stored.map((a) => [a.chain, a.source, a.signerId])).toEqual([['litecoin', 'ledger', hw.signer.id]]);
    });

    it('records the identity of the network it read, through the signer list', async () => {
        const before = (await listSignersForWallet(vault, hw.wallet.id, { withIdentities: true }))[0];
        expect(Object.keys(before.identities)).toEqual(['bitcoin-mainnet']);

        await createAccount({
            vault,
            walletId: hw.wallet.id,
            signer: ledgerWithApp(hw.signer.id, 'litecoin-mainnet').signer,
            chainRegistry,
            sdkRegistry,
            activeChainIds: MAINNETS,
        });

        const after = (await listSignersForWallet(vault, hw.wallet.id, { withIdentities: true }))[0];
        expect(Object.keys(after.identities).sort()).toEqual(['bitcoin-mainnet', 'litecoin-mainnet']);
        expect(after.identities['litecoin-mainnet']).toEqual({
            path: "m/84'/2'/1'/0/0",
            fingerprint: ledgerIdentityFingerprint(keyFor('litecoin-mainnet', 1)),
        });
    });

    it('sorts the refusal from its message alone, as it crosses a signer port', async () => {
        const out = await createAccount({
            vault,
            walletId: hw.wallet.id,
            signer: ledgerWithApp(hw.signer.id, 'dogecoin-mainnet', { portMessageOnly: true }).signer,
            chainRegistry,
            sdkRegistry,
            activeChainIds: MAINNETS,
        });
        expect(out.addresses.map(({ chainId }) => chainId)).toEqual(['dogecoin-mainnet']);
        expect(out.waitingChains).toEqual(['bitcoin-mainnet', 'litecoin-mainnet']);
    });

    it('sorts it through the real RemoteSigner the extension and desktop hosts use', async () => {
        // The port hands the host only name and message; RemoteSigner wraps them.
        const device = ledgerWithApp(hw.signer.id, 'litecoin-mainnet', { portMessageOnly: true });
        const remote = new RemoteSigner({
            id: hw.signer.id,
            displayName: 'My Ledger',
            kind: 'ledger',
            transport: async ({ op, payload }) => {
                if (op !== 'getAddresses') throw new Error(`unexpected ${op}`);
                return device.signer.getAddresses(payload);
            },
        });
        const out = await createAccount({
            vault, walletId: hw.wallet.id, signer: remote, chainRegistry, sdkRegistry, activeChainIds: MAINNETS,
        });
        expect(out.addresses.map(({ chainId }) => chainId)).toEqual(['litecoin-mainnet']);
        expect(out.waitingChains).toEqual(['bitcoin-mainnet', 'dogecoin-mainnet']);
    });

    it('fails with the wrong-app refusal when the open app serves none of the networks, and writes nothing', async () => {
        const accountsBefore = (await vault.accounts.list()).length;
        const err = await createAccount({
            vault,
            walletId: hw.wallet.id,
            signer: ledgerWithApp(hw.signer.id, 'bitcoin-testnet').signer,
            chainRegistry,
            sdkRegistry,
            activeChainIds: MAINNETS,
        }).catch((e) => e);
        expect(err).toMatchObject({ code: 'HW_WRONG_APP' });
        expect((await vault.accounts.list()).length).toBe(accountsBefore);
    });

    it('still fails at once on any other device error', async () => {
        const signer = {
            id: hw.signer.id,
            kind: 'ledger',
            async getAddresses() { throw new Error('Device disconnected'); },
        };
        await expect(createAccount({
            vault, walletId: hw.wallet.id, signer, chainRegistry, sdkRegistry, activeChainIds: MAINNETS,
        })).rejects.toThrow('Device disconnected');
    });
});
