/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A hardware wallet's Add network: activateChain with `accountId` fills one
// network into one existing account (at that account's own number, never a
// new account), reading the address through the app open on the device. On
// a Ledger the first read records the network's identity on the SignerRecord;
// another app open is a wait (`hardwareSkipped: 'wrong-app'`), not a failure.
//
// The vault, addHardwareWallet, LedgerSigner, its factory and the session
// signer are the real ones; only the device is a stand-in.

import { describe, expect, it, vi } from 'vitest';
import { activateChain } from '../../../packages/core/src/flows/activateChain.js';
import { addHardwareWallet } from '../../../packages/core/src/flows/hardwareWallet.js';
import { listSignersForWallet, recordLedgerIdentities } from '../../../packages/core/src/flows/registerSigner.js';
import { ensureSettings } from '../../../packages/core/src/flows/seedSettings.js';
import { makeLedgerFactory } from '../../../packages/core/src/signerFactories/ledger.js';
import {
    makeHardwareSessionSigner, openHardwareSigner,
} from '../../../packages/core/src/signers/hardwareReconnect.js';
import { ledgerIdentityFingerprint } from '../../../packages/core/src/signers/ledgerIdentity.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { InMemoryBackend, Vault } from '../../../packages/core/src/storage/index.js';
import { SEED_A, seededLedger } from '../../helpers/hwSeedDevice.js';

const REGISTRY = defaultRegistry();
const SDKS = { get: () => ({}) };
const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';

function ledgerHolding(openApp, mnemonic = SEED_A) {
    const dev = seededLedger(mnemonic, { openApp });
    const factory = vi.fn(makeLedgerFactory({
        getTransport: async () => dev.transport,
        getAppClass: async () => dev.Btc,
    }));
    return { dev, factory };
}

/** A Ledger wallet connected with only the Bitcoin app read, accounts 1 and 2. */
async function bitcoinOnlyLedgerWallet() {
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(7) });
    await vault.open();
    const { factory } = ledgerHolding('Bitcoin');
    const { signer, pairingInfo } = await factory();
    const accounts = [];
    for (const accountIndex of [0, 1]) {
        // eslint-disable-next-line no-await-in-loop
        const [derived] = await signer.getAddresses({
            chainId: BTC, addressType: 'p2wpkh', accountIndex, change: 0, startIndex: 0, count: 1,
        });
        accounts.push({
            chainId: BTC, accountIndex, address: derived.address, publicKey: derived.publicKey, derivationPath: derived.path, addressType: 'p2wpkh',
        });
    }
    const hw = await addHardwareWallet({
        vault,
        chainRegistry: REGISTRY,
        name: 'Desk Ledger',
        device: {
            vendor: 'ledger', model: pairingInfo.model, deviceIdentifier: pairingInfo.deviceIdentifier, firmwareVersion: pairingInfo.firmwareVersion,
        },
        accounts,
    });
    await ensureSettings(vault, REGISTRY, [BTC]);
    const [record] = await listSignersForWallet(vault, hw.wallet.id, { withIdentities: true });
    const walletAccounts = (await vault.accounts.findBy('walletId', hw.wallet.id)).sort((a, b) => a.index - b.index);
    return { vault, hw, record, walletAccounts };
}

function sessionWith(record, holder) {
    return makeHardwareSessionSigner(record, {
        open: (r, o) => openHardwareSigner(r, { ledger: holder.factory }, o),
    });
}

describe('activateChain with accountId on a Ledger wallet', () => {
    it('fills the network into that one account at its own number and records the network identity', async () => {
        const { vault, hw, record, walletAccounts } = await bitcoinOnlyLedgerWallet();
        expect(record.identities[LTC]).toBeUndefined();
        const [first, second] = walletAccounts;
        const session = sessionWith(record, ledgerHolding('Litecoin'));

        const result = await activateChain({
            walletId: hw.wallet.id, chainId: LTC, accountId: second.id, signer: session, vault, chainRegistry: REGISTRY, sdkRegistry: SDKS,
        });
        expect(result.hardwareSkipped).toBeUndefined();
        expect(result.addresses).toHaveLength(1);
        const [{ accountId, address }] = result.addresses;
        expect(accountId).toBe(second.id);
        expect(address).toMatchObject({ chain: 'litecoin', network: 'mainnet', source: 'ledger', signerId: hw.signer.id });
        expect(address.derivationPath).toBe("m/84'/2'/1'/0/0");

        const all = await vault.addresses.list();
        expect(all.filter((a) => a.accountId === first.id && a.chain === 'litecoin')).toEqual([]);
        expect(await vault.accounts.findBy('walletId', hw.wallet.id)).toHaveLength(2);

        const stored = await vault.signers.get(hw.signer.id);
        expect(stored.identities[LTC]).toEqual({
            path: address.derivationPath,
            fingerprint: ledgerIdentityFingerprint(address.publicKey),
        });
        expect(stored.identities[BTC]).toEqual(record.identities[BTC]);
        expect(JSON.stringify(stored)).not.toContain(address.publicKey);
    });

    it('keeps the identity a network was first read with when another account adds it later', async () => {
        const { vault, hw, record, walletAccounts } = await bitcoinOnlyLedgerWallet();
        const [first, second] = walletAccounts;
        const session = sessionWith(record, ledgerHolding('Litecoin'));
        await activateChain({
            walletId: hw.wallet.id, chainId: LTC, accountId: second.id, signer: session, vault, chainRegistry: REGISTRY, sdkRegistry: SDKS,
        });
        const firstIdentity = (await vault.signers.get(hw.signer.id)).identities[LTC];
        await activateChain({
            walletId: hw.wallet.id, chainId: LTC, accountId: first.id, signer: session, vault, chainRegistry: REGISTRY, sdkRegistry: SDKS,
        });
        expect((await vault.signers.get(hw.signer.id)).identities[LTC]).toEqual(firstIdentity);
    });

    it('answers another open app as a wait, writing no address and no identity', async () => {
        const { vault, hw, record, walletAccounts } = await bitcoinOnlyLedgerWallet();
        const session = sessionWith(record, ledgerHolding('Bitcoin'));
        const result = await activateChain({
            walletId: hw.wallet.id, chainId: LTC, accountId: walletAccounts[1].id, signer: session, vault, chainRegistry: REGISTRY, sdkRegistry: SDKS,
        });
        expect(result).toMatchObject({ addresses: [], hardwareSkipped: 'wrong-app' });
        expect((await vault.addresses.list()).some((a) => a.chain === 'litecoin')).toBe(false);
        expect((await vault.signers.get(hw.signer.id)).identities?.[LTC]).toBeUndefined();
    });

    it('refuses an account of another wallet before writing anything', async () => {
        const { vault, hw, record } = await bitcoinOnlyLedgerWallet();
        const session = sessionWith(record, ledgerHolding('Litecoin'));
        await expect(activateChain({
            walletId: hw.wallet.id, chainId: LTC, accountId: 'acct-elsewhere', signer: session, vault, chainRegistry: REGISTRY, sdkRegistry: SDKS,
        })).rejects.toThrow(/does not belong/);
        expect((await vault.settings.get()).fees?.[LTC]).toBeUndefined();
    });
});

describe('activateChain with accountId on a Trezor wallet', () => {
    it('fills the network into the one account, with no identities (a Trezor has one device id)', async () => {
        const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(7) });
        await vault.open();
        const hw = await addHardwareWallet({
            vault,
            chainRegistry: REGISTRY,
            name: 'Desk Trezor',
            device: { vendor: 'trezor', model: 'T3T1', deviceIdentifier: 'trezor-dev', firmwareVersion: null },
            accounts: [0, 1].map((accountIndex) => ({
                chainId: BTC, accountIndex, address: `bc1qtrezor${accountIndex}`, publicKey: `02${'a'.repeat(64)}`, derivationPath: `m/84'/0'/${accountIndex}'/0/0`, addressType: 'p2wpkh',
            })),
        });
        await ensureSettings(vault, REGISTRY, [BTC]);
        const accounts = (await vault.accounts.findBy('walletId', hw.wallet.id)).sort((a, b) => a.index - b.index);
        const trezor = {
            id: hw.signer.id,
            kind: 'trezor',
            getAddresses: vi.fn(async ({ accountIndex }) => [{
                index: 0, address: `ltc1qtrezor${accountIndex}`, publicKey: `03${'b'.repeat(64)}`, path: `m/84'/2'/${accountIndex}'/0/0`,
            }]),
        };
        const result = await activateChain({
            walletId: hw.wallet.id, chainId: LTC, accountId: accounts[0].id, signer: trezor, vault, chainRegistry: REGISTRY, sdkRegistry: SDKS,
        });
        expect(trezor.getAddresses).toHaveBeenCalledOnce();
        expect(trezor.getAddresses).toHaveBeenCalledWith(expect.objectContaining({ chainId: LTC, accountIndex: 0 }));
        expect(result.addresses).toHaveLength(1);
        expect(result.addresses[0].address).toMatchObject({ source: 'trezor', derivationPath: "m/84'/2'/0'/0/0" });
        expect(await vault.signers.get(hw.signer.id)).not.toHaveProperty('identities');
    });
});

describe('recordLedgerIdentities', () => {
    it('writes nothing for a Trezor record, an unknown id, or a read with no usable key', async () => {
        const put = vi.fn();
        const vault = { signers: { get: vi.fn(async (id) => (id === 't' ? { id: 't', vendor: 'trezor' } : null)), put } };
        await expect(recordLedgerIdentities(vault, 't', [{ chainId: LTC, derivationPath: "m/84'/2'/0'/0/0", publicKey: `02${'c'.repeat(64)}` }])).resolves.toEqual([]);
        await expect(recordLedgerIdentities(vault, 'missing', [])).resolves.toEqual([]);
        vault.signers.get = vi.fn(async () => ({ id: 'l', vendor: 'ledger' }));
        await expect(recordLedgerIdentities(vault, 'l', [{ chainId: LTC, derivationPath: "m/84'/2'/0'/0/0", publicKey: 'zz' }])).resolves.toEqual([]);
        expect(put).not.toHaveBeenCalled();
    });
});
