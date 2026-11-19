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

// A Ledger is recognised from whichever coin app the operation needs.
//
// Each Ledger coin app answers only its own coin type, and the fake device
// here enforces that for EVERY app, the Bitcoin app included: a request
// outside the open app's coin type fails with 0x6a82 as on a device. The
// identifier read at pairing in the Bitcoin app (m/44'/0'/0') therefore
// cannot be re-read with the Litecoin, Dogecoin or Bitcoin Test app open,
// so a single Bitcoin-app identity would make every reconnect for those
// chains demand the Bitcoin app. The record keeps one identity per chain (a hash of the
// first address key the device gave there) and the reconnect checks it
// through the open app.
//
// The pairing factory, LedgerSigner, addHardwareWallet, listSignersForWallet,
// ensureLive and the session signer are the real ones; only the device and
// the vault backend are stand-ins.

import { describe, it, expect, vi } from 'vitest';
import { makeLedgerFactory } from '../../../packages/core/src/signerFactories/ledger.js';
import { ensureLive } from '../../../packages/core/src/signers/hardwareSession.js';
import {
    _resetHardwareReconnectForTests,
    invalidateLiveSigners,
    makeHardwareSessionSigner,
    openHardwareSigner,
    sessionSignerFor,
    sessionSignerForRecord,
    setHardwareFactories,
} from '../../../packages/core/src/signers/hardwareReconnect.js';
import {
    checkLedgerIdentity, compressedPublicKeyHex, ledgerIdentityFingerprint,
} from '../../../packages/core/src/signers/ledgerIdentity.js';
import { addHardwareWallet } from '../../../packages/core/src/flows/hardwareWallet.js';
import { listSignersForWallet } from '../../../packages/core/src/flows/registerSigner.js';
import { validateSignerRecord } from '../../../packages/core/src/schemas/signer.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { InMemoryBackend, Vault } from '../../../packages/core/src/storage/index.js';
import {
    LEDGER_APP_NAME_FOR_CHAIN, deriveLedgerDeviceIdentifier,
} from '../../../packages/signers-ledger/src/LedgerSigner.js';
import { SEED_A, SEED_B, seededLedger } from '../../helpers/hwSeedDevice.js';

const REGISTRY = defaultRegistry();
const CHAINS = ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet', 'bitcoin-testnet', 'bitcoin-regtest'];
const TUPLE = { accountIndex: 0, change: 0, startIndex: 0, count: 1 };

function ledgerHolding(mnemonic, openApp) {
    const dev = seededLedger(mnemonic, { openApp });
    const factory = vi.fn(makeLedgerFactory({
        getTransport: async () => dev.transport,
        getAppClass: async () => dev.Btc,
    }));
    return { dev, factory };
}

async function openVault() {
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(7) });
    await vault.open();
    return vault;
}

/**
 * Pair with the Bitcoin app open, then find the first account on each chain
 * with that chain's app open (each app derives only its own coin), and save
 * the hardware wallet.
 */
async function pairedLedgerWallet({ mnemonic = SEED_A, vault, name = 'Desk Ledger', pairApp = 'Bitcoin' } = {}) {
    const { dev, factory } = ledgerHolding(mnemonic, pairApp);
    const { signer, pairingInfo } = await factory();
    const accounts = [];
    for (const chainId of CHAINS) {
        dev.device.openApp = LEDGER_APP_NAME_FOR_CHAIN[chainId];
        const addressType = REGISTRY.get(chainId).defaultAddressType;
        // eslint-disable-next-line no-await-in-loop
        const [derived] = await signer.getAddresses({ chainId, addressType, ...TUPLE });
        accounts.push({
            chainId, accountIndex: 0, address: derived.address, publicKey: derived.publicKey, derivationPath: derived.path, addressType,
        });
    }
    const v = vault ?? await openVault();
    const hw = await addHardwareWallet({
        vault: v,
        chainRegistry: REGISTRY,
        name,
        device: {
            vendor: 'ledger', model: pairingInfo.model, deviceIdentifier: pairingInfo.deviceIdentifier, firmwareVersion: pairingInfo.firmwareVersion,
        },
        accounts,
    });
    return { vault: v, hw, accounts, pairingInfo };
}

describe('the fake device refuses other coin types in every app', () => {
    it('the Bitcoin app cannot derive a Litecoin path, nor the Litecoin app a Bitcoin one', async () => {
        const { dev } = ledgerHolding(SEED_A, 'Bitcoin');
        const client = new dev.Btc();
        await expect(client.getWalletPublicKey("m/44'/2'/0'")).rejects.toThrow(/0x6a82/);
        dev.device.openApp = 'Litecoin';
        await expect(client.getWalletPublicKey("m/44'/0'/0'")).rejects.toThrow(/0x6a82/);
        dev.device.openApp = 'Bitcoin Test';
        await expect(client.getWalletPublicKey("m/44'/0'/0'")).rejects.toThrow(/0x6a82/);
    });
});

describe('pairing records one identity per chain, as a hash only', () => {
    it('keeps the Bitcoin-app identifier exactly as before', async () => {
        const { dev, factory } = ledgerHolding(SEED_A, 'Bitcoin');
        const { pairingInfo } = await factory();
        const { publicKey } = await new dev.Btc().getWalletPublicKey("m/44'/0'/0'", { verify: false });
        expect(pairingInfo.deviceIdentifier).toBe(await deriveLedgerDeviceIdentifier(publicKey));
        expect(pairingInfo.appName).toBe('Bitcoin');
        expect(pairingInfo.chainIds).toEqual(['bitcoin-mainnet']);
    });

    it('stores { path, fingerprint } for every chain with an account, and no key', async () => {
        const { vault, hw, accounts } = await pairedLedgerWallet();
        const stored = await vault.signers.get(hw.signer.id);
        expect(Object.keys(stored.identities).sort()).toEqual([...CHAINS].sort());
        for (const account of accounts) {
            expect(stored.identities[account.chainId]).toEqual({
                path: account.derivationPath,
                fingerprint: ledgerIdentityFingerprint(account.publicKey),
            });
        }
        const text = JSON.stringify(stored);
        for (const account of accounts) {
            expect(text).not.toContain(account.publicKey);
            expect(text).not.toContain(compressedPublicKeyHex(account.publicKey));
        }
        expect(validateSignerRecord(stored)).toEqual({ ok: true, errors: [] });
    });

    it('a Trezor record carries no identities', async () => {
        const vault = await openVault();
        const hw = await addHardwareWallet({
            vault,
            chainRegistry: REGISTRY,
            name: 'Desk Trezor',
            device: { vendor: 'trezor', model: 'T3T1', deviceIdentifier: 'trezor-dev', firmwareVersion: null },
            accounts: [{
                chainId: 'bitcoin-mainnet', accountIndex: 0, address: 'bc1qx', publicKey: `02${'a'.repeat(64)}`, derivationPath: "m/84'/0'/0'/0/0", addressType: 'p2wpkh',
            }],
        });
        expect(hw.signer).not.toHaveProperty('identities');
    });
});

describe('paired with the Bitcoin app, a sign on each chain is accepted with that chain\'s app open', () => {
    for (const chainId of CHAINS) {
        const app = LEDGER_APP_NAME_FOR_CHAIN[chainId];
        it(`${chainId} with the ${app} app open: the reconnect check passes and the device signs`, async () => {
            const { vault, hw, accounts } = await pairedLedgerWallet();
            const [record] = await listSignersForWallet(vault, hw.wallet.id, { withIdentities: true });
            const { dev, factory } = ledgerHolding(SEED_A, app);

            await expect(ensureLive(record, { ledger: factory }, { chainId })).resolves.toMatchObject({
                pairingInfo: { appName: app },
            });

            // Through the session signer the shells register at unlock: the
            // sign opens the device, checks it through the open app, then signs.
            const session = makeHardwareSessionSigner(record, {
                open: (r, o) => openHardwareSigner(r, { ledger: factory }, o),
            });
            const path = accounts.find((a) => a.chainId === chainId).derivationPath;
            const { signature } = await session.signMessage({ message: 'hi', path, chainId });
            expect(Buffer.from(signature, 'base64')).toHaveLength(65);
            expect(dev.device.openApp).toBe(app);
        });
    }

    it('the check uses the operation\'s chain when its app is open', async () => {
        const { vault, hw } = await pairedLedgerWallet();
        const [record] = await listSignersForWallet(vault, hw.wallet.id, { withIdentities: true });
        const { factory } = ledgerHolding(SEED_A, 'Bitcoin Test');
        const live = await factory();
        await expect(checkLedgerIdentity(record, live, { chainId: 'bitcoin-regtest' }))
            .resolves.toEqual({ verdict: 'same', chainId: 'bitcoin-regtest' });
    });

    it('with another chain\'s app open the device is still recognised, and the sign names the app it needs', async () => {
        const { vault, hw, accounts } = await pairedLedgerWallet();
        const [record] = await listSignersForWallet(vault, hw.wallet.id, { withIdentities: true });
        const { factory } = ledgerHolding(SEED_A, 'Bitcoin');
        const session = makeHardwareSessionSigner(record, {
            open: (r, o) => openHardwareSigner(r, { ledger: factory }, o),
        });
        const path = accounts.find((a) => a.chainId === 'litecoin-mainnet').derivationPath;
        const err = await session.signMessage({ message: 'hi', path, chainId: 'litecoin-mainnet' }).catch((e) => e);
        expect(err).toMatchObject({ code: 'HW_WRONG_APP' });
        expect(err.code).not.toBe('HW_WRONG_DEVICE');
    });
});

describe('a different device is refused from every app', () => {
    for (const chainId of CHAINS) {
        const app = LEDGER_APP_NAME_FOR_CHAIN[chainId];
        it(`${chainId} with the ${app} app open on another Ledger: HW_WRONG_DEVICE, nothing signed`, async () => {
            const { vault, hw, accounts } = await pairedLedgerWallet();
            const [record] = await listSignersForWallet(vault, hw.wallet.id, { withIdentities: true });
            const { factory } = ledgerHolding(SEED_B, app);

            await expect(ensureLive(record, { ledger: factory }, { chainId }))
                .rejects.toMatchObject({ code: 'HW_WRONG_DEVICE' });

            const session = makeHardwareSessionSigner(record, {
                open: (r, o) => openHardwareSigner(r, { ledger: factory }, o),
            });
            const path = accounts.find((a) => a.chainId === chainId).derivationPath;
            await expect(session.signMessage({ message: 'hi', path, chainId }))
                .rejects.toMatchObject({ code: 'HW_WRONG_DEVICE' });
        });
    }
});

describe('the bridge\'s copy of the record after Add Wallet', () => {
    // Right after pairing, the shell registers the live signer under a
    // four-field record (no identities). Adding the wallet switches to it, so
    // the unlock pass re-lists the signers and the registered session signer
    // adopts the full record; a reopen after a lock then checks per chain.
    it('adopts the listed identities, so a Litecoin sign after a lock is accepted', async () => {
        const { vault, hw, accounts } = await pairedLedgerWallet();
        const { factory } = ledgerHolding(SEED_A, 'Litecoin');
        setHardwareFactories({ ledger: factory });
        try {
            const paired = await ledgerHolding(SEED_A, 'Bitcoin').factory();
            const registered = sessionSignerFor(null, hw.signer.id, paired.signer);
            expect(registered.record).not.toHaveProperty('identities');

            const [listed] = await listSignersForWallet(vault, hw.wallet.id, { withIdentities: true });
            expect(sessionSignerForRecord(registered, listed)).toBe(registered);
            expect(Object.keys(registered.record.identities).sort()).toEqual([...CHAINS].sort());

            invalidateLiveSigners();
            const path = accounts.find((a) => a.chainId === 'litecoin-mainnet').derivationPath;
            const { signature } = await registered.signMessage({ message: 'hi', path, chainId: 'litecoin-mainnet' });
            expect(Buffer.from(signature, 'base64')).toHaveLength(65);
            expect(factory).toHaveBeenCalledTimes(1);
        } finally {
            _resetHardwareReconnectForTests();
        }
    });
});

describe('records saved before identities existed', () => {
    async function legacyWallet() {
        const out = await pairedLedgerWallet();
        const stored = await out.vault.signers.get(out.hw.signer.id);
        const { identities, ...legacy } = stored;
        await out.vault.signers.put(legacy);
        return { ...out, legacy };
    }

    it('get identities from the device\'s own stored addresses when listed for the renderer', async () => {
        const { vault, hw, legacy } = await legacyWallet();
        expect(legacy).not.toHaveProperty('identities');
        const [plain] = await listSignersForWallet(vault, hw.wallet.id);
        expect(plain).not.toHaveProperty('identities');
        const [record] = await listSignersForWallet(vault, hw.wallet.id, { withIdentities: true });
        expect(Object.keys(record.identities).sort()).toEqual([...CHAINS].sort());
        const { factory } = ledgerHolding(SEED_A, 'Litecoin');
        await expect(ensureLive(record, { ledger: factory }, { chainId: 'litecoin-mainnet' })).resolves.toBeTruthy();
        const other = ledgerHolding(SEED_B, 'Litecoin');
        await expect(ensureLive(record, { ledger: other.factory }, { chainId: 'litecoin-mainnet' }))
            .rejects.toMatchObject({ code: 'HW_WRONG_DEVICE' });
    });

    it('with no identity at all keep the Bitcoin-app check, and never pass a device they cannot check to a sign', async () => {
        const { legacy } = await legacyWallet();
        await expect(ensureLive(legacy, { ledger: ledgerHolding(SEED_A, 'Bitcoin').factory })).resolves.toBeTruthy();
        await expect(ensureLive(legacy, { ledger: ledgerHolding(SEED_B, 'Bitcoin').factory }))
            .rejects.toMatchObject({ code: 'HW_WRONG_DEVICE' });
        // The right app is open but the network was never read: not a wrong
        // app (ruling 2026-11-15), and still no unchecked sign.
        await expect(ensureLive(legacy, { ledger: ledgerHolding(SEED_A, 'Litecoin').factory }, { chainId: 'litecoin-mainnet' }))
            .rejects.toMatchObject({ code: 'HW_NETWORK_UNREAD' });
        await expect(ensureLive(legacy, { ledger: ledgerHolding(SEED_B, 'Dogecoin').factory }, { chainId: 'dogecoin-mainnet' }))
            .rejects.toMatchObject({ code: 'HW_NETWORK_UNREAD' });
        // A chain the open app does not serve is still a wrong app.
        await expect(ensureLive(legacy, { ledger: ledgerHolding(SEED_A, 'Litecoin').factory }, { chainId: 'dogecoin-mainnet', read: true }))
            .rejects.toMatchObject({ code: 'HW_WRONG_APP' });
    });
});

describe('the same Ledger paired again from another app', () => {
    it('gets another identifier but is still refused as already linked', async () => {
        const first = await pairedLedgerWallet();
        const second = ledgerHolding(SEED_A, 'Litecoin');
        const { pairingInfo } = await second.factory();
        expect(pairingInfo.deviceIdentifier).not.toBe(first.pairingInfo.deviceIdentifier);
        await expect(pairedLedgerWallet({ vault: first.vault, name: 'Same Ledger', pairApp: 'Litecoin' }))
            .rejects.toMatchObject({ code: 'HW_ALREADY_LINKED' });
    });

    it('a different Ledger is not taken for the linked one', async () => {
        const first = await pairedLedgerWallet();
        await expect(pairedLedgerWallet({ mnemonic: SEED_B, vault: first.vault, name: 'Other Ledger' }))
            .resolves.toBeTruthy();
    });

    it('an app with no XChain chain is still refused at pairing', async () => {
        const { factory } = ledgerHolding(SEED_A, 'Ethereum');
        await expect(factory()).rejects.toThrow(/"Ethereum" app is open/);
    });
});
